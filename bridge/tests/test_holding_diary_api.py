"""The holdings→diary drill-down surface: /api/holdings/{entity}/{instrument}/diary.

Builds a real WLC store with a couple of detailed_holding_diary lines (a movement and a custody pledge) and
proves the endpoint returns the ordered transcript with roles. Skips cleanly when WealthLens-core is absent.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from wealthlens_web.api.app import create_app

HOST = "127.0.0.1:7788"
ISIN = "INE000A01001"


@pytest.fixture()
def client(tmp_path, make_workspace):
    ws = make_workspace("mine", {"ALPHA": 60000}, owner="me")
    import duckdb
    from wealthlens import cli
    key = (ws / "store.key").read_text().strip()
    con = duckdb.connect(":memory:")
    cli._attach(con, "wl", ws / "wealth_v3.duckdb", key)
    con.execute("USE wl")
    con.execute("INSERT INTO instruments (instrument_id, name, asset_class, source_id) "
                "VALUES (?, 'ALPHA LTD', 'listed_equity', 'src:test')", [ISIN])
    def line(did, kind, role, desc, debit, credit, closing, booked):
        con.execute("INSERT INTO detailed_holding_diary (diary_id, source_id, account_id, instrument_id, "
                    "as_of, event_date, line_kind, description, role, debit, credit, closing, booked_event_id) "
                    "VALUES (?, 'src:test', 'demat:x', ?, DATE '2026-05-31', ?, ?, ?, ?, ?, ?, ?, ?)",
                    [did, ISIN, "2026-05-10", kind, desc, role, debit, credit, closing, booked])
    line("d1", "transaction", "movement", "Purchase", None, 100.0, 100.0, "evt-1")
    line("d2", "transaction", "custody", "Pledge Request", None, 0.0, 100.0, None)
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


def test_diary_returns_the_transcript_with_roles(client):
    r = client.get(f"/api/holdings/mine/{ISIN}/diary")
    assert r.status_code == 200
    body = r.json()
    assert body["entity_id"] == "mine"
    assert body["name"] == "ALPHA LTD"
    roles = [(ln["role"], ln["booked"]) for ln in body["lines"]]
    assert ("movement", True) in roles           # the booked ownership move
    assert ("custody", False) in roles           # the pledge — a status change, not booked


def test_diary_for_an_unknown_instrument_is_empty_not_an_error(client):
    r = client.get("/api/holdings/mine/INE999Z01ZZZ/diary")
    assert r.status_code == 200
    assert r.json()["lines"] == []
