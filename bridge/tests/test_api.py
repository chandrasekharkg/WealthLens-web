"""The bridge's HTTP surface: the security posture, and that responses carry their caveats.

The threat model here is the browser, not the network. The socket is on loopback, but any page a household
visits can issue requests to 127.0.0.1 — so these tests are mostly about what a *foreign page* cannot do.
"""
from __future__ import annotations

import pathlib

import pytest
from fastapi.testclient import TestClient

from wealthlens_web.api.app import create_app
from wealthlens_web.api.security import TOKEN_HEADER
from wealthlens_web.core import verbs

ORIGIN = "http://127.0.0.1:7788"
HOST = "127.0.0.1:7788"


@pytest.fixture()
def app_and_client(tmp_path, make_workspace):
    a = make_workspace("alpha", {"A Share": 1000})
    b = make_workspace("beta", {"B Share": 2500})
    mf = tmp_path / "family.toml"
    mf.write_text(f'''
[family]
label = "T"
reporting_currency = "INR"

[[entity]]
id = "alpha"
label = "Alpha"
workspace = "{a}"

[[entity]]
id = "beta"
label = "Beta"
workspace = "{b}"
''')
    app = create_app(mf, token="test-token")
    return app, TestClient(app, headers={"host": HOST})


# ── the security posture ─────────────────────────────────────────────────────────────────────────────

def test_a_foreign_host_header_is_refused(app_and_client):
    """DNS rebinding: an attacker's domain resolving to 127.0.0.1 so the browser treats their page as
    same-origin with this app. The Host header is what gives it away."""
    _, client = app_and_client
    r = client.get("/api/version", headers={"host": "evil.example.com"})
    assert r.status_code == 403 and r.json()["reason"] == "host"


def test_a_foreign_origin_is_refused_even_on_a_read(app_and_client):
    _, client = app_and_client
    r = client.get("/api/networth", headers={"origin": "https://evil.example.com"})
    assert r.status_code == 403 and r.json()["reason"] == "origin"


def test_our_own_origin_is_accepted(app_and_client):
    _, client = app_and_client
    assert client.get("/api/version", headers={"origin": ORIGIN}).status_code == 200


def test_holding_diagnose_returns_a_pii_free_self_check_bundle(app_and_client):
    """The derived-end diagnostic (Level 2): the store's self-checks over a holding's computed figures, as a
    PII-free bundle safe to paste into an issue. `alpha`'s holding is snapshot-valued (no events), so quantity
    foots n/a and the bundle is healthy — and no real value, security, or date is in the report."""
    import re as _re
    _, client = app_and_client
    r = client.get("/api/holdings/alpha/inst:alpha:0/diagnose")
    assert r.status_code == 200
    body = r.json()
    assert body["figure"] == "holding" and body["healthy"] is True
    assert "checks" in body and body["report"]
    rep = body["report"]
    assert not _re.search(r"\d[\d,]*\.\d\d", rep)                 # no real 2dp amount survives (all #-shapes)
    assert not _re.search(r"\d{4}-\d{2}-\d{2}", rep)              # no ISO date survives
    assert "safe to share" in rep


def test_diagnose_of_an_unheld_instrument_is_healthy_and_empty_not_404(app_and_client):
    _, client = app_and_client
    r = client.get("/api/holdings/alpha/inst:nope:9/diagnose")
    assert r.status_code == 200 and r.json()["healthy"] is True and r.json()["report"] == ""


def test_a_state_changing_request_without_the_token_is_refused(app_and_client):
    """The cross-site POST case: a random tab firing at the import endpoint. No token, no subprocess."""
    _, client = app_and_client
    r = client.post("/api/jobs", json={"verb": "import", "entity": "alpha"})
    assert r.status_code == 403 and r.json()["reason"] == "token"


def test_a_wrong_token_is_refused(app_and_client):
    _, client = app_and_client
    r = client.post("/api/jobs", json={"verb": "import", "entity": "alpha"},
                    headers={TOKEN_HEADER: "not-the-token"})
    assert r.status_code == 403 and r.json()["reason"] == "token"


def test_reads_do_not_require_a_token(app_and_client):
    """Reads are same-origin-guarded; requiring a token on them would buy nothing and break a plain link."""
    _, client = app_and_client
    assert client.get("/api/networth").status_code == 200


# ── reads carry their caveats ────────────────────────────────────────────────────────────────────────

def test_net_worth_totals_and_decomposes(app_and_client):
    _, client = app_and_client
    body = client.get("/api/networth?on=2026-07-31").json()
    assert body["total"] == {"amount": "3500.00", "currency": "INR"}, "the store's own scale, consistently"
    assert body["is_partial"] is False
    assert {e["entity_id"] for e in body["entities"]} == {"alpha", "beta"}
    assert all(e["total"]["currency"] == "INR" for e in body["entities"])


