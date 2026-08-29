"""The credit-card statement surface: the family picker, the period list, and one statement itemised.

Builds a real WLC store with two cards (a two-statement continuity chain + a single-statement card), then
proves /api/cards attributes each card to its store, /statements foots, and /statement drills into the
current month by default. Skips cleanly when WealthLens-core is absent.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from wealthlens_web.api.app import create_app

HOST = "127.0.0.1:7788"


@pytest.fixture()
def client(tmp_path, make_workspace):
    ws = make_workspace("mine", {"A Share": 1000}, owner="me", cards={
        "axis": [
            ("2026-01-31", 500.0, 1000.0,
             [("2026-01-05", "COFFEE SHOP", -300.0), ("2026-01-10", "GROCERY", -200.0)]),
            ("2026-02-28", 1000.0, 300.0,
             [("2026-02-03", "BOOKSTORE", -100.0), ("2026-02-15", "BILL PAYMENT", 800.0)]),
        ],
        "icici": [
            ("2026-02-11", 0.0, 5000.0, [("2026-02-01", "ELECTRONICS", -5000.0)]),
        ],
    })
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
    app = create_app(mf, token="test-token")
    return TestClient(app, headers={"host": HOST})


def test_cards_lists_each_card_attributed_to_its_store(client):
    r = client.get("/api/cards")
    assert r.status_code == 200
    body = r.json()
    assert body["granularity"] == "cards"
    issuers = {row["issuer"]: row for row in body["rows"]}
    assert set(issuers) == {"axis", "icici"}
    assert issuers["icici"]["outstanding"]["amount"] == "5000.00"     # latest statement's new balance
    assert issuers["axis"]["outstanding"]["amount"] == "300.00"
    assert issuers["axis"]["statements"] == 2
    assert issuers["axis"]["entity_id"] == "mine"                     # attribution survives the fan


def test_statements_list_foots_as_a_chain(client):
    r = client.get("/api/cards/mine/axis/statements")
    assert r.status_code == 200
    stmts = r.json()["statements"]
    assert [s["statement_date"] for s in stmts] == ["2026-02-28", "2026-01-31"]  # newest first
    feb, jan = stmts
    assert feb["previous_balance"]["amount"] == jan["new_balance"]["amount"] == "1000.00"
    assert jan["spends"]["amount"] == "500.00" and feb["payments"]["amount"] == "800.00"


def test_statement_defaults_to_current_month(client):
    r = client.get("/api/cards/mine/axis/statement")
    assert r.status_code == 200
    st = r.json()
    assert st["statement_date"] == "2026-02-28"
    assert st["new_balance"]["amount"] == "300.00"
    assert [t["description"] for t in st["transactions"]] == ["BOOKSTORE", "BILL PAYMENT"]
    assert [t["direction"] for t in st["transactions"]] == ["spend", "payment"]
    assert st["transactions"][0]["amount"]["amount"] == "-100.00"     # signed: a purchase is negative


def test_statement_period_selects_an_older_month(client):
    r = client.get("/api/cards/mine/axis/statement", params={"period": "2026-01"})
    assert r.status_code == 200
    st = r.json()
    assert st["statement_date"] == "2026-01-31"
    assert len(st["transactions"]) == 2


def test_statement_for_an_undeclared_entity_is_404(client):
    r = client.get("/api/cards/nobody/axis/statement")
    assert r.status_code == 404


def test_each_statement_carries_its_paid_status_and_the_picker_the_newest(client):
    """Card Star: the paid-state the lens derives from the action tuple vs the next cycle's payments, surfaced
    on every statement and (as the newest) on the picker row."""
    picker = {r["issuer"]: r for r in client.get("/api/cards").json()["rows"]}
    # newest statement of each card has no next cycle to settle it → pending
    assert picker["axis"]["status"] == "pending"
    assert picker["icici"]["status"] == "pending"

    stmts = {s["statement_date"]: s["status"] for s in
             client.get("/api/cards/mine/axis/statements").json()["statements"]}
    assert stmts["2026-02-28"] == "pending"                 # the newest
    # Jan closed owing ₹1000; the credits that follow sum to only ₹800 → the bill is not covered = unpaid
    # (the simplified credits-vs-debits model is binary: covered → paid, else unpaid; no partial/minimum tier)
    assert stmts["2026-01-31"] == "unpaid"
