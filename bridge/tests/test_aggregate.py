"""Family aggregation, over real stores, with no server and no browser.

Each test builds an actual encrypted store at the engine's real schema and asks the real question. The ones
that matter most are the failures: what a total does when a part of it is missing, stale, busy, or valued
for the wrong person. A number that is quietly smaller is the defect this whole capability exists to avoid.
"""
from __future__ import annotations

import dataclasses
from decimal import Decimal

import pytest

from wealthlens_web.core import aggregate, manifest, money, workspaces
from wealthlens_web.core.workspaces import Availability


def _manifest(*entries: str, reporting: str = "INR") -> manifest.Manifest:
    body = f'[family]\nlabel = "T"\nreporting_currency = "{reporting}"\n' + "\n".join(entries)
    return manifest.parse(body)


def _entity(eid: str, path, *, owner: str | None = None, label: str | None = None) -> str:
    out = f'\n[[entity]]\nid = "{eid}"\nlabel = "{label or eid}"\nworkspace = "{path}"\n'
    return out + (f'owner = "{owner}"\n' if owner else "")


# ── the happy path ───────────────────────────────────────────────────────────────────────────────────

def test_two_entities_compose_into_one_total(make_workspace):
    a = make_workspace("alpha", {"A Share": 1000})
    b = make_workspace("beta", {"B Share": 2500})
    m = _manifest(_entity("alpha", a), _entity("beta", b))

    got = aggregate.net_worth(m, on="2026-07-31")

    assert got.total == money.Money(Decimal("3500.00"), "INR")
    assert not got.is_partial and not got.excluded
    assert {e.entity_id for e in got.entities} == {"alpha", "beta"}


def test_every_part_stays_attributable(make_workspace):
    """"Whose is this?" must always be answerable — the total decomposes into named entities."""
    a = make_workspace("alpha", {"A Share": 1000})
    b = make_workspace("beta", {"B Share": 2500})
    got = aggregate.net_worth(_manifest(_entity("alpha", a), _entity("beta", b)), on="2026-07-31")

    by_id = {e.entity_id: e for e in got.entities}
    assert by_id["alpha"].total == money.Money(Decimal("1000.00"), "INR")
    assert by_id["beta"].total == money.Money(Decimal("2500.00"), "INR")
    assert sum(e.total.amount for e in got.entities) == got.total.amount


def test_net_worth_by_class_sums_to_the_total(make_workspace):
    """net worth = Σ classes (the top derivation): the family class subtotals must foot to the total — the
    Overview headline made auditable. Regrouped from the members' own class subtotals, not recomputed, so it
    foots by construction; each carries a value and how it was valued."""
    a = make_workspace("alpha", {"A Share": 1000})
    b = make_workspace("beta", {"B Share": 2500})
    got = aggregate.net_worth(_manifest(_entity("alpha", a), _entity("beta", b)), on="2026-07-31")

    assert got.by_class, "there is a class breakdown"
    assert sum(c["value"].amount for c in got.by_class) == got.total.amount   # Σ classes == the headline
    assert all(c["value"] is not None and c["asset_class"] for c in got.by_class)


def test_an_entity_may_span_several_workspaces(make_workspace, tmp_path):
    current = make_workspace("cur", {"X": 400}, as_of="2026-06-30")
    legacy = make_workspace("leg", {"Y": 600}, as_of="2025-03-31")
    m = manifest.parse(f'''
[family]
reporting_currency = "INR"

[[entity]]
id = "parent"
workspaces = ["{current}", "{legacy}"]
''')
    got = aggregate.net_worth(m, on="2026-07-31")
    view = got.entities[0]
    assert view.total == money.Money(Decimal("1000.00"), "INR")
    # A person is only as current as their stalest store, so the OLDER date is the one reported.
    assert view.evidence_as_of == "2025-03-31"


