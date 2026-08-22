"""The family manifest — the only file this app owns.

`family.toml` declares who is in the family, where each person's WealthLens-core workspace lives, and how
to present them. It holds no financial data, no passwords and no keys: it should be harmless if it were
public (ADR-0002).

Two shapes on purpose. `parse()` takes **text** and returns a `Manifest`, so every rule below is testable
by calling a function with a string — no filesystem, no fixtures, no temp directories (ADR-0018). `load()`
is the thin wrapper that reads a file and hands the text over.

**Unknown keys are refused, not ignored.** A manifest is hand-edited, and `reporting_curency = "USD"` that
is silently ignored produces figures in the wrong currency with nothing to notice. This project keeps
finding that failure shape — a plausible input accepted and quietly dropped — so the parser names what it
did not recognise instead of shrugging.
"""
from __future__ import annotations

import dataclasses
import pathlib
import tomllib

# v1 values in rupees because that is the pivot WLC can compute: `fx_rates` stores an INR-relative rate and
# its value columns are INR-named (ADR-0016). Declaring another currency is refused rather than silently
# reported under the wrong label, so this default chooses between one option, not several.
DEFAULT_REPORTING_CURRENCY = "INR"

_MANIFEST_KEYS = {"family", "entity", "view"}
_FAMILY_KEYS = {"label", "reporting_currency"}
_ENTITY_KEYS = {"id", "label", "workspace", "workspaces", "owner", "currency", "key_backup"}
_VIEW_KEYS = {"default"}


class ManifestError(ValueError):
    """The manifest could not be understood. Always names the offending entry."""


@dataclasses.dataclass(frozen=True)
class KeyBackup:
    """Whether a workspace's store key has been confirmed as backed up (ADR-0015).

    A fingerprint and a date are not secrets, which is why they can live here without making the manifest
    sensitive — and tracking them per workspace is what stops an unconfirmed one being quietly assumed safe.
    """

    confirmed: bool = False
    on: str | None = None
    fingerprint: str | None = None


@dataclasses.dataclass(frozen=True)
class Entity:
    """One person, and the workspace(s) their money lives in."""

    id: str
    label: str
    workspaces: tuple[pathlib.Path, ...]
    owner: str = "self"
    currency: str | None = None
    key_backup: KeyBackup = dataclasses.field(default_factory=KeyBackup)

    @property
    def has_several_workspaces(self) -> bool:
        return len(self.workspaces) > 1


@dataclasses.dataclass(frozen=True)
class Manifest:
    label: str
    reporting_currency: str
    entities: tuple[Entity, ...]
    default_view: str

    def entity(self, entity_id: str) -> Entity:
        for e in self.entities:
            if e.id == entity_id:
                return e
        known = ", ".join(e.id for e in self.entities) or "none"
        raise ManifestError(f"no entity {entity_id!r} in the manifest (declared: {known})")


def parse(text: str) -> Manifest:
    """A `Manifest` from TOML text. Pure: no filesystem, no environment."""
    try:
        raw = tomllib.loads(text)
    except tomllib.TOMLDecodeError as e:
        raise ManifestError(f"the manifest is not valid TOML: {e}") from None

    _reject_unknown(raw, _MANIFEST_KEYS, "the manifest")
    family = raw.get("family") or {}
    _reject_unknown(family, _FAMILY_KEYS, "[family]")
    view = raw.get("view") or {}
    _reject_unknown(view, _VIEW_KEYS, "[view]")

    entries = raw.get("entity") or []
    if not entries:
        raise ManifestError("the manifest declares no entities — add at least one [[entity]]")

    entities, seen = [], {}
    for i, entry in enumerate(entries):
        e = _entity(entry, i)
        if e.id in seen:
            raise ManifestError(
                f"two entities share the id {e.id!r} ({seen[e.id]!r} and {e.label!r}) — ids address "
                "workspaces in the API and must be unique")
        seen[e.id] = e.label
        entities.append(e)

    default_view = str(view.get("default", "family"))
    known = {"family", *(e.id for e in entities)}
    if default_view not in known:
        raise ManifestError(
            f"[view] default = {default_view!r} names neither 'family' nor a declared entity "
            f"({', '.join(sorted(known))})")

    return Manifest(
        label=str(family.get("label", "Family")),
        reporting_currency=str(family.get("reporting_currency", DEFAULT_REPORTING_CURRENCY)).upper(),
        entities=tuple(entities),
        default_view=default_view,
    )


def load(path: str | pathlib.Path) -> Manifest:
    """Read and parse a manifest file."""
    p = pathlib.Path(path).expanduser()
    try:
        text = p.read_text()
    except OSError as e:
        raise ManifestError(f"can't read the manifest at {p}: {e}") from None
    return parse(text)


# ── entry parsing ────────────────────────────────────────────────────────────────────────────────────

def _entity(entry: dict, index: int) -> Entity:
    where = f"[[entity]] #{index + 1}"
    if not isinstance(entry, dict):
        raise ManifestError(f"{where} is not a table")
    _reject_unknown(entry, _ENTITY_KEYS, where)

    entity_id = str(entry.get("id", "")).strip()
    if not entity_id:
        raise ManifestError(f"{where} has no id — an entity needs a stable id the API can address it by")
    where = f"entity {entity_id!r}"

    single, several = entry.get("workspace"), entry.get("workspaces")
    if single and several:
        raise ManifestError(
            f"{where} declares both `workspace` and `workspaces` — use one; ambiguity here would silently "
            "read the wrong store")
    paths = [single] if single else list(several or [])
    if not paths:
        raise ManifestError(f"{where} declares no workspace")
    workspaces = tuple(pathlib.Path(str(p)).expanduser() for p in paths)

    backup = entry.get("key_backup") or {}
    if not isinstance(backup, dict):
        raise ManifestError(f"{where}: key_backup must be a table")
    _reject_unknown(backup, {"confirmed", "on", "fingerprint"}, f"{where} key_backup")

    return Entity(
        id=entity_id,
        label=str(entry.get("label") or entity_id),
        workspaces=workspaces,
        # Whose share to value. WLC weights every figure by this and contributes ZERO for an instrument
        # owned by someone else — silently — so the default is stated here rather than left implicit.
        owner=str(entry.get("owner") or "self"),
        currency=(str(entry["currency"]).upper() if entry.get("currency") else None),
        key_backup=KeyBackup(
            confirmed=bool(backup.get("confirmed", False)),
            on=(str(backup["on"]) if backup.get("on") else None),
            fingerprint=(str(backup["fingerprint"]) if backup.get("fingerprint") else None),
        ),
    )


def _reject_unknown(table: dict, allowed: set[str], where: str) -> None:
    unknown = sorted(set(table) - allowed)
    if unknown:
        raise ManifestError(
            f"{where}: unrecognised key(s) {', '.join(repr(k) for k in unknown)}. "
            f"Known keys are {', '.join(sorted(allowed))}. "
            "(Refused rather than ignored — a silently dropped setting is how a manifest lies.)")
