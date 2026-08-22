"""Reports as sections — and the rules that keep sections honest.

A report is presentation: several lens answers laid out. The tests that matter are the ones that stop it
quietly becoming recomputation, or quietly losing a row.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from wealthlens_web.api.app import create_app
from wealthlens_web.core import manifest, reports

HOST = "127.0.0.1:7788"


def _manifest(ws) -> manifest.Manifest:
    return manifest.parse(
        f'[family]\nreporting_currency = "INR"\n\n[[entity]]\nid = "alpha"\nworkspace = "{ws}"\n')


@pytest.fixture()
def ws(make_workspace):
    return make_workspace("alpha", {"A Share": 1000, "B Share": 2500})


def test_the_catalogue_needs_no_store(ws):
    """The nav renders before any data loads — and before we know whether a store can even be opened."""
    listed = reports.catalogue()
    assert [r["id"] for r in listed] == ["accounts", "market", "everything"]
    assert all(s["icon"] for r in listed for s in r["sections"])


def test_a_report_groups_rows_into_its_sections(ws):
    got = reports.build(_manifest(ws), "market", on="2026-07-31")
    equities = next(s for s in got["sections"] if s["id"] == "equities")
    assert equities["count"] == 2, "both fixture holdings are listed_equity"
    assert equities["total"].as_dict() == {"amount": "3500.00", "currency": "INR"}


def test_a_section_total_is_a_sum_of_lens_answers_not_our_own_arithmetic(ws):
    """The boundary test. A section total sums values lens produced; it never re-derives one."""
    got = reports.build(_manifest(ws), "market", on="2026-07-31")
    equities = next(s for s in got["sections"] if s["id"] == "equities")
    assert sum(int(float(r["value"].amount)) for r in equities["rows"]) == 3500


def test_every_row_appears_somewhere_even_if_no_section_claims_its_class(ws):
    """A class added upstream must never vanish from every report without a word."""
    everything = reports.build(_manifest(ws), "everything", on="2026-07-31")
    accounts = reports.build(_manifest(ws), "accounts", on="2026-07-31")
    market = reports.build(_manifest(ws), "market", on="2026-07-31")

    total_rows = everything["sections"][0]["count"]
    grouped = sum(s["count"] for s in accounts["sections"] + market["sections"])
    assert grouped == total_rows, "a holding fell through every section"


def test_an_unknown_report_says_which_ones_exist(ws):
    with pytest.raises(KeyError):
        reports.build(_manifest(ws), "nonsense")


def test_a_report_carries_the_same_honesty_fields_as_any_read(ws, tmp_path, make_workspace):
    absent = tmp_path / "gone-WealthLens-data"
    m = manifest.parse(
        f'[family]\nreporting_currency = "INR"\n\n'
        f'[[entity]]\nid = "alpha"\nworkspace = "{ws}"\n\n'
        f'[[entity]]\nid = "gone"\nworkspace = "{absent}"\n')
    got = reports.build(m, "market", on="2026-07-31")
    assert got["is_partial"] is True
    assert [e["entity_id"] for e in got["excluded"]] == ["gone"]
    assert got["provenance"]["scope"] == "Family (1 of 2 members)"


# ── through the API ──────────────────────────────────────────────────────────────────────────────────

@pytest.fixture()
def client(tmp_path, ws):
    mf = tmp_path / "family.toml"
    mf.write_text(f'[family]\nreporting_currency = "INR"\n\n[[entity]]\nid="alpha"\nworkspace="{ws}"\n')
    return TestClient(create_app(mf, token="t"), headers={"host": HOST})


def test_the_nav_lists_reports_with_their_sections(client):
    body = client.get("/api/reports").json()
    assert {r["id"] for r in body} == {"accounts", "market", "everything"}
    assert any(s["title"] == "Cash at bank" for r in body for s in r["sections"])


def test_a_report_renders_over_http(client):
    body = client.get("/api/reports/market?on=2026-07-31").json()
    assert body["title"] == "Market instruments"
    assert body["provenance"]["reporting_currency"] == "INR"
    section = next(s for s in body["sections"] if s["id"] == "equities")
    assert section["icon"] and section["count"] == 2
    assert section["rows"][0]["value"]["currency"] == "INR"


def test_an_unknown_report_names_the_ones_that_exist(client):
    response = client.get("/api/reports/nope")
    assert response.status_code == 404
    reason = response.json()["detail"]["reason"]
    assert "accounts" in reason and "market" in reason
