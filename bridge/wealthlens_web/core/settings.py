"""Reading and changing a workspace's WealthLens-core configuration.

Everything `wealthlens init` asks is editable afterwards (identity-and-settings). Two hazards shape how.

**config.toml is documentation, not just data.** WLC ships it with ~70 lines of comments teaching a
household how their own config works, plus a value-reference syntax (`@file:NAME`, `@a.b.c`). A plain
parse-and-rewrite would destroy all of that on the first setting anybody changed — so edits go through a
style-preserving writer and a save touches one line.

**PAN is a secret as much as an identity.** It unlocks CAS and many statements, so it follows WLC's own
convention: its own file with restrictive permissions, referenced from config rather than inlined. This
module writes it there and never returns it — a caller learns only whether one is set.
"""
from __future__ import annotations

import dataclasses
import pathlib
import re

import tomlkit

CONFIG = "config.toml"
PAN_FILE = "PAN"
SECRET_MODE = 0o600

# WLC's own shape: five letters, four digits, one letter. Checked so a typo is refused before it is written,
# not discovered later when an import mysteriously fails to open anything.
PAN_SHAPE = re.compile(r"^[A-Za-z]{5}[0-9]{4}[A-Za-z]$")


class SettingsError(ValueError):
    """A change was refused. Names the field, so a UI can point at it."""

    def __init__(self, message: str, field: str):
        super().__init__(message)
        self.field = field


@dataclasses.dataclass(frozen=True)
class Settings:
    """What a household can see about a workspace's configuration. Never a secret's value."""

    holder_names: tuple[str, ...]
    pan_set: bool
    organize: bool
    secret_names: tuple[str, ...]
    config_path: str

    def as_dict(self) -> dict:
        return {
            "holder_names": list(self.holder_names),
            # Set-or-unset only. The value is never returned by any read, including this one.
            "pan_set": self.pan_set,
            "organize": self.organize,
            "secret_names": list(self.secret_names),
            "config_path": self.config_path,
        }


def _document(workspace: pathlib.Path) -> tomlkit.TOMLDocument:
    path = pathlib.Path(workspace) / CONFIG
    try:
        return tomlkit.parse(path.read_text())
    except FileNotFoundError:
        return tomlkit.document()
    except OSError as e:
        raise SettingsError(f"can't read {path}: {e}", field="config") from None


def read(workspace: pathlib.Path) -> Settings:
    doc = _document(workspace)
    identity = doc.get("identity", {})
    names = identity.get("holder_names", [])
    pan_path = pathlib.Path(workspace) / PAN_FILE
    return Settings(
        holder_names=tuple(str(n) for n in names) if isinstance(names, list) else (),
        pan_set=pan_path.exists() and bool(pan_path.read_text().strip()),
        organize=bool(doc.get("organize", {}).get("enabled", True)),
        secret_names=tuple(str(k) for k in doc.get("secrets", {})),
        config_path=str(pathlib.Path(workspace) / CONFIG),
    )


def _write(workspace: pathlib.Path, doc: tomlkit.TOMLDocument) -> None:
    (pathlib.Path(workspace) / CONFIG).write_text(tomlkit.dumps(doc))


def set_holder_names(workspace: pathlib.Path, names: list[str]) -> Settings:
    cleaned = [n.strip() for n in names if n and n.strip()]
    if not cleaned:
        raise SettingsError("a name is needed — it is what strips your own name out of transaction text.",
                            field="holder_names")
    doc = _document(workspace)
    doc.setdefault("identity", tomlkit.table())["holder_names"] = cleaned
    _write(workspace, doc)
    return read(workspace)


def set_pan(workspace: pathlib.Path, pan: str) -> Settings:
    """Write the PAN where WLC expects it, and leave config referencing rather than containing it."""
    value = pan.strip().upper()
    if not PAN_SHAPE.match(value):
        raise SettingsError(
            "that is not a PAN. It is five letters, four digits, then one letter.", field="pan")

    path = pathlib.Path(workspace) / PAN_FILE
    path.write_text(value)
    path.chmod(SECRET_MODE)          # WLC's own permissions: a secret is not world-readable

    doc = _document(workspace)
    identity = doc.setdefault("identity", tomlkit.table())
    # A REFERENCE, never the value. Inlining it would put a secret in the file most likely to be shared
    # when somebody asks for help with their configuration.
    identity["pan"] = f"@file:{PAN_FILE}"
    _write(workspace, doc)
    return read(workspace)


def set_organize(workspace: pathlib.Path, enabled: bool) -> Settings:
    doc = _document(workspace)
    doc.setdefault("organize", tomlkit.table())["enabled"] = enabled
    _write(workspace, doc)
    return read(workspace)


def add_secret(workspace: pathlib.Path, name: str, value: str) -> Settings:
    """Add a named statement password: its own file, referenced from config — WLC's convention.

    Refuses to overwrite an existing name. WLC allows several values under one name, so combining them is a
    decision a person makes, never something a save does silently.
    """
    key = name.strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", key):
        raise SettingsError("a name uses letters, digits, dashes or underscores.", field="name")
    if not value:
        raise SettingsError("an empty password would open nothing.", field="value")

    doc = _document(workspace)
    secrets = doc.setdefault("secrets", tomlkit.table())
    if key in secrets:
        raise SettingsError(
            f"{key!r} already names a password here. Choose another name, or edit the existing one — "
            "adding silently would leave you unable to tell which is which.", field="name")

    secret_file = pathlib.Path(workspace) / f"{key}.pass"
    secret_file.write_text(value)
    secret_file.chmod(SECRET_MODE)
    secrets[key] = f"@file:{secret_file.name}"
    _write(workspace, doc)
    return read(workspace)
