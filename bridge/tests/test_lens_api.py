"""lens_api.positions() converts WLC's pandas-sourced rows into plain dicts the API layer can serialise. A
name-less instrument is a legitimate state — WLC now registers a minimal instruments row (no name yet) for
price history that outlives a holding's own registration — and pandas represents that missing value as a
float NaN, not None. Every other optional string field here is passed through a NaN-safe `_str()` helper;
`name` was the one field that wasn't, so a real name-less instrument crashed the whole report with a
FastAPI response-validation error instead of rendering as an unnamed row. Real WLC store, synthetic data."""
from __future__ import annotations

import secrets

import pytest

wealthlens = pytest.importorskip("wealthlens", reason="WealthLens-core is not installed")


def _store(tmp_path):
    import duckdb
    from wealthlens import cli

    ws = tmp_path / "test-WealthLens-data"
    ws.mkdir(parents=True)
    key = secrets.token_hex(16)
    (ws / "store.key").write_text(key)
    con = duckdb.connect(":memory:")
    cli._attach(con, "wl", ws / "wealth_v3.duckdb", key)
    con.execute("USE wl")
    con.execute(cli._SCHEMA_SQL)
    con.execute("INSERT INTO sources (source_id, source_type, adapter, provider) "
                "VALUES ('src:test', 'file', 'test', 'test')")
    return con


def test_a_nameless_instrument_reports_name_as_none_not_nan(tmp_path):
    """A price-history-only instrument (e.g. equity_yfinance.load's minimal registration) has no name yet.
    positions() must hand that back as None, not the pandas NaN a raw DataFrame passthrough would leak.

    A SINGLE nameless row round-trips through DuckDB as a plain Python None — pandas only represents the
    missing value as a float NaN once the column holds a genuine string ELSEWHERE too (its dtype settles on
    "there are real strings here, and gaps"), which is exactly the shape a real portfolio has: mostly named
    holdings, occasionally not. A second, named instrument is what makes this test reproduce the real bug —
    without it, the fixed and unfixed code look identical."""
    from wealthlens_web.core import lens_api

    con = _store(tmp_path)
    con.execute("INSERT INTO instruments (instrument_id, name, asset_class, source_id) "
                "VALUES ('INE000A01001', NULL, 'listed_equity', 'src:test')")   # fabricated  pii-ok
    con.execute("INSERT INTO instruments (instrument_id, name, asset_class, source_id) "
                "VALUES ('INE000B01002', 'A NAMED SECURITY', 'listed_equity', 'src:test')")   # fabricated  pii-ok
    con.execute("INSERT INTO position_snapshots "
                "(instrument_id, account_id, as_of, value_inr, source, source_id) "
                "VALUES ('INE000A01001', 'demat:test', DATE '2026-06-30', 1000, 'stmt', 'src:test')")
    con.execute("INSERT INTO position_snapshots "
                "(instrument_id, account_id, as_of, value_inr, source, source_id) "
                "VALUES ('INE000B01002', 'demat:test', DATE '2026-06-30', 2000, 'stmt', 'src:test')")
    con.execute("CHECKPOINT wl")

    rows = lens_api.positions(con, on="2026-06-30", owner="self", currency="INR")
    by_id = {r["instrument_id"]: r for r in rows}
    assert by_id["INE000A01001"]["name"] is None
    assert by_id["INE000B01002"]["name"] == "A NAMED SECURITY"   # fabricated  pii-ok


def test_account_label_folds_and_humanises():
    """The bank-ledger account label: humanised bank + masked last-four, canonical-folded so a merged pair
    reads as the ONE account it became. Pure function — no store needed."""
    from wealthlens_web.core import lens_api

    assert lens_api._account_label("bank:sbi:1375", {}) == "SBI ••1375"   # fabricated  pii-ok
    assert lens_api._account_label("bank:union", {}) == "UNION"                      # no captured number
    # a merged pair (a Citi account that became an Axis one) reads as the single canonical account
    assert lens_api._account_label("bank:citi", {"bank:citi": "bank:axis"}) == "AXIS"
    assert lens_api._account_label(None, {}) is None
