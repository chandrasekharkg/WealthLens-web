"""The header that travels with an artifact.

Composed in `core/` because a header is a set of CLAIMS about the data, and claims belong where a plain
function call can assert them. These tests are the assertions.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from wealthlens_web.api.app import create_app
from wealthlens_web.core import aggregate, manifest, provenance

HOST = "127.0.0.1:7788"


def _manifest(*entries: str) -> manifest.Manifest:
    return manifest.parse('[family]\nreporting_currency = "INR"\n' + "\n".join(entries))


def _entity(eid: str, path, *, label: str | None = None) -> str:
    return f'\n[[entity]]\nid = "{eid}"\nlabel = "{label or eid}"\nworkspace = "{path}"\n'


def test_a_single_entity_scope_names_the_person(make_workspace):
    a = make_workspace("alpha", {"A": 1000})
    got = aggregate.net_worth(_manifest(_entity("alpha", a, label="Me")), on="2026-07-31")
    p = provenance.for_net_worth(got)
    assert p.scope == "Me"
    assert p.as_of == "2026-07-31" and p.reporting_currency == "INR"


def test_a_family_scope_counts_the_members(make_workspace):
    a = make_workspace("alpha", {"A": 1000})
    b = make_workspace("beta", {"B": 2000})
    got = aggregate.net_worth(_manifest(_entity("alpha", a), _entity("beta", b)), on="2026-07-31")
    assert provenance.for_net_worth(got).scope == "Family (2 members)"


def test_an_incomplete_family_says_so_in_the_scope_itself(make_workspace, tmp_path):
    """A reader who never saw the app must be able to tell the artifact is missing somebody."""
    a = make_workspace("alpha", {"A": 1000})
    got = aggregate.net_worth(
        _manifest(_entity("alpha", a), _entity("ghost", tmp_path / "nowhere-WealthLens-data")),
        on="2026-07-31")
    p = provenance.for_net_worth(got)
    assert p.scope == "Family (1 of 2 members)"
    assert any("Excludes ghost" in w for w in p.warnings)


def test_stale_evidence_is_a_separate_warning_from_an_exclusion(make_workspace):
    """Two different facts, deliberately not merged: one entity is MISSING from the figure, another is IN
    it but answering from older evidence. A shared computation date fixes neither."""
    fresh = make_workspace("fresh", {"A": 1000}, as_of="2026-07-30")
    stale = make_workspace("stale", {"B": 2000}, as_of="2026-02-28")
    got = aggregate.net_worth(_manifest(_entity("fresh", fresh), _entity("stale", stale)), on="2026-07-31")
    warnings = provenance.for_net_worth(got).warnings

    assert any("stale: evidence only to 2026-02-28" in w for w in warnings)
    assert not any("Excludes" in w for w in warnings), "it is included — just not current"


def test_current_evidence_produces_no_warning(make_workspace):
    a = make_workspace("alpha", {"A": 1000}, as_of="2026-07-31")
    got = aggregate.net_worth(_manifest(_entity("alpha", a)), on="2026-07-31")
    assert provenance.for_net_worth(got).warnings == ()


def test_a_family_artifact_carries_ONE_date_not_a_list(make_workspace):
    """The mixed-scope problem. Point-in-time aggregation is what makes a single date honest — every store
    answered at the same chosen date — so the header states it once (ADR-0016)."""
    a = make_workspace("alpha", {"A": 1000}, as_of="2026-01-31")
    b = make_workspace("beta", {"B": 2000}, as_of="2026-06-30")
    got = aggregate.net_worth(_manifest(_entity("alpha", a), _entity("beta", b)), on="2026-07-31")
    p = provenance.for_net_worth(got)
    assert p.as_of == "2026-07-31"
    assert isinstance(p.as_of, str), "one date, not a collection of competing ones"
    assert len(p.warnings) == 2, "and both stores' coverage is stated separately"


def test_rows_carry_their_filters_and_a_row_count(make_workspace):
    a = make_workspace("alpha", {"A": 1000, "B": 2000})
    got = aggregate.positions(_manifest(_entity("alpha", a)), on="2026-07-31")
    p = provenance.for_rows(got, filters=("class in (equity)",))
    assert p.title == "Positions"
    assert p.row_count == 2
    assert p.filters == ("class in (equity)",)


# ── it reaches the client ────────────────────────────────────────────────────────────────────────────

@pytest.fixture()
def client(tmp_path, make_workspace):
    a = make_workspace("alpha", {"A Share": 1000})
    mf = tmp_path / "family.toml"
    mf.write_text(f'[family]\nreporting_currency = "INR"\n\n[[entity]]\nid = "alpha"\nworkspace = "{a}"\n')
    return TestClient(create_app(mf, token="t"), headers={"host": HOST})


def test_every_read_response_carries_its_provenance(client):
    """Export and print are properties of the shipped components, so the header must be on the data they
    are given — not fetched separately at export time, when the filters may already have moved on."""
    for url in ("/api/networth?on=2026-07-31", "/api/positions?on=2026-07-31", "/api/transactions"):
        body = client.get(url).json()
        assert "provenance" in body, url
        p = body["provenance"]
        assert p["scope"] and p["reporting_currency"] == "INR"
        assert set(p) >= {"title", "scope", "as_of", "reporting_currency", "stores", "filters", "warnings"}


def test_the_view_filters_reach_the_header(client):
    body = client.get("/api/transactions?since=2026-01-01&until=2026-06-30").json()
    assert body["provenance"]["filters"] == ["from 2026-01-01", "to 2026-06-30"]


# ── the date is always concrete ──────────────────────────────────────────────────────────────────────

def test_a_view_with_no_date_still_names_the_date_it_used(make_workspace):
    """Found by running the app: the header read "as of not specified" while the screen said "today".

    An artifact that cannot name its own date is the mixed-scope problem in a different costume — and the
    engine had in fact valued at today, so the information existed and was simply thrown away.
    """
    import datetime

    a = make_workspace("alpha", {"A": 1000})
    got = aggregate.net_worth(_manifest(_entity("alpha", a)))          # no `on`
    today = datetime.date.today().isoformat()
    assert got.as_of == today
    assert provenance.for_net_worth(got).as_of == today


def test_staleness_is_detectable_without_an_explicit_date(make_workspace):
    """The second half of the same defect: with no date there was nothing to compare evidence against, so
    a months-old store rendered as current."""
    stale = make_workspace("stale", {"A": 1000}, as_of="2026-02-28")
    got = aggregate.net_worth(_manifest(_entity("stale", stale)))      # no `on`
    assert any("evidence only to 2026-02-28" in w for w in provenance.for_net_worth(got).warnings)


def test_an_explicit_date_is_used_verbatim(make_workspace):
    a = make_workspace("alpha", {"A": 1000})
    got = aggregate.net_worth(_manifest(_entity("alpha", a)), on="2026-07-31")
    assert got.as_of == "2026-07-31"
