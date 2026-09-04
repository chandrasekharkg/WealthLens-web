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
    CARDS = "cards"
    CARD_PAYMENTS = "card_payments"
    FAMILY = "family"


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

    def status(self, as_of: str | None) -> str:
        """ok | stale | excluded — whether this entity is trustworthy AT `as_of`. Deciding freshness is a
        bridge concern, not the UI's: a store answering from evidence older than the date the view was
        computed at is 'stale'. `as_of` is always concrete (resolve_date), so the comparison is real."""
        if not self.contributes:
            return "excluded"
        if as_of and self.evidence_as_of and self.evidence_as_of < as_of:
            return "stale"
        return "ok"


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
    def stale_count(self) -> int:
        """How many included entities answer from evidence older than the view's date."""
        return sum(1 for e in self.entities if e.status(self.as_of) == "stale")

    @property
    def is_partial(self) -> bool:
        """True when the total is missing a declared entity — the caveat that must never be dropped."""
        return bool(self.excluded)

    @property
    def by_class(self) -> tuple[dict, ...]:
        """Family net worth broken down by asset class — Σ over CONTRIBUTING members of each member's class
        subtotals (regrouped, not recomputed), so it sums to `total` by construction. This is the top
        derivation, `net worth = Σ classes`: the Overview headline made auditable (a class → its holdings →
        a holding's value = qty × price → the quantity → the events). Largest magnitude first, so assets lead
        and a small liability trails; deterministic."""
        agg: dict[str, dict] = {}
        for e in self.entities:
            if not e.contributes:
                continue
            for c in e.by_class:
                slot = agg.setdefault(c["asset_class"],
                                      {"asset_class": c["asset_class"], "values": [], "bases": set()})
                slot["values"].append(c["value"])
                if c.get("basis"):
                    slot["bases"].add(c["basis"])
        out = [{"asset_class": k, "value": money.total(s["values"]),
                "basis": "+".join(sorted(s["bases"])) or None} for k, s in agg.items()]
        out.sort(key=lambda c: abs(float(c["value"].amount)) if c["value"] else 0.0, reverse=True)
        return tuple(out)


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


def cards(m: Manifest, *, our_pids: frozenset[int] = frozenset()) -> FamilyRows:
    """Every credit card across the family, each row tagged with whose store it came from. Cards are a household
    liability rather than an owned instrument, so — unlike positions — no owner filter is applied."""
    return _rows(m, Granularity.CARDS, on=resolve_date(None), our_pids=our_pids,
                 fetch=lambda con, entity: lens_api.cards(con, currency=m.reporting_currency))


def family_transfers(m: Manifest, *, our_pids: frozenset[int] = frozenset()) -> FamilyRows:
    """Money moved to household members, across the family's stores — each row tagged with the SENDING store's
    entity, while `member_id` names the recipient. Not owner-scoped (whose bank account paid is the store)."""
    return _rows(m, Granularity.FAMILY, on=resolve_date(None), our_pids=our_pids,
                 fetch=lambda con, entity: lens_api.family_transfers(con, currency=m.reporting_currency))


def card_bill_payments(m: Manifest, *, our_pids: frozenset[int] = frozenset()) -> FamilyRows:
    """The credit-card bill payments across the family — the bank→card drill-down. Each row is a bank debit
    that settled a card, tagged with whose store it came from and, where the card is loaded, its drill
    target. Not owner-scoped (a card is a household liability), same as cards()."""
    return _rows(m, Granularity.CARD_PAYMENTS, on=resolve_date(None), our_pids=our_pids,
                 fetch=lambda con, entity: lens_api.card_bill_payments(con, currency=m.reporting_currency))


# Real estate and other lumpy, manually-marked assets are deliberately kept OUT of the growth stack — a
# purchase figure is not a monthly value trend. But they are no longer dropped SILENTLY (the bug B1): every
# such class is reported in `omitted` with its reason and its current value, so the growth top-line
# reconciles with the donut, which does include them. Every OTHER asset class the engine values is stacked,
# and the stack order comes from the published vocabulary (lens_api.asset_classes), not a hand-kept subset
# here — so an engine that adds a class (a retirement corpus, crypto) appears in the chart, not vanishes.
_NOT_A_GROWTH_SERIES = {
    "real_estate": "a lumpy purchase mark, not a monthly market value",
    "personal_property": "a manual mark, not a monthly market value",
}

