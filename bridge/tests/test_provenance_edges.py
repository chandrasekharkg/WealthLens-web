"""Provenance edge cases the main API tests don't reach: a DERIVED holdings row (no single source) must yield
None for its audit columns — never the literal string "NaT" — and a bill payment must carry the source of the
bank debit it came from. Both build a real WLC store inline and call the lens_api projection directly. Skips
cleanly when WealthLens-core is absent."""
from __future__ import annotations

import pathlib
import secrets

import pytest

wealthlens = pytest.importorskip("wealthlens", reason="WealthLens-core is not installed")


def _store(tmp_path: pathlib.Path):
    import duckdb
    from wealthlens import cli

    ws = tmp_path / "edge-WealthLens-data"
    ws.mkdir()
    key = secrets.token_hex(16)
    (ws / "store.key").write_text(key)
    con = duckdb.connect(":memory:")
    cli._attach(con, "wl", ws / "wealth_v3.duckdb", key)
    con.execute("USE wl")
    con.execute(cli._SCHEMA_SQL)
    return ws, con


def test_a_derived_holdings_row_yields_none_audit_not_the_string_nat(tmp_path):
    """A cash position is computed from a running bank balance — it has no source and no ingest timestamp, so
    its audit columns must be None. Regression guard: a NULL TIMESTAMP once serialised as the literal 'NaT'."""
    import duckdb
    from wealthlens import cli, workspace as wl_workspace
    from wealthlens_web.core import lens_api

    ws, con = _store(tmp_path)
    con.execute("INSERT INTO sources (source_id, source_type) VALUES ('s','file')")
    con.execute("INSERT INTO bank_transactions (row_id, account_id, bank, signed_amount, current_balance, "
                "value_date, source_id, created_by, updated_by) "
                "VALUES ('r','bank:hdfc','hdfc',5000,5000,DATE '2026-06-30','s','ing','ing')")
    con.execute("CHECKPOINT wl")
    con.close()

    with wl_workspace.resolve(ws).open() as c:
        rows = lens_api.positions(c, on=None, owner="self", currency="INR")

    cash = next((r for r in rows if r["basis"] == "ledger-cash"), None)
    assert cash is not None, "the bank balance should surface as a derived cash position"
    # a derived row has no single source — every provenance field is a real None, never "NaT"/"NaN"
    assert cash["source_id"] is None
    assert cash["created_at"] is None and cash["updated_at"] is None
    assert not any("NaT" in str(v) or "NaN" in str(v) for r in rows for v in r.values())


def test_a_bill_payment_carries_the_source_of_its_bank_debit(tmp_path):
    """The Payments table's own provenance: a bill payment is one bank debit, so it traces to the bank
    statement that debit was parsed from — regardless of whether the bill matched exactly or by cycle."""
    from wealthlens import workspace as wl_workspace
    from wealthlens_web.core import lens_api

    ws, con = _store(tmp_path)
    # a card statement (Jan bill = ₹1000) + the card's payment leg, and a bank debit of ₹1000 that pays it
    con.execute("INSERT INTO accounts (account_id, account_group, type, institution, currency) "
                "VALUES ('card:axis','card','credit_card','AXIS','INR')")
    con.execute("INSERT INTO sources (source_id, source_type, adapter, provider, period_end, detail, row_count) "
                "VALUES ('src:card','file','card_spec','axis',DATE '2026-01-31',"
                "'{\"new_balance\": 1000}',1)")
    con.execute("INSERT INTO bank_transactions (row_id, account_id, bank, narration, signed_amount, value_date, "
                "source_id, created_by, updated_by) VALUES "
                "('leg','card:axis','axis','PAYMENT RECEIVED',1000,DATE '2026-02-05','src:card','ing','ing')")
    con.execute("INSERT INTO sources (source_id, source_type, adapter, provider) "
                "VALUES ('src:bank','file','bank_spec','axis')")
    con.execute("INSERT INTO bank_transactions (row_id, account_id, bank, narration, signed_amount, value_date, "
                "source_id, created_by, updated_by) VALUES "
                "('pay','bank:axis','axis','UPI/Ref#12',-1000,DATE '2026-02-05','src:bank','ingbank','ingbank')")
    con.execute("CHECKPOINT wl")
    con.close()

    with wl_workspace.resolve(ws).open() as c:
        rows = lens_api.card_bill_payments(c, currency="INR")

    assert rows, "the ₹1000 debit is a card bill payment"
    pay = rows[0]
    assert pay["issuer"] == "axis" and pay["match"] == "exact"
    # the payment's OWN source is the bank statement it was parsed from — not the card statement
    assert pay["source_id"] == "src:bank" and pay["created_by"] == "ingbank"