def test_money_never_serialises_as_a_bare_number(app_and_client):
    _, client = app_and_client
    body = client.get("/api/networth?on=2026-07-31").json()
    assert set(body["total"]) == {"amount", "currency"}
    for e in body["entities"]:
        for row in e["by_class"]:
            assert set(row["value"]) == {"amount", "currency"}


def test_a_partial_total_says_so_at_the_top_level(tmp_path, make_workspace):
    """A client that has to go looking for "is this partial?" is a client that will forget to."""
    a = make_workspace("alpha", {"A Share": 1000})
    mf = tmp_path / "family.toml"
    mf.write_text(f'''
[family]
reporting_currency = "INR"

[[entity]]
id = "alpha"
workspace = "{a}"

[[entity]]
id = "ghost"
workspace = "{tmp_path / 'nowhere-WealthLens-data'}"
''')
    client = TestClient(create_app(mf, token="t"), headers={"host": HOST})
    body = client.get("/api/networth").json()
    assert body["is_partial"] is True
    ghost = next(e for e in body["entities"] if e["entity_id"] == "ghost")
    assert ghost["contributes"] is False and "missing" in ghost["excluded_reason"]
    assert ghost["workspaces"][0]["availability"] == "missing"


def test_performance_carries_the_envelope_and_the_chart_payload(app_and_client):
    """B2: `/api/performance` must carry the same honesty envelope every other read does — `as_of`,
    `is_partial`, `excluded`, `provenance` — and the pre-summed chart payload the UI renders verbatim."""
    _, client = app_and_client
    body = client.get("/api/performance").json()
    assert body["is_partial"] is False and body["as_of"]
    assert body["provenance"]["reporting_currency"] == "INR"
    assert body["total"] == {"amount": "3500.00", "currency": "INR"}
    assert body["breakup"] and all("share" in b for b in body["breakup"])
    # B3: the class vocabulary is published, ordered, so the UI keeps no copy
    assert any(c["asset_class"] == "listed_equity" for c in body["classes"])


def test_performance_accepts_a_point_in_time(app_and_client):
    """The breakup values at a stated date, like every other read — not silently at today."""
    _, client = app_and_client
    body = client.get("/api/performance?on=2026-07-31").json()
    assert body["as_of"] == "2026-07-31"


def test_performance_names_an_excluded_store_rather_than_charting_it_away(tmp_path, make_workspace):
    """B2, at the HTTP boundary: an unreadable store is in `excluded` and the charts say they are partial."""
    a = make_workspace("alpha", {"A Share": 1000})
    mf = tmp_path / "family.toml"
    mf.write_text(f'[family]\nreporting_currency = "INR"\n\n[[entity]]\nid = "alpha"\nworkspace = "{a}"\n\n'
                  f'[[entity]]\nid = "ghost"\nworkspace = "{tmp_path / "nowhere-WealthLens-data"}"\n')
    client = TestClient(create_app(mf, token="t"), headers={"host": HOST})
    body = client.get("/api/performance").json()
    assert body["is_partial"] is True
    assert [e["entity_id"] for e in body["excluded"]] == ["ghost"]


def _money_leaves(node, path="") -> list[tuple[str, object]]:
    """Every {amount, currency}-shaped leaf under a response, with its path — so the Money-string invariant
    can be walked over the NESTED chart fields (base/top/value/ticks/omitted), not just the top-level total."""
    found = []
    if isinstance(node, dict):
        if set(node) == {"amount", "currency"}:
            found.append((path, node))
        else:
            for k, v in node.items():
                found.extend(_money_leaves(v, f"{path}.{k}"))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            found.extend(_money_leaves(v, f"{path}[{i}]"))
    return found


def test_every_money_on_the_chart_payload_is_a_string_not_a_number(app_and_client):
    """The reported-money contract, walked over the chart's NESTED fields. A JSON number is an IEEE double;
    the store keeps DECIMAL(18,2) and every figure the charts print — total, each band's base/top, each axis
    tick, each omitted value — must cross the wire as an exact string, or the boundary has a hole in it."""
    _, client = app_and_client
    body = client.get("/api/performance").json()
    leaves = _money_leaves(body)
    assert leaves, "the payload has money in it to check"
    for path, m in leaves:
        assert isinstance(m["amount"], str), f"{path} serialised money as a number"
    # the fields the review named specifically are present and covered
    paths = " ".join(p for p, _ in leaves)
    assert ".base" in paths and ".top" in paths and ".axis_ticks" in paths


