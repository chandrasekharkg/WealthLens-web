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


def _password_for(sha: str | None, hints: dict[str, str]) -> Password:
    ref = hints.get(sha or "")
    if not ref:
        return Password(PasswordRef.NONE)
    # `pw:` is WLC's fingerprint marker — recorded when the opener was an unnamed password (one remembered
    # interactively, or one from the PAN pool). It identifies without revealing, and it is NOT a name.
    if ref.startswith("pw:"):
        return Password(PasswordRef.UNNAMED)
    return Password(PasswordRef.NAMED, name=ref)


def documents(con, workspace: pathlib.Path) -> list[Document]:
    """Every source registered in this store, newest capture first."""
    from wealthlens import lens

    hints = _hints(workspace)
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
            password=_password_for(
                str(row["content_sha256"]) if _present(row["content_sha256"]) else None, hints),
        ))
    return out