def test_freshness_is_document_evidence_not_the_date_we_asked_for(make_workspace):
    """The trap: most valuation tiers echo the requested date back, so reading that reports every store
    as perfectly fresh."""
    a = make_workspace("alpha", {"A": 100}, as_of="2026-02-28")
    got = aggregate.net_worth(_manifest(_entity("alpha", a)), on="2026-07-31")
    assert got.entities[0].evidence_as_of == "2026-02-28"
    assert got.as_of == "2026-07-31", "the computation date and the evidence date are different facts"


# ── the failures, which are the point ────────────────────────────────────────────────────────────────

def test_a_missing_store_is_named_and_the_total_is_marked_partial(make_workspace, tmp_path):
    a = make_workspace("alpha", {"A Share": 1000})
    m = _manifest(_entity("alpha", a), _entity("ghost", tmp_path / "nowhere-WealthLens-data"))

    got = aggregate.net_worth(m, on="2026-07-31")

    assert got.total == money.Money(Decimal("1000.00"), "INR"), "the readable part is still shown"
    assert got.is_partial, "a total missing a declared entity must say so"
    assert [e.entity_id for e in got.excluded] == ["ghost"]
    assert "missing" in got.excluded[0].excluded_reason


def test_a_schema_skewed_store_is_excluded_with_the_way_back(make_workspace, downgrade_schema):
    """Uniform by construction: parts built under different engine semantics are never mixed (ADR-0017)."""
    a = make_workspace("alpha", {"A": 1000})
    b = make_workspace("beta", {"B": 2500})
    downgrade_schema(b, "3.7")

    got = aggregate.net_worth(_manifest(_entity("alpha", a), _entity("beta", b)), on="2026-07-31")

    assert got.total == money.Money(Decimal("1000.00"), "INR")
    assert [e.entity_id for e in got.excluded] == ["beta"]
    reason = got.excluded[0].excluded_reason
    assert "different engine" in reason and "rebuild" in reason.lower()
    assert got.excluded[0].workspaces[0].schema_version == "3.7"


def test_a_busy_store_is_excluded_as_busy_not_as_empty(make_workspace):
    """A locked store rendered as an empty table is indistinguishable from owning nothing."""
    from wealthlens import workspace as wl_workspace

    a = make_workspace("alpha", {"A": 1000})
    b = make_workspace("beta", {"B": 2500})
    # Same process, which is exactly the two-browser-tabs case: DuckDB words it differently and it must
    # still classify as busy rather than as a broken store.
    holder = wl_workspace.resolve(b).connect(read_only=False)
    try:
        got = aggregate.net_worth(_manifest(_entity("alpha", a), _entity("beta", b)), on="2026-07-31")
    finally:
        holder.close()

    assert [e.entity_id for e in got.excluded] == ["beta"]
    assert "in use" in got.excluded[0].excluded_reason
    assert got.excluded[0].workspaces[0].availability is Availability.BUSY


def test_a_lock_holder_is_only_called_ours_when_we_started_it(make_workspace):
    from wealthlens import workspace as wl_workspace

    b = make_workspace("beta", {"B": 1})
    holder = wl_workspace.resolve(b).connect(read_only=False)
    try:
        status = workspaces.check(b)
        assert status.availability is Availability.BUSY
        if status.holder is not None:                 # DuckDB names the holder on most platforms
            assert status.holder.ours is False, "a process we did not start is never claimed as ours"
            owned = workspaces.check(b, our_pids=frozenset({status.holder.pid}))
            assert owned.holder.ours is True
    finally:
        holder.close()


# ── the silent-zero hazard ───────────────────────────────────────────────────────────────────────────

def test_an_owner_mismatch_is_a_misconfiguration_not_a_total_of_zero(make_workspace):
    """WLC contributes ZERO for an instrument owned by someone else, with no error. Reporting that as an
    answer would be a wrong headline figure with nothing to notice."""
    a = make_workspace("alpha", {"A": 1000})
    dad = make_workspace("dad", {"A Property": 5000}, owner="dad")     # rows name 'dad', manifest says 'self'
    m = _manifest(_entity("alpha", a), _entity("dad", dad))            # owner defaults to "self"

    got = aggregate.net_worth(m, on="2026-07-31")

    excluded = {e.entity_id: e for e in got.excluded}
    assert "dad" in excluded
    assert excluded["dad"].total is None, "no total at all — zero would have been a lie"
    assert "valued at zero" in excluded["dad"].owner_warning
    assert "family.toml" in excluded["dad"].owner_warning, "say how to fix it"
    assert got.is_partial