def test_granularity_is_stated_on_every_read(app_and_client):
    _, client = app_and_client
    assert client.get("/api/networth").json()["granularity"] == "aggregate"
    assert client.get("/api/positions").json()["granularity"] == "positions"
    assert client.get("/api/transactions").json()["granularity"] == "transactions"


def test_the_source_popup_resolves_a_fact_rows_provenance_and_tables(app_and_client):
    """Primitive B: a row's source_id resolves to the document behind it and which tables it filled."""
    _, client = app_and_client
    body = client.get("/api/source/alpha/src:test").json()
    assert body["adapter"] == "test"
    assert body["document"]["kind"] == "file"      # the collateral view — what the popup opens/copies from
    assert body["detail"] == {}   # a source with no adapter facts is an empty object, never a null
    tables = {t["table"]: t["rows"] for t in body["tables"]}
    assert tables.get("position_snapshots", 0) >= 1   # it wrote the holding snapshot


def test_an_unknown_source_id_fails_soft_rather_than_500(app_and_client):
    """A stale row's popup should read "no longer in the store", not error the page."""
    _, client = app_and_client
    r = client.get("/api/source/alpha/does-not-exist")
    assert r.status_code == 200
    body = r.json()
    assert body["source_id"] is None and body["document"] is None
    assert body["detail"] == {} and body["tables"] == []


def test_transactions_carry_their_source_and_audit_columns(app_and_client):
    """Primitive A: every ledger row exposes source_id + the WHO/when audit quartet, populated from the store."""
    _, client = app_and_client
    rows = client.get("/api/transactions").json()["rows"]
    assert rows, "the fixture books a bank transaction per holding"
    r = rows[0]
    assert {"source_id", "created_by", "created_at", "updated_by", "updated_at"} <= set(r)
    assert r["source_id"] == "src:test"


def test_report_positions_carry_provenance_on_snapshot_rows(app_and_client):
    """Primitive A on the Reports/positions tables: a snapshot-basis holding carries its source_id + audit."""
    _, client = app_and_client
    rows = [
        r
        for rep in client.get("/api/reports").json()
        for s in client.get(f"/api/reports/{rep['id']}").json()["sections"]
        for r in s["rows"]
    ]
    assert rows, "the fixture builds a valued holding somewhere in the reports"
    snap = next((r for r in rows if r.get("basis") == "statement"), None)
    assert snap is not None and snap["source_id"] == "src:test"
    assert {"created_by", "created_at", "updated_by", "updated_at"} <= set(snap)


def test_an_aggregate_response_contains_no_instrument_rows(app_and_client):
    """Scoped exposure, enforced at the source: there is no field a position could arrive in."""
    _, client = app_and_client
    body = client.get("/api/networth?on=2026-07-31").json()
    assert "rows" not in body
    assert all("rows" not in e for e in body["entities"])


def test_version_reports_the_engine_and_each_store(app_and_client):
    _, client = app_and_client
    body = client.get("/api/version").json()
    assert body["engine"]["present"] is True
    assert body["engine"]["schema_version"]
    assert {s["entity_id"] for s in body["stores"]} == {"alpha", "beta"}
    assert all(s["availability"] == "ok" for s in body["stores"])


# ── jobs ─────────────────────────────────────────────────────────────────────────────────────────────

def test_a_job_must_name_exactly_one_entity(app_and_client):
    _, client = app_and_client
    r = client.post("/api/jobs", json={"verb": "import"}, headers={TOKEN_HEADER: "test-token"})
    assert r.status_code == 400
    assert "import-into-all" in r.json()["detail"]["reason"]


def test_a_verb_outside_the_sanctioned_set_is_refused(app_and_client):
    """The allowed list is the contract — not a configuration option."""
    _, client = app_and_client
    r = client.post("/api/jobs", json={"verb": "init", "entity": "alpha"},
                    headers={TOKEN_HEADER: "test-token"})
    assert r.status_code == 400 and "not a verb" in r.json()["detail"]["reason"]


def test_a_workspace_not_declared_for_that_entity_is_refused(app_and_client, tmp_path):
    _, client = app_and_client
    r = client.post("/api/jobs",
                    json={"verb": "verify", "entity": "alpha", "workspace": str(tmp_path / "elsewhere")},
                    headers={TOKEN_HEADER: "test-token"})
    assert r.status_code == 400 and "not declared" in r.json()["detail"]["reason"]


