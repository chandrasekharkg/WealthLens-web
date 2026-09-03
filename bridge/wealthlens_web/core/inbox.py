"""Depositing a statement into a workspace's inbox.

This is a **deposit**, not an import. The file lands in `statements/` and nothing else happens: no parsing,
no store write, no inspection of the contents. Custody begins at WLC's import gates, and putting a file in
a folder is the furthest this app goes towards them (ADR-0005).

Three rules make that safe rather than merely narrow:

- **The inbox and nowhere else.** A filename is attacker-controlled in the ordinary sense that a browser
  sends it, so it is reduced to a bare name and re-joined to the inbox; a path that escapes is refused
  rather than sanitised into something plausible.
- **Never overwrite.** WLC's own convention: a colliding name becomes `name (2).pdf`. Two statements a bank
  gave the same filename are two different documents, and this project has already learned that a file is a
  duplicate only when its CONTENT matches.
- **Only what the engine can read.** The extension allowlist mirrors WLC's dispatch, and a test pins the two
  together so a format added upstream cannot silently become un-uploadable.
"""
from __future__ import annotations

import dataclasses
import pathlib
import re

INBOX = "statements"

# Mirrors `wealthlens.cli._inbox_files`. Pinned by a test rather than imported: it is a private name
# upstream, and reaching into it would be the boundary violation this app is built to avoid.
ALLOWED_SUFFIXES = frozenset({".pdf", ".json", ".txt", ".xls", ".xlsx"})

# 80 MB. Household statements are far smaller; this exists so a mistake or a runaway upload cannot fill a
# disk, not as a considered limit on any real document.
MAX_BYTES = 80 * 1024 * 1024

_SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._()\-]*$")


class RejectedUpload(ValueError):
    """The deposit was refused. Always says which rule, so a UI can explain it rather than say 'failed'."""

    def __init__(self, message: str, reason: str):
        super().__init__(message)
        self.reason = reason


@dataclasses.dataclass(frozen=True)
class Deposited:
    path: pathlib.Path
    renamed_from: str | None = None

    @property
    def name(self) -> str:
        return self.path.name


def safe_name(filename: str) -> str:
    """Reduce a browser-supplied filename to a bare, safe name, or refuse it.

    Refusing beats sanitising. A silently rewritten name is a file a household cannot find again, and the
    rewrite would be the only record that anything was wrong.
    """
    name = pathlib.PurePosixPath(filename.replace("\\", "/")).name.strip()
    if not name or name in {".", ".."}:
        raise RejectedUpload(f"{filename!r} is not a usable filename", reason="name")
    if not _SAFE_NAME.match(name):
        raise RejectedUpload(
            f"{name!r} contains characters this app will not write to disk. Rename it to letters, digits, "
            "spaces, dots, dashes or brackets and try again.", reason="name")
    return name


def check_suffix(name: str) -> str:
    suffix = pathlib.Path(name).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise RejectedUpload(
            f"WealthLens cannot read {suffix or 'a file with no extension'}. It reads "
            f"{', '.join(sorted(ALLOWED_SUFFIXES))}.", reason="type")
    return suffix


@dataclasses.dataclass(frozen=True)
class InboxFile:
    name: str
    size: int
    modified: float          # epoch seconds — the UI turns it into "2 minutes ago"


def _inbox_dir(workspace: pathlib.Path) -> pathlib.Path:
    """The one folder uploads land in for this workspace. Resolved, so the containment checks below hold."""
    return pathlib.Path(workspace).resolve() / INBOX


def listing(workspace: pathlib.Path) -> list[InboxFile]:
    """Every readable statement CURRENTLY sitting in this workspace's inbox — the batch the next Import will
    process. The Import screen shows it on load so a user sees what is staged (uploaded earlier, or auto-
    renamed on a name clash) instead of a blank slate. Only files the engine could read are listed (the same
    suffix allowlist deposit enforces); a missing inbox is simply an empty batch, not an error."""
    inbox = _inbox_dir(workspace)
    if not inbox.is_dir():
        return []
    out: list[InboxFile] = []
    for p in sorted(inbox.iterdir(), key=lambda q: q.name.lower()):
        if p.is_file() and p.suffix.lower() in ALLOWED_SUFFIXES:
            st = p.stat()
            out.append(InboxFile(name=p.name, size=st.st_size, modified=st.st_mtime))
    return out


def remove(workspace: pathlib.Path, filename: str) -> str:
    """Delete one file from the inbox so a user can rename it and re-upload — the escape hatch for a name a
    bank reuses every month (the customer-id filename that auto-renamed to `… (2).pdf`). Reuses `safe_name`'s
    reduction + the containment guard, so the name can only ever address a file INSIDE the inbox; a name that
    is not there is a 'missing' refusal (never a silent success). Deposited files only — never the store, never
    a config. Returns the name removed."""
    name = safe_name(filename)                          # reduce + validate, or RejectedUpload(reason="name")
    inbox = _inbox_dir(workspace)
    target = inbox / name
    if inbox not in target.resolve().parents:           # belt-and-braces: the reduced name cannot escape
        raise RejectedUpload("that filename would point outside the inbox.", reason="path")
    if not target.is_file():
        raise RejectedUpload(f"'{name}' is not in the inbox — nothing to remove.", reason="missing")
    target.unlink()
    return name


def deposit(workspace: pathlib.Path, filename: str, content: bytes) -> Deposited:
    """Write one uploaded file into this workspace's inbox. Returns where it landed."""
    if len(content) > MAX_BYTES:
        raise RejectedUpload(
            f"that file is {len(content) / 1e6:.0f} MB and the limit is {MAX_BYTES // 1_000_000} MB.",
            reason="size")
    if not content:
        raise RejectedUpload("that file is empty.", reason="empty")

    name = safe_name(filename)
    check_suffix(name)

    # The workspace must already exist. Without this, `mkdir(parents=True)` would happily build a folder
    # tree at a path that is not a workspace at all — leaving a statement in a directory no engine will
    # ever read, and no error to say so.
    root = pathlib.Path(workspace)
    if not root.is_dir():
        raise RejectedUpload(
            f"there is no workspace at {root}. Create it first — a statement left outside a workspace is "
            "a file nothing will ever read.", reason="workspace")

    inbox = root.resolve() / INBOX
    inbox.mkdir(parents=True, exist_ok=True)

    target = inbox / name
    # Belt and braces: after reduction the name cannot escape, but the invariant is worth asserting rather
    # than assuming, because everything downstream trusts it.
    if inbox not in target.resolve().parents:
        raise RejectedUpload("that filename would write outside the inbox.", reason="path")

    original = name
    counter = 2
    while target.exists():                      # WLC's convention: keep both, never clobber
        stem = pathlib.Path(original).stem
        target = inbox / f"{stem} ({counter}){pathlib.Path(original).suffix}"
        counter += 1

    target.write_bytes(content)
    return Deposited(target, renamed_from=original if target.name != original else None)
