"""Family aggregation — the capability this app exists for, and the one with the most ways to lie.

Composition happens at read time, in memory, per request: each entity's store is opened read-only, asked
its own question, and the answers are combined. Nothing is written, nothing is cached, and no file ever
holds more than one entity's data (ADR-0001/0002).

Four honesty rules are built into the shape rather than left to a caller:

1. **A total that is missing a part says so.** An entity whose store could not be read is named, and the
   family figure is marked partial. A silently smaller total is the failure this project exists to prevent.
2. **The set is uniform by construction.** Only stores at the engine's schema version contribute, because
   parts built under different engine semantics mean subtly different things and a total assembled from
   them cannot be explained (ADR-0017).
3. **Whose share is being valued is declared, and checked.** WLC weights every figure by an owner and
   contributes ZERO for an instrument owned by somebody else — with no error. So a store that has ownership
   rows naming nobody we asked about is reported as a **misconfiguration**, never as a total of zero.
4. **Currency is resolved, not assumed.** A reporting currency the engine cannot pivot to is refused rather
   than reported under the wrong label.
"""
from __future__ import annotations

import dataclasses
import datetime as _dt
import enum
from decimal import Decimal

from wealthlens_web.core import lens_api, money, workspaces
from wealthlens_web.core.manifest import Entity, Manifest
from wealthlens_web.core.workspaces import Availability, WorkspaceStatus

# What WLC can express figures in today: `fx_rates` stores an INR-relative rate and its value columns are
# INR-named (ADR-0016). Another reporting currency is refused, not approximated.
SUPPORTED_REPORTING_CURRENCIES = frozenset({"INR"})


class Granularity(enum.StrEnum):
    """How much detail a caller is asking for — stated, so scoped exposure is enforceable at the source."""

    AGGREGATE = "aggregate"
    POSITIONS = "positions"
    TRANSACTIONS = "transactions"


class UnsupportedReportingCurrency(ValueError):
    pass


@dataclasses.dataclass(frozen=True)
class EntityView:
    """One entity's contribution, and everything a reader needs to judge it."""

    entity_id: str
    label: str
    owner: str
    workspaces: tuple[WorkspaceStatus, ...]
    total: money.Money | None = None
    by_class: tuple[dict, ...] = ()
    evidence_as_of: str | None = None
    excluded_reason: str | None = None
    owner_warning: str | None = None

    @property
    def contributes(self) -> bool:
        return self.total is not None and self.excluded_reason is None


@dataclasses.dataclass(frozen=True)
class FamilyNetWorth:
    as_of: str | None
    reporting_currency: str
    total: money.Money | None
    entities: tuple[EntityView, ...]

    @property
    def excluded(self) -> tuple[EntityView, ...]:
        return tuple(e for e in self.entities if not e.contributes)

    @property
    def is_partial(self) -> bool:
        """True when the total is missing a declared entity — the caveat that must never be dropped."""
        return bool(self.excluded)


def resolve_date(on: str | None) -> str:
    """The date a view is computed at, always concrete.

    Passing `None` down to the engine works — it values at today — but then nobody upstream knows WHICH
    date was used, and the answer travels as "as of not specified". An artifact that cannot name its own
    date is the mixed-scope problem in a different costume, so the date is resolved here, once, and the
    same value is both sent to the engine and reported. It also makes staleness computable: without a
    concrete date there is nothing to compare a store's evidence against, and a four-month-old store reads
    as current.
    """
    return on or _dt.date.today().isoformat()


def net_worth(m: Manifest, *, on: str | None = None, our_pids: frozenset[int] = frozenset()) -> FamilyNetWorth:
    """Family net worth at one point in time, composed from each entity's own store."""
    if m.reporting_currency not in SUPPORTED_REPORTING_CURRENCIES:
        raise UnsupportedReportingCurrency(
            f"this engine can report in {', '.join(sorted(SUPPORTED_REPORTING_CURRENCIES))}, not "
            f"{m.reporting_currency}. WealthLens-core stores an INR-relative exchange rate, so another "
            "reporting currency would be an INR figure under a different label.")

    on = resolve_date(on)
    views = tuple(_entity_view(e, on=on, currency=m.reporting_currency, our_pids=our_pids)
                  for e in m.entities)
    contributing = [v.total for v in views if v.contributes]
    return FamilyNetWorth(
        as_of=on,
        reporting_currency=m.reporting_currency,
        total=money.total(contributing),
        entities=views,
    )


def _entity_view(entity: Entity, *, on: str | None, currency: str,
                 our_pids: frozenset[int]) -> EntityView:
    statuses = tuple(workspaces.check_entity(entity, our_pids=our_pids))
    readable = [s for s in statuses if s.is_readable]
    if not readable:
        return EntityView(entity.id, entity.label, entity.owner, statuses,
                          excluded_reason=_why_excluded(statuses))

    from wealthlens import workspace as wl_workspace

    totals, classes, evidence, warning = [], [], [], None
    for status in readable:
        with wl_workspace.resolve(status.path).open() as con:
            # Check the owner BEFORE trusting any figure: a mismatch produces zeroes, not errors.
            declared = lens_api.owner_entities(con)
            if declared and entity.owner not in declared:
                warning = (
                    f"{status.label} attributes ownership to {', '.join(sorted(declared))}, but this "
                    f"entity is configured as {entity.owner!r}. Every owned instrument would be valued at "
                    "zero, so no total is reported for it. Set `owner` for this entity in family.toml.")
                continue
            rows = lens_api.net_worth_by_class(con, on=on, owner=entity.owner, currency=currency)
            classes.extend(rows)
            totals.extend(r["value"] for r in rows)
            evidence.append(lens_api.evidence_as_of(con))

    if warning and not totals:
        return EntityView(entity.id, entity.label, entity.owner, statuses,
                          excluded_reason="ownership is misconfigured", owner_warning=warning)

    dated = [d for d in evidence if d]
    return EntityView(
        entity_id=entity.id,
        label=entity.label,
        owner=entity.owner,
        workspaces=statuses,
        total=money.total(totals) or money.Money(Decimal("0"), currency),
        by_class=tuple(classes),
        # The OLDEST across an entity's workspaces: a person is only as current as their stalest store.
        evidence_as_of=min(dated) if dated else None,
        owner_warning=warning,
    )