def test_an_unknown_job_says_it_was_forgotten_not_that_it_never_existed(app_and_client):
    """Job state is in memory by design, so the 404 has to distinguish the two."""
    _, client = app_and_client
    r = client.get("/api/jobs/deadbeef")
    assert r.status_code == 404
    reason = r.json()["detail"]["reason"]
    assert "restart forgets" in reason and "store is unaffected" in reason


def test_a_real_verb_runs_and_reports_its_outcome(app_and_client):
    """End to end through the contract: a subprocess of the real CLI, read by outcome not exit code."""
    _, client = app_and_client
    r = client.post("/api/jobs", json={"verb": "verify", "entity": "alpha"},
                    headers={TOKEN_HEADER: "test-token"})
    assert r.status_code == 202
    job_id = r.json()["id"]

    body = _await_job(client, job_id)
    assert body["state"] == "finished"
    assert body["outcome"] in {"ok", "attention"}
    assert body["changed_something"] is True
    assert body["exit_code"] is not None


def _await_job(client, job_id: str, tries: int = 200) -> dict:
    import time
    for _ in range(tries):
        body = client.get(f"/api/jobs/{job_id}").json()
        if body["state"] == "finished":
            return body
        time.sleep(0.05)
    raise AssertionError(f"job {job_id} did not finish")


# ── the job model ────────────────────────────────────────────────────────────────────────────────────

def test_verbs_serialise_per_workspace_and_do_not_block_other_workspaces(tmp_path, make_workspace):
    """One verb at a time per store — DuckDB's read/write conflict made structural — while a different
    entity's store is untouched by it."""
    a = make_workspace("alpha", {"A": 1})
    b = make_workspace("beta", {"B": 1})
    runner = verbs.Runner()
    assert not runner.is_busy(a) and not runner.is_busy(b)

    lock_a = runner._lock_for(pathlib.Path(a).resolve())
    lock_a.acquire()
    try:
        assert runner.is_busy(a)
        assert not runner.is_busy(b), "a lock on one workspace must not touch another"
    finally:
        lock_a.release()


def test_a_refusal_is_reported_as_changing_nothing(tmp_path, make_workspace):
    """promote with no candidate refuses at its first gate. The UI must be able to say 'nothing changed'
    without reading the message."""
    a = make_workspace("alpha", {"A": 1})
    job = verbs.Runner().run("promote", entity_id="alpha", workspace=pathlib.Path(a))
    assert job.outcome is verbs.Outcome.REFUSED
    assert job.gate == "no-candidate"
    assert job.changed_something is False
    assert job.exit_code == 3


def test_an_unparseable_result_is_a_failure_not_a_guess(monkeypatch, make_workspace):
    """If stdout is not the envelope, the engine is not the one we think it is — and inferring from the
    exit code is exactly what this design refuses to do."""
    a = make_workspace("alpha", {"A": 1})
    runner = verbs.Runner(python="/bin/echo")          # prints its args, never JSON
    job = runner.run("verify", entity_id="alpha", workspace=pathlib.Path(a))
    assert job.outcome is verbs.Outcome.FAILED
    assert "older than this app supports" in job.message


def test_the_runner_knows_which_pids_are_its_own(make_workspace):
    """The only lock-holder classification that can be KNOWN rather than guessed."""
    runner = verbs.Runner()
    assert runner.our_pids == frozenset()


def test_the_app_must_know_the_port_it_is_actually_served_on(tmp_path, make_workspace):
    """Found by the end-to-end run: served on 7799 while believing it was on 7788, so the Host check
    refused every request with `reason: host` and nothing explained why.

    The address the app checks against and the address the server binds have to come from one place.
    """
    a = make_workspace("alpha", {"A": 1})
    mf = tmp_path / "family.toml"
    mf.write_text(f'[family]\nreporting_currency = "INR"\n\n[[entity]]\nid="alpha"\nworkspace="{a}"\n')

    app = create_app(mf, host="127.0.0.1", port=7799, token="t")
    on_the_right_port = TestClient(app, headers={"host": "127.0.0.1:7799"})
    assert on_the_right_port.get("/api/version").status_code == 200

    on_the_wrong_port = TestClient(app, headers={"host": "127.0.0.1:7788"})
    assert on_the_wrong_port.get("/api/version").status_code == 403


def test_serve_reads_the_bound_address_from_the_environment(monkeypatch):
    from wealthlens_web import serve

    monkeypatch.setenv(serve.HOST_ENV, "127.0.0.1")
    monkeypatch.setenv(serve.PORT_ENV, "9001")
    assert serve.bound_to() == ("127.0.0.1", 9001)

    monkeypatch.delenv(serve.PORT_ENV)
    assert serve.bound_to()[1] == 7788, "the default is the port the launcher uses"