# The human axis-step ladder: a rough step rounds UP to the smallest of these × 10ⁿ. Half-steps stay clean too
# (½·6 = 3, ½·2.5 = 1.25), so a 3-tick axis reads round both at the top and the middle.
_NICE_STEPS = (Decimal("1"), Decimal("1.5"), Decimal("2"), Decimal("2.5"), Decimal("3"),
               Decimal("4"), Decimal("5"), Decimal("6"), Decimal("8"))


def _nice_axis_step(raw: Decimal) -> Decimal:
    """Round a rough axis step UP to a human 'nice' figure (see _NICE_STEPS). Pure Decimal — no float — so a
    ₹-crore axis is chosen exactly rather than through a lossy log."""
    if raw <= 0:
        return Decimal("0")
    mag = Decimal("1")
    while mag * 10 <= raw:          # largest power of ten ≤ raw
        mag *= 10
    while mag > raw:                # sub-unit raw (not expected on a ₹ axis, but keep the function total)
        mag /= 10
    frac = raw / mag
    for nice in _NICE_STEPS:
        if frac <= nice:
            return nice * mag
    return Decimal("10") * mag


@dataclasses.dataclass(frozen=True)
class FamilyPerformance:
    """The portfolio charts, carrying the same availability honesty a total or a row set does. An entity that
    could not be read, or is owned by somebody else, is NAMED in `entities`/`excluded` and the charts are
    marked partial — never silently smaller (B2: `/api/performance` had no envelope, so an unreadable store
    vanished from both charts with no signal). The breakup/series/axis are pre-summed for the UI, and
    `omitted` reconciles the growth top-line with the donut (B1). `classes` is the published vocabulary the UI
    colours and labels from (B3)."""

    as_of: str
    reporting_currency: str
    total: money.Money | None
    breakup: tuple[dict, ...]
    series: tuple[dict, ...]
    axis_max: money.Money | None
    axis_ticks: tuple[money.Money, ...]
    omitted: tuple[dict, ...]
    classes: tuple[dict, ...]
    entities: tuple[EntityRows, ...]

    @property
    def excluded(self) -> tuple[EntityRows, ...]:
        return tuple(e for e in self.entities if not e.contributes)

    @property
    def is_partial(self) -> bool:
        return bool(self.excluded)