def _why_excluded(statuses: tuple[WorkspaceStatus, ...]) -> str:
    """One sentence a reader can act on, naming the actual condition rather than "no data"."""
    if not statuses:
        return "no workspace declared"
    reasons = {s.availability for s in statuses}
    for availability, sentence in (
        (Availability.NO_ENGINE, "WealthLens-core is not installed, so no store can be read"),
        (Availability.BUSY, "the store is in use and could not be opened"),
        (Availability.SCHEMA_SKEW, "the store was built by a different engine — rebuild and promote it"),
        (Availability.MISSING, "the store is missing"),
        (Availability.UNREADABLE, "the store could not be opened"),
    ):
        if availability in reasons:
            detail = next((s.detail for s in statuses if s.availability is availability and s.detail), None)
            return f"{sentence}" + (f" ({detail})" if detail else "")
    return "unavailable"


# ── finer granularities ──────────────────────────────────────────────────────────────────────────────
# Granularity is enforced by the TYPE returned, not by a caller remembering to narrow. An aggregate answer
# has nowhere to put an instrument row, so "an aggregate request cannot leak positions" is true by
# construction rather than by discipline (bridge-api).

@dataclasses.dataclass(frozen=True)
class EntityRows:
    """One entity's rows at a finer granularity, with the same availability honesty as a total."""

    entity_id: str
    label: str
    rows: tuple[dict, ...] = ()
    evidence_as_of: str | None = None
    excluded_reason: str | None = None
    owner_warning: str | None = None

    @property
    def contributes(self) -> bool:
        return self.excluded_reason is None


@dataclasses.dataclass(frozen=True)
class FamilyRows:
    granularity: Granularity
    as_of: str | None
    reporting_currency: str
    entities: tuple[EntityRows, ...]

    @property
    def excluded(self) -> tuple[EntityRows, ...]:
        return tuple(e for e in self.entities if not e.contributes)

    @property
    def is_partial(self) -> bool:
        return bool(self.excluded)

    def rows(self) -> list[dict]:
        """Every contributing entity's rows, each tagged with whose it is — attribution survives the merge."""
        return [{**row, "entity_id": e.entity_id, "entity_label": e.label}
                for e in self.entities if e.contributes for row in e.rows]


def positions(m: Manifest, *, on: str | None = None, our_pids: frozenset[int] = frozenset()) -> FamilyRows:
    """Instrument-level holdings across the family."""
    on = resolve_date(on)
    return _rows(m, Granularity.POSITIONS, on=on, our_pids=our_pids,
                 fetch=lambda con, entity: lens_api.positions(
                     con, on=on, owner=entity.owner, currency=m.reporting_currency))


def transactions(m: Manifest, *, since: str | None = None, until: str | None = None,
                 our_pids: frozenset[int] = frozenset()) -> FamilyRows:
    """Ledger-level rows across the family — the finest granularity there is."""
    return _rows(m, Granularity.TRANSACTIONS, on=resolve_date(until), our_pids=our_pids,
                 fetch=lambda con, entity: lens_api.transactions(
                     con, since=since, until=until, currency=m.reporting_currency))


def _rows(m: Manifest, granularity: Granularity, *, on: str | None,
          our_pids: frozenset[int], fetch) -> FamilyRows:
    if m.reporting_currency not in SUPPORTED_REPORTING_CURRENCIES:
        raise UnsupportedReportingCurrency(
            f"this engine can report in {', '.join(sorted(SUPPORTED_REPORTING_CURRENCIES))}, not "
            f"{m.reporting_currency}.")

    from wealthlens import workspace as wl_workspace

    views = []
    for entity in m.entities:
        statuses = tuple(workspaces.check_entity(entity, our_pids=our_pids))
        readable = [s for s in statuses if s.is_readable]
        if not readable:
            views.append(EntityRows(entity.id, entity.label, excluded_reason=_why_excluded(statuses)))
            continue

        rows, evidence, warning = [], [], None
        for status in readable:
            with wl_workspace.resolve(status.path).open() as con:
                declared = lens_api.owner_entities(con)
                if declared and entity.owner not in declared:
                    warning = (
                        f"{status.label} attributes ownership to {', '.join(sorted(declared))}, but this "
                        f"entity is configured as {entity.owner!r}; its rows would be valued at zero.")
                    continue
                rows.extend(fetch(con, entity))
                evidence.append(lens_api.evidence_as_of(con))

        if warning and not rows:
            views.append(EntityRows(entity.id, entity.label, excluded_reason="ownership is misconfigured",
                                    owner_warning=warning))
            continue
        dated = [d for d in evidence if d]
        views.append(EntityRows(entity.id, entity.label, rows=tuple(rows),
                                evidence_as_of=min(dated) if dated else None, owner_warning=warning))

    return FamilyRows(granularity, on, m.reporting_currency, tuple(views))
