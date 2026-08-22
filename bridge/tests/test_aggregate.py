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

    assert got.total == money.Money(Decimal("3500"), "INR")
    assert not got.is_partial and not got.excluded
    assert {e.entity_id for e in got.entities} == {"alpha", "beta"}


def test_every_part_stays_attributable(make_workspace):
    """"Whose is this?" must always be answerable — the total decomposes into named entities."""
    a = make_workspace("alpha", {"A Share": 1000})
    b = make_workspace("beta", {"B Share": 2500})
    got = aggregate.net_worth(_manifest(_entity("alpha", a), _entity("beta", b)), on="2026-07-31")

    by_id = {e.entity_id: e for e in got.entities}
    assert by_id["alpha"].total == money.Money(Decimal("1000"), "INR")
    assert by_id["beta"].total == money.Money(Decimal("2500"), "INR")
    assert sum(e.total.amount for e in got.entities) == got.total.amount


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
    assert view.total == money.Money(Decimal("1000"), "INR")
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

    assert got.total == money.Money(Decimal("1000"), "INR"), "the readable part is still shown"
    assert got.is_partial, "a total missing a declared entity must say so"
    assert [e.entity_id for e in got.excluded] == ["ghost"]
    assert "missing" in got.excluded[0].excluded_reason


def test_a_schema_skewed_store_is_excluded_with_the_way_back(make_workspace, downgrade_schema):
    """Uniform by construction: parts built under different engine semantics are never mixed (ADR-0017)."""
    a = make_workspace("alpha", {"A": 1000})
    b = make_workspace("beta", {"B": 2500})
    downgrade_schema(b, "3.7")

    got = aggregate.net_worth(_manifest(_entity("alpha", a), _entity("beta", b)), on="2026-07-31")

    assert got.total == money.Money(Decimal("1000"), "INR")
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

    assert got.total == money.Money(Decimal("5000"), "INR")
    assert not got.is_partial and got.entities[0].owner_warning is None


def test_a_store_with_no_ownership_rows_needs_no_owner_configured(make_workspace):
    """The common single-person store: every instrument is implicitly wholly owned."""
    a = make_workspace("alpha", {"A": 1000})
    got = aggregate.net_worth(_manifest(_entity("alpha", a)), on="2026-07-31")
    assert got.total == money.Money(Decimal("1000"), "INR")


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