def performance(m: Manifest, *, on: str | None = None, our_pids: frozenset[int] = frozenset(),
                months: int = 60) -> FamilyPerformance:
    """The household portfolio, for the charts: the current value BREAKUP by asset class, and a monthly value
    SERIES per class. Both summed across the family's READABLE stores — and, exactly like net worth, an entity
    that is unreadable or owned by somebody else is excluded and NAMED rather than dropped, and `on` fixes the
    point in time the breakup is valued at. The breakup is owner-weighted (net worth per class); the series is
    the portfolio's asset value over time (unweighted — a value trend, not a beneficial-share total)."""
    if m.reporting_currency not in SUPPORTED_REPORTING_CURRENCIES:
        raise UnsupportedReportingCurrency(
            f"this engine can report in {', '.join(sorted(SUPPORTED_REPORTING_CURRENCIES))}, not "
            f"{m.reporting_currency}.")

    from collections import defaultdict

    from wealthlens import workspace as wl_workspace

    on = resolve_date(on)
    ccy = m.reporting_currency
    zero = money.Money(Decimal("0"), ccy)

    breakup: dict[str, list] = defaultdict(list)
    series: dict[tuple[str, str], list] = defaultdict(list)
    classes: tuple[dict, ...] = ()
    entities: list[EntityRows] = []

    for entity in m.entities:
        statuses = tuple(workspaces.check_entity(entity, our_pids=our_pids))
        readable = [s for s in statuses if s.is_readable]
        if not readable:
            entities.append(EntityRows(entity.id, entity.label, excluded_reason=_why_excluded(statuses)))
            continue

        contributed, evidence, warning = False, [], None
        for status in readable:
            with wl_workspace.resolve(status.path).open() as con:
                declared = lens_api.owner_entities(con)
                if declared and entity.owner not in declared:
                    warning = (
                        f"{status.label} attributes ownership to {', '.join(sorted(declared))}, but this "
                        f"entity is configured as {entity.owner!r}; its holdings would be valued at zero.")
                    continue
                if not classes:                     # the vocabulary is seed data — read it once, from any store
                    classes = tuple(lens_api.asset_classes(con))
                for row in lens_api.net_worth_by_class(con, on=on, owner=entity.owner, currency=ccy):
                    breakup[row["asset_class"]].append(row["value"])
                for row in lens_api.value_series(con, currency=ccy, owner=entity.owner, months=months, until=on):
                    series[(row["date"], row["asset_class"])].append(row["value"])
                evidence.append(lens_api.evidence_as_of(con))
                contributed = True

        if warning and not contributed:
            entities.append(EntityRows(entity.id, entity.label, excluded_reason="ownership is misconfigured",
                                       owner_warning=warning))
            continue
        dated = [d for d in evidence if d]
        entities.append(EntityRows(entity.id, entity.label,
                                   evidence_as_of=min(dated) if dated else None, owner_warning=warning))

    # ── the breakup (donut): value + the SHARE, so the UI never divides money to get a percent ──
    breakup_vals = {k: (money.total(v) or zero) for k, v in breakup.items()}
    donut_total = money.total([mv for mv in breakup_vals.values() if mv.amount > 0])  # positive buckets only
    total_amt = donut_total.amount if donut_total else Decimal("0")
    breakup_rows = sorted(
        ({"asset_class": k, "value": mv,
          "share": float(round(100 * mv.amount / total_amt, 1)) if total_amt > 0 and mv.amount > 0 else 0.0}
         for k, mv in breakup_vals.items()),
        key=lambda r: r["value"].amount, reverse=True)

    # ── the growth chart: the stack is PRE-SUMMED here (base/top per band) so the UI only maps value→pixel.
    #    Membership + order come from the published vocabulary — every ASSET class is stacked (nothing dropped
    #    silently, finding B1), minus the deliberately-omitted lumpy ones. LIABILITIES are excluded by their
    #    `category`, because this chart is asset VALUE over time, not net worth — and WLC's value_series drops
    #    only credit_card/payable, so the loan classes would otherwise stack as negative bands (a real bug the
    #    synthetic family surfaced). An unknown-to-the-vocabulary class is stacked rather than hidden. ──
    info = {c["asset_class"]: c for c in classes}
    is_liability = lambda c: info.get(c, {}).get("category") == "liability"   # noqa: E731
    val = {(d, c): (money.total(v) or zero) for (d, c), v in series.items()}
    dates = sorted({d for (d, _c) in val if d})
    present = {c for (_d, c) in val}
    stacked = sorted((c for c in present if not is_liability(c) and c not in _NOT_A_GROWTH_SERIES),
                     key=lambda c: (info.get(c, {}).get("order", len(info)), c))
    series_rows, date_total = [], {}
    for d in dates:
        running = Decimal("0")
        for c in stacked:
            v = val.get((d, c), zero).amount
            base, running = running, running + v
            series_rows.append({"date": d, "asset_class": c, "value": money.Money(v, ccy),
                                "base": money.Money(base, ccy), "top": money.Money(running, ccy)})
        date_total[d] = running
    axis_amt = max(date_total.values(), default=Decimal("0"))
    if axis_amt > 0:
        # Round to a human axis: pick a NICE step (≥ half the peak) so the three gridlines land on round
        # figures — 0 / 6L / 12L, not 0 / 5.98 / 11.96. The top tick (2·step) sits at or above the peak, so
        # every stacked bar still fits under it.
        step = _nice_axis_step(axis_amt / 2)
        axis_max = money.Money(step * 2, ccy)
        axis_ticks = [money.Money(step * Decimal(i), ccy) for i in (0, 1, 2)]
    else:
        axis_max, axis_ticks = None, []

    # ── omitted (B1): every positive DONUT class the growth line leaves out — the deliberate ones (real
    #    estate & co.) with their reason, and any class with no series in the window — each with its value, so
    #    a reader can see the top-line reconciles: Σ(growth top at the last date) = total − Σ(omitted). ──
    stacked_set = set(stacked)
    omitted = [
        {"asset_class": r["asset_class"],
         "reason": _NOT_A_GROWTH_SERIES.get(r["asset_class"], "no monthly value series in this window"),
         "value": r["value"]}
        for r in breakup_rows if r["value"].amount > 0 and r["asset_class"] not in stacked_set
    ]

    return FamilyPerformance(
        as_of=on, reporting_currency=ccy, total=donut_total, breakup=tuple(breakup_rows),
        series=tuple(series_rows), axis_max=axis_max, axis_ticks=tuple(axis_ticks),
        omitted=tuple(omitted), classes=classes, entities=tuple(entities))


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
