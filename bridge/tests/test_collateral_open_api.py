"""Opening a collateral file over HTTP: WHERE the browser is decides how the file is delivered.

The endpoint's job is a fork (ADR-0001 carve-out, openspec/decisions/0001):

- a browser on the SAME machine as the bridge (a loopback peer) gets the desktop OS asked to open the file,
  exactly as before — the platform's viewer reads it, not WLW;
- a browser ACROSS THE LAN (a non-loopback peer — dad on aipc.local) gets the file's BYTES streamed back,
  because OS-opening would have opened it on the server, where he would never see it.

Both go through the same containment guard, so neither can be walked out of the workspace. These pin that
fork without needing a real store — `/open` resolves a path on disk and either opens it or streams it; it
never touches the encrypted DuckDB.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pathlib

import pytest
from fastapi.testclient import TestClient

from wealthlens_web.api.app import create_app
from wealthlens_web.api.security import TOKEN_HEADER
from wealthlens_web.core import collateral

HOST = "127.0.0.1:7788"
TOKEN = "test-token"


@pytest.fixture()
def app_with_document(tmp_path, monkeypatch):
    """A manifest whose one entity owns a workspace holding a single (never-parsed) PDF. `/open` needs no
    store, so this avoids WLC entirely. The OS opener is stubbed to a recorder so the local branch cannot
    actually launch anything during a test."""
    ws = tmp_path / "me-WealthLens-data"
    (ws / "statements").mkdir(parents=True)
    doc = ws / "statements" / "June Statement.pdf"
    doc.write_bytes(b"%PDF-1.7 pretend statement bytes")

    mf = tmp_path / "family.toml"
    mf.write_text(f'''
[family]
label = "T"
reporting_currency = "INR"

[[entity]]
id = "me"
label = "Me"
workspace = "{ws}"
''')

    opened: list[pathlib.Path] = []
    monkeypatch.setattr(collateral, "_default_opener", opened.append)

    app = create_app(mf, token=TOKEN)
    return app, opened, doc


def _client(app, peer: str) -> TestClient:
    return TestClient(app, client=(peer, 12345), headers={"host": HOST, TOKEN_HEADER: TOKEN})


def test_a_same_machine_browser_gets_the_os_asked_to_open_it(app_with_document):
    """Loopback peer (KG on 127.0.0.1): the desktop OS opens the file; the response is the JSON path, and
    nothing is streamed — the bridge never read the bytes."""
    app, opened, doc = app_with_document
    r = _client(app, "127.0.0.1").post(
        "/api/workspace/me/open",
        json={"payload_ref": "statements/June Statement.pdf"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/json")
    assert r.json() == {"path": str(doc.resolve())}
    assert opened == [doc.resolve()]                       # the OS opener ran, exactly once


def test_a_lan_browser_gets_the_bytes_streamed_back(app_with_document):
    """A non-loopback peer (dad on aipc.local): OS-open would open on the server, so the bridge streams the
    file to HIS browser instead — inline, carrying the real name, and the OS opener is never touched."""
    app, opened, _doc = app_with_document
    r = _client(app, "192.168.1.50").post(
        "/api/workspace/me/open",
        json={"payload_ref": "statements/June Statement.pdf"})
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content == b"%PDF-1.7 pretend statement bytes"
    assert "June Statement.pdf" in r.headers["content-disposition"]
    assert r.headers["content-disposition"].startswith("inline")
    assert opened == []                                    # nothing was opened on the server


def test_containment_still_guards_the_lan_stream(app_with_document):
    """The remote path must not become a way to stream any file on the box: a traversal is refused, not
    served — the same guard as the local open."""
    app, _opened, _doc = app_with_document
    r = _client(app, "192.168.1.50").post(
        "/api/workspace/me/open",
        json={"payload_ref": "../../../../etc/hosts"})
    assert r.status_code == 404
    assert r.json()["detail"]["reason"]


def test_the_stream_is_still_behind_the_token(app_with_document):
    """Streaming bytes is a POST, so a foreign page with no token cannot pull a file even from a LAN peer."""
    app, _opened, _doc = app_with_document
    r = TestClient(app, client=("192.168.1.50", 12345), headers={"host": HOST}).post(
        "/api/workspace/me/open", json={"payload_ref": "statements/June Statement.pdf"})
    assert r.status_code == 403 and r.json()["reason"] == "token"
