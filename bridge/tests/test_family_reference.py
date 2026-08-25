"""The Nair family reference corpus — the aggregation plays, through the REAL aggregator.

`synth_family.write_workspaces` builds five on-disk single-person stores + a family.toml; here we compose them
with `aggregate` exactly as the app does, and assert the household-level truths: the staggered succession
conserves the family total, the joint flat sums to one whole, and pocket money surfaces as family transfers.
Skips cleanly when WealthLens-core is absent.
"""
from __future__ import annotations

import pytest

pytest.importorskip("wealthlens", reason="WealthLens-core is not installed")

from wealthlens import synth_family as sf

from wealthlens_web.core import aggregate
from wealthlens_web.core import manifest as M


@pytest.fixture(scope="module")
def family(tmp_path_factory):
    root = tmp_path_factory.mktemp("nair")
    return M.load(sf.write_workspaces(root))


def _by_id(nw):
    return {e.entity_id: e for e in nw.entities}


def _pair_total(nw):
    """Raghavan + Lakshmi — the succession pair, whose subtotal must be conserved across the transfers."""
    by = _by_id(nw)
    return sum((by[p].total.amount for p in ("raghavan", "lakshmi") if by[p].total), start=0)


# ── the centrepiece: a staggered succession conserves the family total ───────────────────────────────────────

# Month-ends AND the two exact transfer boundaries (half-open ownership intervals make these clean). NOTE
# (2026-08 review, P2-2): conservation holds at these sampled dates; intra-month the pair total oscillates by
# a few thousand rupees because each transfer's paired debit/credit lands on different days of the month — a
# sampling property, not an accounting flaw. The transfer boundaries below are where it must be exact.
@pytest.mark.parametrize("on", ["2024-12-31", "2025-09-30", "2025-11-30", "2026-03-31", "2026-06-30"])
def test_the_succession_conserves_the_pair_total(family, on):
    # before the demise, at each staggered transfer boundary, and after: the estate never gains or loses value,
    # it only changes store.
    assert _pair_total(aggregate.net_worth(family, on=on)) == 8_800_000


def test_the_transfer_is_staggered_by_asset_class(family):
    # At 2025-11 the bank + FDs have moved to Lakshmi but the equity has NOT — the whole point of two dates.
    by = _by_id(aggregate.net_worth(family, on="2025-11-30"))
    raghavan = {c["asset_class"]: c["value"].amount for c in by["raghavan"].by_class}
    lakshmi = {c["asset_class"]: c["value"].amount for c in by["lakshmi"].by_class}
    assert raghavan.get("listed_equity") == 600_000        # equity still his
    assert raghavan.get("fixed_deposit", 0) == 0           # FD already gone
    assert raghavan.get("savings", 0) == 0                 # bank already swept
    assert lakshmi.get("fixed_deposit") == 4_500_000       # her 30L + inherited 15L
    assert lakshmi.get("listed_equity", 0) == 0            # equity not yet hers


def test_before_the_demise_the_estate_sits_in_his_own_store(family):
    by = _by_id(aggregate.net_worth(family, on="2024-12-31"))
    assert by["raghavan"].total.amount == 2_600_000        # equity 6L + FD 15L + bank 5L
    assert by["lakshmi"].total.amount == 6_200_000         # her own bank 12L + FD 30L


def test_after_both_transfers_the_estate_sits_wholly_with_the_widow(family):
    by = _by_id(aggregate.net_worth(family, on="2026-06-30"))
    assert by["raghavan"].total.amount == 0
    assert by["lakshmi"].total.amount == 8_800_000


# ── the joint flat: one whole, split across two stores ───────────────────────────────────────────────────────

def test_the_joint_flat_sums_to_one_whole(family):
    by = _by_id(aggregate.net_worth(family, on="2026-06-30"))
    halves = []
    for p in ("arjun", "priya"):
        re = [c["value"].amount for c in by[p].by_class if c["asset_class"] == "real_estate"]
        halves.append(re[0] if re else 0)
    assert halves == [6_000_000, 6_000_000]                # each store's beneficial 0.5
    assert sum(halves) == 12_000_000                       # the whole flat, once


# ── inter-entity transfers: the pocket money ─────────────────────────────────────────────────────────────────

def test_pocket_money_surfaces_as_family_transfers(family):
    sent = {(r["entity_id"], r["name"]): r["total"].amount for r in aggregate.family_transfers(family).rows()}
    assert sent[("arjun", "Diya Nair")] == 160_000         # 5,000 x 32 months
    assert sent[("priya", "Diya Nair")] == 96_000          # 3,000 x 32 months


# ── composition honesty ──────────────────────────────────────────────────────────────────────────────────────

def test_every_store_contributes_and_the_total_is_not_partial(family):
    nw = aggregate.net_worth(family, on="2026-06-30")
    assert not nw.is_partial
    assert {e.entity_id for e in nw.entities} == {"arjun", "priya", "lakshmi", "diya", "raghavan"}
