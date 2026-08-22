"""Locating the engine — the one place that knows whether WealthLens-core is present and usable.

Preflight runs at EVERY launch, not once at install (cold-start spec): a household can upgrade WLC on its
own, move a folder, or run on a machine somebody else set up, so the installer's world is never assumed to
have persisted.

Note on version pinning: WLC's *package* version is a placeholder that does not track its *schema* version,
so a package-version range would be a pin against a number that means nothing. What actually governs
compatibility is the schema version — it decides which stores this engine can read at all (ADR-0017) — so
that is what this module reports and what callers gate on.
"""
from __future__ import annotations

import dataclasses


@dataclasses.dataclass(frozen=True)
class Engine:
    """What preflight found. `schema_version` is None exactly when the engine is absent or unusable."""

    present: bool
    schema_version: str | None = None
    detail: str | None = None            # why it is unusable, for a screen that names problem AND fix

    @property
    def usable(self) -> bool:
        return self.present and self.schema_version is not None


def preflight() -> Engine:
    """Report the installed engine. Never raises: a missing engine is a STATE the UI renders, not an error
    that takes the app down with it — a blank page is the one outcome the spec forbids."""
    try:
        from wealthlens import schema
    except ImportError as e:
        return Engine(present=False, detail=f"WealthLens-core is not installed ({e})")
    version = getattr(schema, "SCHEMA_VERSION", None)
    if not version:
        return Engine(present=True, detail="WealthLens-core is installed but reports no schema version")
    return Engine(present=True, schema_version=str(version))
