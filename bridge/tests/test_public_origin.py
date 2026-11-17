"""The bridge measures requests against its PUBLIC origin, so it can sit behind a TLS front (ADR-0022).

Dad's app moves behind the machine's Caddy front: Safari talks to https://aipc.local:8444, Caddy proxies to the
bridge on 127.0.0.1:8765 and passes the Host header through. Three things were measured against the BOUND
address and broke there: the Host check (refused the front's Host), the Origin check (hard-coded http://), and the
document-open routing (every peer is the front on loopback, so dad's files would open on AIPC's own screen).
`WLW_PUBLIC_ORIGIN` names the address the browser uses; unset, it is the bound http address — today exactly.
"""
from __future__ import annotations

import types

import pytest
from fastapi.testclient import TestClient

from wealthlens_web.api import app as app_module
from wealthlens_web.api import security
from wealthlens_web.api.app import create_app

FRONT = "https://aipc.local:8444"


@pytest.fixture()
def manifest(tmp_path, make_workspace):
    a = make_workspace("alpha", {"A": 1})
    mf = tmp_path / "family.toml"
    mf.write_text(f'[family]\nreporting_currency = "INR"\n\n[[entity]]\nid="alpha"\nworkspace="{a}"\n')
    return mf


def _post(client, headers):
    # a state-changing call that passes the guard only if Host, Origin and token are all accepted
    return client.post("/api/jobs", json={"verb": "verify", "entity": "nope"}, headers=headers)


# ── the default is today's address ──────────────────────────────────────────────────────────────────────

def test_without_a_public_origin_the_bound_http_address_is_the_one_checked(manifest):
    app = create_app(manifest, host="aipc.local", port=8765, token="t")
    c = TestClient(app)
    ok = {"host": "aipc.local:8765", "origin": "http://aipc.local:8765", "x-wlw-token": "t"}
    assert _post(c, ok).status_code != 403
    assert _post(c, {**ok, "host": "aipc.local:8444"}).json()["reason"] == "host"


# ── behind the front ───────────────────────────────────────────────────────────────────────────────────

def test_behind_the_front_the_browsers_host_origin_and_token_are_accepted(manifest):
    app = create_app(manifest, host="127.0.0.1", port=8765, origin=FRONT, token="t")
    c = TestClient(app)
    ok = {"host": "aipc.local:8444", "origin": FRONT, "x-wlw-token": "t"}
    assert c.get("/api/version", headers={"host": "aipc.local:8444"}).status_code == 200
    assert _post(c, ok).status_code != 403


def test_behind_the_front_the_bound_host_and_a_plain_http_origin_are_refused(manifest):
    app = create_app(manifest, host="127.0.0.1", port=8765, origin=FRONT, token="t")
    c = TestClient(app)
    ok = {"host": "aipc.local:8444", "origin": FRONT, "x-wlw-token": "t"}
    assert _post(c, {**ok, "host": "aipc.local:8765"}).json()["reason"] == "host"     # the old direct address
    assert _post(c, {**ok, "origin": "http://aipc.local:8444"}).json()["reason"] == "origin"   # downgraded scheme
    assert _post(c, {**ok, "x-wlw-token": "nope"}).json()["reason"] == "token"       # the token still guards


def test_the_wrong_address_page_names_the_public_origin(manifest):
    app = create_app(manifest, host="127.0.0.1", port=8765, origin=FRONT, token="t")
    r = TestClient(app).get("/", headers={"host": "aipc.local:8765"})
    assert r.status_code == 403 and FRONT in r.text


# ── parsing the setting ────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("given, want", [
    ("https://aipc.local:8444", "https://aipc.local:8444"),
    ("https://aipc.local:8444/", "https://aipc.local:8444"),      # a trailing slash is not a path
    ("HTTPS://AIPC.local:8444", "https://aipc.local:8444"),      # scheme and name are case-insensitive
    ("https://aipc.local:443", "https://aipc.local"),            # browsers omit default ports in Host/Origin
    ("http://aipc.local:80", "http://aipc.local"),
    ("http://127.0.0.1:7788", "http://127.0.0.1:7788"),
])
def test_a_public_origin_is_normalised_to_what_a_browser_sends(given, want):
    assert security.parse_public_origin(given) == want


@pytest.mark.parametrize("bad", [
    "aipc.local:8444",                     # no scheme
    "ftp://aipc.local:8444",               # not a web scheme
    "https://aipc.local:8444/app",         # a path: the bridge is served at the root
    "https://kg:secret@aipc.local:8444",   # credentials have no place in an origin
    "https://aipc.local:8444?x=1",         # query
    "https://",                            # no host
    "https://aipc.local:99999",            # not a port
])
def test_a_malformed_public_origin_is_refused_with_the_reason(bad):
    with pytest.raises(ValueError):
        security.parse_public_origin(bad)


def test_serve_reads_the_setting_and_refuses_to_start_on_a_bad_one(monkeypatch):
    from wealthlens_web import serve
    monkeypatch.delenv("WLW_PUBLIC_ORIGIN", raising=False)
    assert serve.public_origin("aipc.local", 8765) == "http://aipc.local:8765"        # unset: today's address
    monkeypatch.setenv("WLW_PUBLIC_ORIGIN", FRONT)
    assert serve.public_origin("127.0.0.1", 8765) == FRONT
    monkeypatch.setenv("WLW_PUBLIC_ORIGIN", "aipc.local:8444")
    with pytest.raises(SystemExit):
        serve.public_origin("127.0.0.1", 8765)


# ── where a document goes ──────────────────────────────────────────────────────────────────────────────

def _request(peer: str, public_origin: str):
    state = types.SimpleNamespace(public_origin=public_origin)
    return types.SimpleNamespace(client=types.SimpleNamespace(host=peer), app=types.SimpleNamespace(state=state))


def test_behind_a_named_front_a_loopback_peer_is_the_front_so_the_file_goes_to_the_browser():
    assert app_module._peer_is_local(_request("127.0.0.1", FRONT)) is False


def test_direct_serving_routes_documents_as_before():
    assert app_module._peer_is_local(_request("127.0.0.1", "http://127.0.0.1:7788")) is True    # KG's Mac app
    assert app_module._peer_is_local(_request("10.0.0.23", "http://aipc.local:8765")) is False   # dad today
    assert app_module._peer_is_local(_request("testclient", "http://127.0.0.1:7788")) is False   # not an IP