def test_the_declared_owner_makes_the_same_store_readable(make_workspace):
    dad = make_workspace("dad", {"A Property": 5000}, owner="dad")
    m = _manifest(_entity("dad", dad, owner="dad"))

    got = aggregate.net_worth(m, on="2026-07-31")

    assert got.total == money.Money(Decimal("5000.00"), "INR")
    assert not got.is_partial and got.entities[0].owner_warning is None


def test_a_store_with_no_ownership_rows_needs_no_owner_configured(make_workspace):
    """The common single-person store: every instrument is implicitly wholly owned."""
    a = make_workspace("alpha", {"A": 1000})
    got = aggregate.net_worth(_manifest(_entity("alpha", a)), on="2026-07-31")
    assert got.total == money.Money(Decimal("1000.00"), "INR")


# ── currency ─────────────────────────────────────────────────────────────────────────────────────────

def test_a_reporting_currency_the_engine_cannot_pivot_to_is_refused(make_workspace):
    a = make_workspace("alpha", {"A": 1000})
    with pytest.raises(aggregate.UnsupportedReportingCurrency) as e:
        aggregate.net_worth(_manifest(_entity("alpha", a), reporting="GBP"), on="2026-07-31")
    assert "INR" in str(e.value), "name what IS supported, not just what isn't"


def test_every_figure_carries_its_currency(make_workspace):
    a = make_workspace("alpha", {"A": 1000})
    got = aggregate.net_worth(_manifest(_entity("alpha", a)), on="2026-07-31")
    assert got.total.currency == "INR"
    assert all(row["value"].currency == "INR" for row in got.entities[0].by_class)


def test_money_refuses_to_total_across_currencies():
    with pytest.raises(money.MixedCurrency) as e:
        money.total([money.Money(Decimal("1"), "INR"), money.Money(Decimal("1"), "USD")])
    assert e.value.currencies == ["INR", "USD"]


def test_nothing_to_add_is_not_zero():
    assert money.total([]) is None
    assert money.total([money.Money(Decimal("0"), "INR")]) == money.Money(Decimal("0"), "INR")


def test_money_without_a_currency_cannot_be_constructed():
    with pytest.raises(ValueError, match="without a currency"):
        money.Money(Decimal("1"), "")


# ── granularity ──────────────────────────────────────────────────────────────────────────────────────

def test_an_aggregate_answer_has_nowhere_to_put_a_position(make_workspace):
    """Enforced by the TYPE, not by a caller remembering to narrow: the aggregate result simply has no
    field an instrument row could travel in."""
    a = make_workspace("alpha", {"A Share": 1000})
    got = aggregate.net_worth(_manifest(_entity("alpha", a)), on="2026-07-31")
    fields = {f.name for f in dataclasses.fields(got)}
    assert "rows" not in fields and "positions" not in fields
    assert not hasattr(got, "rows")


def test_positions_are_instrument_level_and_stay_attributable(make_workspace):
    a = make_workspace("alpha", {"A Share": 1000})
    b = make_workspace("beta", {"B Share": 2500, "C Share": 500})
    got = aggregate.positions(_manifest(_entity("alpha", a), _entity("beta", b)), on="2026-07-31")

    assert got.granularity is aggregate.Granularity.POSITIONS
    rows = got.rows()
    assert len(rows) == 3
    assert {r["entity_id"] for r in rows} == {"alpha", "beta"}, "every row says whose it is"
    assert all(r["value"].currency == "INR" for r in rows)


