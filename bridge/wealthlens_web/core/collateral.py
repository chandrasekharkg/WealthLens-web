"""What a store was built from, and which password opens each document.

This is the pane that makes the custodian legible: every source the engine registered, what became of it,
and — where WLC recorded one — the *name* of the password that opened it.

Two facts about where that lives, both verified rather than assumed:

- Sources are rows in the store (`sources`), read through lens's SQL escape hatch.
- Password hints are **not** in the store. WLC keeps `.password_hints.json` beside the `.pass` files,
  deliberately: a hint is an acceleration, not a fact, and must not touch `store = replay(corpus)`.

And a third that shapes the UI: the recorded reference is the `.pass` filename **only when the opener came
from a configured secret**. Otherwise it is a non-reversible fingerprint (`pw:…`). So there are three
states, not two — named, opened-by-something-unnamed, and never-opened — and a pane that offers only the
first two will mislabel the common case.
"""
from __future__ import annotations

import dataclasses
import enum
import json
import pathlib

HINTS_FILE = ".password_hints.json"
CONFIG_FILE = "config.toml"


class PasswordRef(enum.StrEnum):
    NAMED = "named"          # a configured secret opened it; we can show which
    UNNAMED = "unnamed"      # something opened it, but only a fingerprint was recorded
    NONE = "none"            # nothing has opened this document


@dataclasses.dataclass(frozen=True)
class Password:
    kind: PasswordRef
    name: str | None = None

    def as_dict(self) -> dict:
        return {"kind": self.kind, "name": self.name}


@dataclasses.dataclass(frozen=True)
class Document:
    """One source the engine registered, and what became of it."""

    source_id: str
    kind: str
    provider: str | None
    filename: str | None
    payload_ref: str | None
    rows: int | None
    captured_at: str | None
    password: Password

    def as_dict(self) -> dict:
        return {
            "source_id": self.source_id,
            "kind": self.kind,
            "provider": self.provider,
            "filename": self.filename,
            "payload_ref": self.payload_ref,
            "rows": self.rows,
            "captured_at": self.captured_at,
            "password": self.password.as_dict(),
        }


def _present(value):
    """A DataFrame cell that actually holds something.

    SQL NULL arrives from pandas as NaN or NAType, and neither is `None` — so `if value is not None` reads
    as "present" for a value that is emphatically absent, and the int() below then raises. This is the
    pandas-shaped version of the blank-versus-stated problem the data conventions are about.
    """
    if value is None:
        return False
    try:
        import pandas as pd

        return not bool(pd.isna(value))
    except (TypeError, ValueError):
        return True


def _hints(workspace: pathlib.Path) -> dict[str, str]:
    """content-sha → recorded reference. Absent or unreadable means simply: nothing is known."""
    path = pathlib.Path(workspace) / HINTS_FILE
    try:
        loaded = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    return {k: str(v) for k, v in loaded.items() if isinstance(v, str)} if isinstance(loaded, dict) else {}


def _parser_passwords(workspace: pathlib.Path) -> dict[str, str]:
    """provider → the password REFERENCE its parser config declares (e.g. religare → '@identity.pan'). This
    is what opens a document when no per-file hint was recorded: a Religare contract note or a depository CAS
    is opened by the PAN, and the config says so even where the hint file is silent. Absent/unreadable
    config: nothing known."""
    try:
        import tomllib
        cfg = tomllib.loads((pathlib.Path(workspace) / CONFIG_FILE).read_text())
    except (OSError, ValueError):
        return {}
    out: dict[str, str] = {}
    for name, section in (cfg.get("parser") or {}).items():
        ref = section.get("password") if isinstance(section, dict) else None
        # a list-valued password (several tried in series) resolves to its first reference
        if isinstance(ref, list):
            ref = next((r for r in ref if isinstance(r, str)), None)
        if isinstance(ref, str):
            out[name] = ref
    return out


# A depository CAS is opened by the PAN, but its provider is recorded as the DEPOSITORY (nsdl/cdsl), while
# the config declares the password under the PARSER that reads them ([parser.cas]). This bridges the two.
_PROVIDER_PARSER_ALIAS = {"nsdl": "cas", "cdsl": "cas"}


def _config_password_name(provider: str | None, parser_pw: dict[str, str]) -> str | None:
    """The reveal-name of the password a provider's parser config declares — directly, or via a known alias
    (nsdl/cdsl → cas). None when the config names nothing revealable."""
    key = provider or ""
    ref = parser_pw.get(key) or parser_pw.get(_PROVIDER_PARSER_ALIAS.get(key, ""))
    return _reveal_name(ref) if ref else None


def _reveal_name(ref: str) -> str | None:
    """A config password reference → the name `settings.reveal` understands, or None if it names nothing
    revealable here. `@identity.pan` is the PAN; `@secrets.X` and `@file:F` name a configured secret."""
    if ref == "@identity.pan":
        return "pan"
    if ref.startswith("@secrets."):
        return ref.removeprefix("@secrets.")
    if ref.startswith("@file:"):
        return ref.removeprefix("@file:")
    return None


