"""The pane that makes the custodian legible — and the third password state a two-state design would miss.

WLC records, per document, which password opened it. The recorded reference is a `.pass` filename only when
the opener came from a CONFIGURED secret; otherwise it is a non-reversible fingerprint. So a UI offering
"named" and "nothing recorded" mislabels the common case, where something did open the file but only a
fingerprint was kept.
"""
from __future__ import annotations

import json
import pathlib

import pytest
from fastapi.testclient import TestClient

from wealthlens_web.api.app import create_app
from wealthlens_web.api.security import TOKEN_HEADER
from wealthlens_web.core import collateral

HOST = "127.0.0.1:7788"


def _register(ws: pathlib.Path, *, source_id: str, sha: str, filename: str, rows: int = 10) -> None:
    import duckdb
    from wealthlens import cli

    key = (ws / "store.key").read_text().strip()
    con = duckdb.connect(":memory:")
    cli._attach(con, "wl", ws / "wealth_v3.duckdb", key)
    con.execute("USE wl")
    con.execute(
        "INSERT INTO sources (source_id, source_type, provider, content_sha256, payload_ref, row_count, "
        "captured_at, detail) VALUES (?, 'file', 'hdfc', ?, ?, ?, TIMESTAMP '2026-07-31 10:00:00', ?)",
        [source_id, sha, f"statements/{filename}", rows, json.dumps({"filename": filename})],
    )
    con.execute("CHECKPOINT wl")
    con.close()


def _hints(ws: pathlib.Path, mapping: dict[str, str]) -> None:
    (ws / collateral.HINTS_FILE).write_text(json.dumps(mapping))


@pytest.fixture()
def ws(make_workspace):
    return pathlib.Path(make_workspace("alpha", {"A": 1000}))


def _documents(ws: pathlib.Path):
    from wealthlens import workspace as wl_workspace

    with wl_workspace.resolve(ws).open() as con:
        return collateral.documents(con, ws)


def test_each_document_reports_its_fate(ws):
    _register(ws, source_id="src:1", sha="aaa", filename="hdfc-jul.pdf", rows=218)
    got = {d.source_id: d for d in _documents(ws)}["src:1"]
    assert got.filename == "hdfc-jul.pdf"
    assert got.rows == 218
    assert got.provider == "hdfc"
    assert got.payload_ref == "statements/hdfc-jul.pdf"


def test_a_configured_secret_is_shown_by_NAME(ws):
    _register(ws, source_id="src:1", sha="aaa", filename="hdfc-jul.pdf")
    _hints(ws, {"aaa": "hdfc.pass"})
    got = {d.source_id: d for d in _documents(ws)}["src:1"]
    assert got.password.kind is collateral.PasswordRef.NAMED
    assert got.password.name == "hdfc.pass"


def test_an_unnamed_opener_is_its_own_state_not_a_name(ws):
    """The state a two-state design would get wrong: something DID open it, but only a fingerprint was
    recorded — so there is no name to show, and 'nothing has opened this' would be false."""
    _register(ws, source_id="src:1", sha="aaa", filename="cas.pdf")
    _hints(ws, {"aaa": "pw:a1b2c3d4e5f6"})
    got = {d.source_id: d for d in _documents(ws)}["src:1"]
    assert got.password.kind is collateral.PasswordRef.UNNAMED
    assert got.password.name is None, "a fingerprint is not a name and must never be shown as one"


def test_a_document_nothing_has_opened_says_so(ws):
    _register(ws, source_id="src:1", sha="aaa", filename="scan.pdf")
    got = {d.source_id: d for d in _documents(ws)}["src:1"]
    assert got.password.kind is collateral.PasswordRef.NONE


def test_a_missing_hints_file_means_nothing_is_known_not_an_error(ws):
    """The hints file is an acceleration WLC keeps outside the store, so its absence is ordinary."""
    _register(ws, source_id="src:1", sha="aaa", filename="x.pdf")
    assert not (ws / collateral.HINTS_FILE).exists()
    assert _documents(ws)[0].password.kind is collateral.PasswordRef.NONE


def test_a_corrupt_hints_file_degrades_rather_than_breaking_the_pane(ws):
    _register(ws, source_id="src:1", sha="aaa", filename="x.pdf")
    (ws / collateral.HINTS_FILE).write_text("{not json")
    assert _documents(ws)[0].password.kind is collateral.PasswordRef.NONE


def test_no_password_VALUE_is_ever_carried(ws):
    _register(ws, source_id="src:1", sha="aaa", filename="hdfc-jul.pdf")
    _hints(ws, {"aaa": "hdfc.pass"})
    (ws / "hdfc.pass").write_text("the-actual-password")
    assert "the-actual-password" not in json.dumps([d.as_dict() for d in _documents(ws)])


# ── through the API ──────────────────────────────────────────────────────────────────────────────────

@pytest.fixture()
def client(tmp_path, ws):
    mf = tmp_path / "family.toml"
    mf.write_text(f'[family]\nreporting_currency = "INR"\n\n[[entity]]\nid = "alpha"\nworkspace = "{ws}"\n')
    return TestClient(create_app(mf, token="t"), headers={"host": HOST})


def test_the_workspace_pane_shows_paths_state_and_collateral(client, ws):
    _register(ws, source_id="src:1", sha="aaa", filename="hdfc-jul.pdf")
    body = client.get("/api/workspace/alpha").json()
    assert body["path"] == str(ws)
    assert body["workspace"]["availability"] == "ok"
    assert body["workspace"]["schema_version"]
    assert body["documents"][0]["filename"] == "hdfc-jul.pdf"
    assert body["settings"]["pan_set"] is False


def test_settings_change_through_the_api_and_report_back(client):
    body = client.post("/api/workspace/alpha/settings", json={"holder_names": ["Kolluri"]},
                       headers={TOKEN_HEADER: "t"}).json()
    assert body["holder_names"] == ["Kolluri"]


def test_a_refused_setting_names_the_field_so_a_form_can_point_at_it(client):
    response = client.post("/api/workspace/alpha/settings", json={"pan": "nope"},
                           headers={TOKEN_HEADER: "t"})
    assert response.status_code == 400
    assert response.json()["detail"]["field"] == "pan"


def test_changing_settings_needs_the_session_token(client):
    assert client.post("/api/workspace/alpha/settings", json={"organize": False}).status_code == 403