def test_a_position_without_a_market_identifier_says_so(make_workspace):
    """A blank ISIN is the thing data-conventions forbids: a filter would both hide it and match it."""
    a = make_workspace("alpha", {"A Share": 1000})
    rows = aggregate.positions(_manifest(_entity("alpha", a)), on="2026-07-31").rows()
    kinds = {r["identifier"]["kind"] for r in rows}
    assert kinds <= {"isin", "none"}
    assert all("value" in r["identifier"] or r["identifier"]["kind"] == "none" for r in rows)


def test_transactions_are_the_finest_granularity_and_carry_signed_money(make_workspace):
    a = make_workspace("alpha", {"A Share": 1000}, as_of="2026-05-31")
    got = aggregate.transactions(_manifest(_entity("alpha", a)), since="2026-01-01", until="2026-12-31")
    assert got.granularity is aggregate.Granularity.TRANSACTIONS
    rows = got.rows()
    assert rows and all(r["amount"].currency == "INR" for r in rows)
    assert all("entity_id" in r for r in rows)


def test_an_unreadable_entity_is_excluded_at_every_granularity(make_workspace, tmp_path):
    """The honesty rules are not a property of the net-worth call — they hold wherever data is read."""
    a = make_workspace("alpha", {"A Share": 1000})
    m = _manifest(_entity("alpha", a), _entity("ghost", tmp_path / "nowhere-WealthLens-data"))
    for got in (aggregate.positions(m, on="2026-07-31"),
                aggregate.transactions(m, since="2026-01-01", until="2026-12-31")):
        assert got.is_partial
        assert [e.entity_id for e in got.excluded] == ["ghost"]
        assert all(r["entity_id"] != "ghost" for r in got.rows())


def test_an_owner_mismatch_excludes_rows_too_rather_than_showing_an_empty_list(make_workspace):
    dad = make_workspace("dad", {"A Property": 5000}, owner="dad")
    got = aggregate.positions(_manifest(_entity("dad", dad)), on="2026-07-31")
    assert got.is_partial and got.rows() == []
    assert "valued at zero" in got.excluded[0].owner_warning


def test_positions_carry_the_full_stored_projection(make_workspace):
    """WLC now returns the position's full projection (acquisition history, disposition, metadata); the
    bridge must widen with it, so a drill-down has the columns it needs rather than a WLC release each time."""
    a = make_workspace("alpha", {"A Share": 1000}, as_of="2026-05-31")
    rows = aggregate.positions(_manifest(_entity("alpha", a)), on="2026-07-31").rows()
    assert rows
    r = rows[0]
    # the drill-down key and the new columns are all present (plumbing), even where NULL for this store
    for c in ("instrument_id", "first_acquired_on", "last_acquired_on", "lots", "fills",
              "last_valued_on", "disposition", "closed_on", "subtype", "amfi_code", "jurisdiction"):
        assert c in r, f"positions row is missing {c}"
    assert r["instrument_id"] == "inst:alpha:0"        # the stable key a holding→history drill-down links on
    assert r["jurisdiction"] == "IN"                    # instruments.jurisdiction default flows through
    # a snapshot-only store has no acquiring events, so the acquisition columns are honestly NULL
    assert r["first_acquired_on"] is None and r["lots"] is None


# ── freshness and the charts are decided in the bridge, not the UI ──────────────────────────────────────

def test_status_and_stale_count_are_decided_by_the_bridge(make_workspace, tmp_path):
    """Deciding whether a store answers from stale evidence is a bridge concern (it moved out of Overview.tsx).
    Each entity carries a status, and the household stale count is reported — the UI only renders them."""
    fresh = make_workspace("fresh", {"A": 100}, as_of="2026-07-31")
    old = make_workspace("old", {"B": 200}, as_of="2026-02-28")
    m = _manifest(_entity("fresh", fresh), _entity("old", old),
                  _entity("ghost", tmp_path / "nowhere-WealthLens-data"))
    got = aggregate.net_worth(m, on="2026-07-31")
    by_id = {e.entity_id: e for e in got.entities}
    assert by_id["fresh"].status(got.as_of) == "ok"
    assert by_id["old"].status(got.as_of) == "stale"       # evidence 2026-02-28 < the view's 2026-07-31
    assert by_id["ghost"].status(got.as_of) == "excluded"  # unreadable — excluded, and NOT counted stale
    assert got.stale_count == 1


