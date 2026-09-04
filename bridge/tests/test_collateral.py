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


def _register(ws: pathlib.Path, *, source_id: str, sha: str, filename: str, rows: int = 10,
              provider: str = "hdfc") -> None:
    import duckdb
    from wealthlens import cli

    key = (ws / "store.key").read_text().strip()
    con = duckdb.connect(":memory:")
    cli._attach(con, "wl", ws / "wealth_v3.duckdb", key)
    con.execute("USE wl")
    con.execute(
        "INSERT INTO sources (source_id, source_type, provider, content_sha256, payload_ref, row_count, "
        "captured_at, detail) VALUES (?, 'file', ?, ?, ?, ?, TIMESTAMP '2026-07-31 10:00:00', ?)",
        [source_id, provider, sha, f"statements/{filename}", rows, json.dumps({"filename": filename})],
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


def test_a_document_carries_its_catalog_format_id_and_statement_date(ws):
    """A document surfaces its STORE identity (`format_id`) and its statement date (`period_end`) so the picker
    can group by identity — folder-independent — and sort by date, not by filename. Two NSDL CAS filed in
    DIFFERENT folders (one hand-filed under `nsdl/`, one `organize`-filed under `statements/depository/cas/`)
    share the one `nsdl.cas` identity, so they group together and the newer sorts first. Regression for the
    raw-parse picker splitting one statement type across folder-derived categories (July CAS 'missing')."""
    import duckdb
    from wealthlens import cli
    from wealthlens import workspace as wl_workspace

    key = (ws / "store.key").read_text().strip()
    con = duckdb.connect(":memory:")
    cli._attach(con, "wl", ws / "wealth_v3.duckdb", key)
    con.execute("USE wl")
    for sid, folder, fn, pe in [
        ("cas:old", "nsdl", "NSDLe-CAS_JUN_2026.PDF", "2026-06-30"),
        ("cas:new", "statements/depository/cas", "NSDLe-CAS_JUL_2026.PDF", "2026-07-31"),
    ]:
        con.execute(
            "INSERT INTO sources (source_id, source_type, provider, format_id, content_sha256, payload_ref, "
            "period_start, period_end, captured_at, detail) VALUES (?, 'file', 'nsdl', 'nsdl.cas', ?, ?, ?, ?, "
            "TIMESTAMP '2026-08-01 10:00:00', ?)",
            [sid, sid, f"{folder}/{fn}", pe, pe, json.dumps({"filename": fn})],
        )
    con.execute("CHECKPOINT wl")
    con.close()

    with wl_workspace.resolve(ws).open() as con:
        docs = {d.source_id: d for d in collateral.documents(con, ws)}
    old, new = docs["cas:old"], docs["cas:new"]
    assert old.format_id == "nsdl.cas" and new.format_id == "nsdl.cas"   # ONE identity, though two folders …
    assert old.payload_ref.startswith("nsdl/")                            # … physically filed apart
    assert new.payload_ref.startswith("statements/depository/cas/")
    assert new.period_end == "2026-07-31" and old.period_end == "2026-06-30"   # statement dates → date-sortable


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


def _config(ws: pathlib.Path, body: str) -> None:
    (ws / "config.toml").write_text(body)


def test_a_pan_opened_document_infers_its_password_from_the_parser_config(ws):
    """The store recorded no hint for this file, but the config says the religare parser opens with the PAN
    (`[parser.religare] password = "@identity.pan"`). "Nothing has opened it" is then FALSE — the PAN did.
    With no explicit hint, the parser config is the authority, and the document reports a copyable PAN."""
    _register(ws, source_id="src:1", sha="aaa", filename="CN_20200114.pdf", provider="religare")
    _config(ws, '[parser.religare]\npassword = "@identity.pan"\n')
    got = {d.source_id: d for d in _documents(ws)}["src:1"]
    assert got.password.kind is collateral.PasswordRef.NAMED
    assert got.password.name == "pan"        # reveal(what="pan") copies it


def test_a_fingerprint_yields_to_a_config_that_NAMES_the_password(ws):
    """A fingerprint (UNNAMED) records only THAT a password opened the file, not which. The parser config
    knows which — so it wins over a bare fingerprint and the document shows the copyable PAN. (A NAMED hint,
    a specific .pass file, is more specific still and beats the config — see the CAS test above.)"""
    _register(ws, source_id="src:1", sha="aaa", filename="x.pdf", provider="religare")
    _config(ws, '[parser.religare]\npassword = "@identity.pan"\n')
    _hints(ws, {"aaa": "pw:deadbeef"})
    got = {d.source_id: d for d in _documents(ws)}["src:1"]
    assert got.password.kind is collateral.PasswordRef.NAMED and got.password.name == "pan"


def test_an_nsdl_cas_names_the_PAN_even_though_it_carries_a_fingerprint(ws):
    """The NSDL CAS case: the store DID keep a hint, but only a fingerprint (UNNAMED). The config knows the
    name the fingerprint does not — the depository CAS opens with the PAN (`[parser.cas]`, and nsdl/cdsl map
    to it). "An unnamed password" is unhelpful when the PAN is copyable; the config name wins over a bare
    fingerprint (a NAMED hint would still win over the config)."""
    _register(ws, source_id="src:1", sha="aaa", filename="NSDLe-CAS.pdf", provider="nsdl")
    _config(ws, '[parser.cas]\npassword = "@identity.pan"\n')
    _hints(ws, {"aaa": "pw:c3ef86857a63"})
    got = {d.source_id: d for d in _documents(ws)}["src:1"]
    assert got.password.kind is collateral.PasswordRef.NAMED
    assert got.password.name == "pan"


def test_a_named_pass_hint_still_beats_the_config_even_for_a_cas(ws):
    _register(ws, source_id="src:1", sha="aaa", filename="cas.pdf", provider="cdsl")
    _config(ws, '[parser.cas]\npassword = "@identity.pan"\n')
    _hints(ws, {"aaa": "cams.pass"})               # a specific recorded file — more specific than "the PAN"
    got = {d.source_id: d for d in _documents(ws)}["src:1"]
    assert got.password.kind is collateral.PasswordRef.NAMED and got.password.name == "cams.pass"


def test_an_unnamed_password_with_NO_config_match_stays_unnamed(ws):
    """Without a parser config that names the opener, a fingerprint is still just a fingerprint."""
    _register(ws, source_id="src:1", sha="aaa", filename="x.pdf", provider="somebank")
    _hints(ws, {"aaa": "pw:abcdef"})
    got = {d.source_id: d for d in _documents(ws)}["src:1"]
    assert got.password.kind is collateral.PasswordRef.UNNAMED


def test_a_provider_with_no_parser_password_stays_none(ws):
    _register(ws, source_id="src:1", sha="aaa", filename="scan.pdf", provider="somebank")
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


# ── the reveal endpoint (ADR-0019) ───────────────────────────────────────────────────────────────────

def test_revealing_needs_the_session_token(client):
    assert client.post("/api/workspace/alpha/reveal", json={"what": "pan"}).status_code == 403


def test_a_listing_never_carries_a_value(client, ws):
    """The shape that keeps the exception from widening: values come one at a time, by asking."""
    from wealthlens_web.core import settings

    settings.add_secret(ws, "hdfc2", "a-statement-password")
    body = client.get("/api/workspace/alpha").json()
    assert "hdfc2" in body["settings"]["secret_names"]
    assert "a-statement-password" not in json.dumps(body)


def test_one_explicit_request_returns_one_value(client, ws):
    from wealthlens_web.core import settings

    settings.add_secret(ws, "hdfc2", "a-statement-password")
    response = client.post("/api/workspace/alpha/reveal", json={"what": "hdfc2"},
                           headers={TOKEN_HEADER: "t"})
    assert response.status_code == 200
    assert response.json() == {"what": "hdfc2", "value": "a-statement-password"}


def test_the_store_key_is_not_revealable_through_the_api(client, ws):
    (ws / "store.key").write_text("the-actual-store-key")
    response = client.post("/api/workspace/alpha/reveal", json={"what": "store.key"},
                           headers={TOKEN_HEADER: "t"})
    assert response.status_code == 404
    assert "the-actual-store-key" not in response.text
