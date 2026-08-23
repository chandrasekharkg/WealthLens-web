"""The bank→card drill-down surface: /api/card-bill-payments.

Builds a real WLC store where a bill is paid via an Amazon-Pay-style debit (the narration names no card),
and proves the endpoint identifies the card by the amount landing on it and offers the bill as the drill
target. Skips cleanly when WealthLens-core is absent.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from wealthlens_web.api.app import create_app

HOST = "127.0.0.1:7788"


@pytest.fixture()
def client(tmp_path, make_workspace):
    # axis clears its ₹1000 Jan bill via a PAYMENT RECEIVED leg on the Feb statement.
    ws = make_workspace("mine", {"A Share": 1000}, owner="me", cards={
        "axis": [
            ("2026-01-31", 500.0, 1000.0,
             [("2026-01-05", "COFFEE SHOP", -300.0), ("2026-01-10", "GROCERY", -200.0)]),
            ("2026-02-28", 1000.0, 300.0,
             [("2026-02-05", "PAYMENT RECEIVED", 1000.0), ("2026-02-10", "BOOKSTORE", -300.0)]),
        ],
    })
    # A bank debit of ₹1000 whose narration names no card — the general Amazon-Pay case.
    import duckdb
    from wealthlens import cli
    key = (ws / "store.key").read_text().strip()
    con = duckdb.connect(":memory:")
    cli._attach(con, "wl", ws / "wealth_v3.duckdb", key)
    con.execute("USE wl")
    con.execute("INSERT INTO sources (source_id, source_type, adapter, provider) "
                "VALUES ('src:bank','file','bank_spec','axis')")
    con.execute("INSERT INTO accounts (account_id, account_group, type, institution, currency) "
                "VALUES ('bank:axis','bank','savings','AXIS','INR')")
    con.execute("INSERT INTO bank_transactions (row_id, account_id, bank, narration, amount, signed_amount, "
                "value_date, transacted_at, source, source_id) "
                "VALUES ('pay1','bank:axis','axis','UPI/Car/Reques/Amazon RBL',1000.0,-1000.0,"
                "DATE '2026-02-05', TIMESTAMP '2026-02-05', 'bank:axis','src:bank')")
    con.execute("CHECKPOINT wl")
    con.close()

    mf = tmp_path / "family.toml"
    mf.write_text(f'''
[family]
label = "T"
reporting_currency = "INR"

[[entity]]
id = "mine"
label = "Mine"
owner = "me"
workspace = "{ws}"
''')
    return TestClient(create_app(mf, token="test-token"), headers={"host": HOST})


def test_identifies_the_card_by_amount_and_offers_the_bill(client):
    r = client.get("/api/card-bill-payments")
    assert r.status_code == 200
    body = r.json()
    assert body["granularity"] == "card_payments"
    assert len(body["rows"]) == 1
    row = body["rows"][0]
    assert row["amount"]["amount"] == "1000.00"
    assert row["issuer"] == "axis"             # named by the amount, though the narration says only "Amazon RBL"
    assert row["resolved"] is True
    assert row["statement_date"] == "2026-01-31"   # the bill it cleared
    assert row["entity_id"] == "mine"              # attribution survives the family fan