def test_performance_pre_sums_the_charts(make_workspace):
    """Every figure the charts show is computed here: the total, each share, and each band's stack edges.
    The UI must not have to add money to draw them (mixed-currency adds are impossible via money.total)."""
    a = make_workspace("alpha", {"A": 1000}, as_of="2026-06-30")
    got = aggregate.performance(_manifest(_entity("alpha", a)))

    # the donut total is the sum of positive buckets, and every bucket carries its share (percent)
    assert got.total == money.Money(Decimal("1000.00"), "INR")
    assert all("share" in b for b in got.breakup)
    assert round(sum(b["share"] for b in got.breakup), 0) == 100

    # the growth series is pre-summed: base+value == top on every point, and each date's stack starts at 0
    assert got.series, "a single valued holding still produces a growth point"
    by_date: dict = {}
    for p in got.series:
        assert p["top"].amount == p["base"].amount + p["value"].amount
        by_date.setdefault(p["date"], []).append(p)
    for points in by_date.values():
        assert points[0]["base"].amount == Decimal("0")

    # the axis ticks are money the UI prints verbatim — first is zero, last is the axis maximum
    if got.axis_max:
        assert got.axis_ticks[0].amount == Decimal("0")
        assert got.axis_ticks[-1].amount == got.axis_max.amount
        # the top tick sits at or above the peak stack, so every bar fits under it
        assert got.axis_max.amount >= Decimal("1000")


def test_performance_carries_the_honesty_envelope(make_workspace, tmp_path):
    """B2: the charts must NOT let an unreadable store vanish silently. A missing workspace is named in
    `excluded`, the charts are marked partial, and the provenance header says who was left out — exactly like
    net worth. `as_of` is the concrete date the breakup was valued at."""
    a = make_workspace("alpha", {"A": 1000})
    gone = tmp_path / "beta-WealthLens-data"       # declared but never built → unreadable
    got = aggregate.performance(_manifest(_entity("alpha", a), _entity("beta", gone)))

    assert got.is_partial is True
    assert [e.entity_id for e in got.excluded] == ["beta"]
    assert got.excluded[0].excluded_reason
    assert got.as_of == aggregate.resolve_date(None)
    # the contributing store still charts
    assert got.total == money.Money(Decimal("1000.00"), "INR")


def test_performance_excludes_a_wrongly_owned_store_rather_than_charting_zero(make_workspace):
    """An owner mismatch is a misconfiguration, not a portfolio of zero — the same rule net worth follows."""
    a = make_workspace("alpha", {"A": 1000}, owner="someone_else")
    got = aggregate.performance(_manifest(_entity("alpha", a, owner="alpha")))
    assert got.is_partial is True and [e.entity_id for e in got.excluded] == ["alpha"]
    assert got.excluded[0].owner_warning


def test_performance_publishes_the_asset_class_vocabulary(make_workspace):
    """B3: the class list is published from the engine, so the UI stops keeping its own copy. Every class
    carries a stable order (the colour rank) and its group/category."""
    a = make_workspace("alpha", {"A": 1000})
    got = aggregate.performance(_manifest(_entity("alpha", a)))
    classes = {c["asset_class"]: c for c in got.classes}
    assert "listed_equity" in classes and "real_estate" in classes and "credit_card" in classes
    assert classes["credit_card"]["category"] == "liability"
    orders = [c["order"] for c in got.classes]
    assert orders == sorted(orders) and len(set(orders)) == len(orders)  # a stable, distinct rank


