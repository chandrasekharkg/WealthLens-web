"""The family ledger surface: /api/family and the per-member transfers drill. Skips when WLC is absent."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from wealthlens_web.api.app import create_app

HOST = "127.0.0.1:7788"


@pytest.fixture()
def client(tmp_path, make_workspace):
    ws = make_workspace("mine", {"A Share": 1000}, owner="me")
    import duckdb
    from wealthlens import cli
    key = (ws / "store.key").read_text().strip()
    con = duckdb.connect(":memory:")
    cli._attach(con, "wl", ws / "wealth_v3.duckdb", key)
    con.execute("USE wl")
    # the 'me' entity already exists (make_workspace inserts the owner); add the child and a name for me
    con.execute("UPDATE entities SET name='Ravi Sharma' WHERE entity_id='me'")
    con.execute("INSERT INTO entities (entity_id, name, entity_type) VALUES ('avi','Avi Sharma','person')")
    con.execute("INSERT INTO entity_relationships (entity_id, relationship, valid_from, valid_to) VALUES "
                "('me','self', DATE '1980-01-01', DATE '9999-12-31'),"
                "('avi','son', DATE '2010-01-01', DATE '9999-12-31')")
    con.execute("INSERT INTO bank_transactions (row_id, account_id, bank, value_date, signed_amount, narration, "
                "source_id) VALUES ('t1','bank:x','x', DATE '2026-01-10', -5000, 'UPI/AVI SHARMA/1/UPI','src:test'),"
                "('t2','bank:x','x', DATE '2026-02-10', -9000, 'AVIATION FUEL', 'src:test')")
    con.execute("CHECKPOINT wl"); con.close()

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


def test_family_lists_members_with_totals(client):
    r = client.get("/api/family")
    assert r.status_code == 200
    body = r.json()
    assert body["granularity"] == "family"
    avi = next(m for m in body["rows"] if m["member_id"] == "avi")
    assert avi["relationship"] == "son"
    assert avi["total"]["amount"] == "5000.00"      # the aviation-fuel row is NOT counted
    assert avi["entity_id"] == "mine"               # tagged with the sending store


def test_transfers_drill_lists_the_transfers(client):
    r = client.get("/api/family/mine/avi/transfers")
    assert r.status_code == 200
    tx = r.json()["transfers"]
    assert len(tx) == 1 and tx[0]["amount"]["amount"] == "5000.00"
    assert "AVIATION" not in (tx[0]["narration"] or "").upper()