def _password_for(sha: str | None, hints: dict[str, str]) -> Password:
    ref = hints.get(sha or "")
    if not ref:
        return Password(PasswordRef.NONE)
    # `pw:` is WLC's fingerprint marker — recorded when the opener was an unnamed password (one remembered
    # interactively, or one from the PAN pool). It identifies without revealing, and it is NOT a name.
    if ref.startswith("pw:"):
        return Password(PasswordRef.UNNAMED)
    return Password(PasswordRef.NAMED, name=ref)


def _password_with_config(sha, hints, provider, parser_pw) -> Password:
    """Which password to SHOW for a document, most-specific first:

      1. a NAMED hint — a specific `.pass` file the store actually recorded — always wins;
      2. the parser config — it NAMES the password a fingerprint (UNNAMED) or a blank (NONE) does not, so a
         CAS or a Religare CN opened by the PAN shows a copyable PAN instead of "an unnamed password"/"no
         password";
      3. otherwise the hint stands (a fingerprint with no config match stays UNNAMED; a blank stays NONE).
    """
    got = _password_for(sha, hints)
    if got.kind is PasswordRef.NAMED:
        return got
    name = _config_password_name(provider, parser_pw)
    if name:
        return Password(PasswordRef.NAMED, name=name)
    return got


def documents(con, workspace: pathlib.Path) -> list[Document]:
    """Every source registered in this store, newest capture first."""
    from wealthlens import lens

    hints = _hints(workspace)
    parser_pw = _parser_passwords(workspace)
    rows = lens.sql(
        "SELECT source_id, source_type, provider, payload_ref, row_count, captured_at, "
        "       content_sha256, detail "
        "FROM sources ORDER BY captured_at DESC NULLS LAST, source_id",
        con=con,
    )
    out = []
    for _, row in rows.iterrows():
        detail = row["detail"]
        if isinstance(detail, str):
            try:
                detail = json.loads(detail)
            except json.JSONDecodeError:
                detail = {}
        filename = (detail or {}).get("filename") if isinstance(detail, dict) else None
        out.append(Document(
            source_id=str(row["source_id"]),
            kind=str(row["source_type"]),
            provider=(str(row["provider"]) if _present(row["provider"]) else None),
            filename=(str(filename) if filename else None),
            payload_ref=(str(row["payload_ref"]) if _present(row["payload_ref"]) else None),
            rows=(int(row["row_count"]) if _present(row["row_count"]) else None),
            captured_at=(str(row["captured_at"])[:19] if _present(row["captured_at"]) else None),
            password=_password_with_config(
                str(row["content_sha256"]) if _present(row["content_sha256"]) else None, hints,
                str(row["provider"]) if _present(row["provider"]) else None, parser_pw),
        ))
    return out


class DocumentNotFound(Exception):
    """The document's file could not be located inside the workspace, or a path escaped it."""


def resolve_document_path(workspace, *, payload_ref: str | None = None,
                         provider: str | None = None, filename: str | None = None):
    """The absolute path of a collateral file, GUARANTEED to sit inside the workspace — or a refusal.

    WLW never reads a statement (ADR-0001); this exists only so the OS can be asked to open it, and the one
    thing that must not be trusted is a path. The AUTHORITATIVE location is the store's recorded
    `payload_ref` — the file's path relative to the workspace, wherever `organize` filed it (a card statement
    lands under `statements/credit-card/<issuer>/…`, NOT under `<provider>/`). `provider/filename` is only a
    fallback for a store that recorded no payload_ref. Either candidate is then CONTAINMENT-CHECKED with real
    (symlink-resolved) paths: a `..`, an absolute path, or a symlink escape is refused, not opened. A missing
    file is refused too.
    """
    import pathlib as _pl
    root = _pl.Path(workspace).resolve()
    candidates = []
    if payload_ref:
        candidates.append(root / payload_ref)
    if filename:
        candidates.append(root / (provider or "") / filename)
    if not candidates:
        raise DocumentNotFound("this document has no file on disk (it was not captured from one)")

    last_outside = False
    for candidate in candidates:
        try:
            real = candidate.resolve()
        except OSError:
            continue
        if root != real and root not in real.parents:
            last_outside = True
            continue                                     # escapes the workspace — never this one
        if real.is_file():
            return real
    if last_outside:
        raise DocumentNotFound("the file resolves outside the workspace — refused")
    raise DocumentNotFound("no such file in the workspace")


def open_document(workspace, *, payload_ref: str | None = None,
                  provider: str | None = None, filename: str | None = None, opener=None):
    """Ask the OS to open a validated collateral file. `opener` is injected so the act is testable without
    actually launching anything; the default hands the resolved path to the platform's open command."""
    real = resolve_document_path(workspace, payload_ref=payload_ref, provider=provider, filename=filename)
    (opener or _default_opener)(real)
    return real


def _default_opener(path):
    import subprocess
    import sys
    # `path` is workspace-contained by construction — resolve_document_path refuses anything else — so the
    # platform open command is only ever handed a validated, in-workspace file.
    if sys.platform == "darwin":
        subprocess.run(["open", str(path)], check=False)
    elif sys.platform.startswith("win"):
        import os
        os.startfile(str(path))
    else:
        subprocess.run(["xdg-open", str(path)], check=False)