def test_the_growth_line_reconciles_with_the_donut(make_workspace):
    """B1: the growth stack must not silently drop a class. Real estate is deliberately kept out of the stack
    (a lumpy mark, not a monthly value trend) — but it is REPORTED in `omitted` with its value, so the growth
    top-line and the donut reconcile: Σ(growth top at the last date) = total − Σ(omitted). A retirement or
    real-estate corpus can no longer make the growth headline disagree with the breakdown with no caveat."""
    a = make_workspace("alpha", {"Shares": 1000, "The house": 4000, "Mortgage": -600},
                       classes={"The house": "real_estate", "Mortgage": "home_loan"}, as_of="2026-06-30")
    got = aggregate.performance(_manifest(_entity("alpha", a)))

    # the donut total is the positive assets only (the liability nets against nothing in a value breakup)
    assert got.total == money.Money(Decimal("5000.00"), "INR")
    omitted = {o["asset_class"]: o for o in got.omitted}
    assert "real_estate" in omitted and omitted["real_estate"]["value"].amount == Decimal("4000.00")
    assert "market value" in omitted["real_estate"]["reason"]
    assert not any(p["asset_class"] == "real_estate" for p in got.series)  # deliberate omission, never stacked

    # a LIABILITY is never stacked into a value-over-time chart (WLC's value_series drops only some) — else it
    # would drag the top-line down as a negative band and the reconciliation below would break
    assert not any(p["asset_class"] == "home_loan" for p in got.series)

    # the reconciliation the omitted field exists to make visible: Σ(growth top) + Σ(omitted) = total
    last = max(p["date"] for p in got.series)
    top = max(p["top"].amount for p in got.series if p["date"] == last)
    omitted_sum = sum(o["value"].amount for o in got.omitted)
    assert top == got.total.amount - omitted_sum


def test_the_asset_class_vocabulary_is_not_triplicated(make_workspace):
    """B3: the class list lived in three places — the bridge's stack subset, the UI's `BUCKETS`, and the
    i18n `class.*` keys — and an engine that added a class silently fell out of the chart. Now the engine is
    the source: the bridge keeps only a deliberate OMIT set (which must be real classes), and the frontend
    must carry a label for every class the engine defines. This is the parity guard across the three surfaces."""
    import pathlib
    import re

    a = make_workspace("alpha", {"A": 1000})
    from wealthlens import workspace as wl_workspace
    from wealthlens_web.core import lens_api
    with wl_workspace.resolve(a).open() as con:
        codes = {c["asset_class"] for c in lens_api.asset_classes(con)}
    assert codes, "the engine defines an asset-class vocabulary"

    # the bridge's deliberate-omit set is real classes, never a typo that silently omits nothing
    assert set(aggregate._NOT_A_GROWTH_SERIES) <= codes

    # the frontend carries a label for every engine class (a new class shows a name, not its raw code)
    en = (pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src" / "i18n" / "en.ts").read_text()
    labelled = set(re.findall(r'"class\.([a-z_]+)"', en))
    missing = codes - labelled
    assert not missing, f"frontend i18n has no class.* label for: {sorted(missing)}"


def test_the_growth_axis_snaps_to_round_gridlines():
    """The reported eyesore: a ₹11.96L peak drew ticks at 0 / 5.98 / 11.96. The axis now rounds each step to a
    human figure, so the three gridlines read round (0 / 6L / 12L) and the top still clears the peak."""
    from wealthlens_web.core.aggregate import _nice_axis_step
    assert _nice_axis_step(Decimal("598000")) == Decimal("600000")   # ½ of 11.96L → a 6L step (axis 12L)
    assert _nice_axis_step(Decimal("1000000")) == Decimal("1000000")  # already round → unchanged
    assert _nice_axis_step(Decimal("110000")) == Decimal("150000")   # 1.1L → 1.5L
    assert _nice_axis_step(Decimal("0")) == Decimal("0")             # a flat/empty chart has no axis
    # rounds UP, never down — the peak must never overflow the top gridline
    for raw in ("1", "99", "12345", "9070000"):
        assert _nice_axis_step(Decimal(raw)) >= Decimal(raw)
