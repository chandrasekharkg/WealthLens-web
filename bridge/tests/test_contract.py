"""The published contract, and the streamed one.

Two seams that break silently if nobody watches them: the API's shape drifting from the document the
frontend's types are generated from, and a long verb whose progress nobody can see.
"""
from __future__ import annotations

import json
import pathlib
import sys

import pytest
from fastapi.testclient import TestClient

from wealthlens_web.api.app import create_app
from wealthlens_web.api.security import TOKEN_HEADER
from wealthlens_web.core import verbs

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts"))
import export_schema

HOST = "127.0.0.1:7788"


# ── the published contract ───────────────────────────────────────────────────────────────────────────

def test_the_committed_schema_matches_the_live_app():
    """The drift gate.

    The frontend's types are generated from the committed document, so if the app's shape moves and the
    document does not, the UI is typed against an API that no longer exists — and nothing would say so
    until a household's dashboard rendered undefined. Regenerate with:

        python bridge/scripts/export_schema.py
    """
    committed = json.loads(export_schema.SCHEMA_PATH.read_text())
    live = json.loads(json.dumps(export_schema.schema(), sort_keys=True))
    assert live == committed, (
        "the API's shape has changed but frontend/src/api/openapi.json has not — run "
        "`python bridge/scripts/export_schema.py` and commit the result")


def test_the_contract_publishes_every_endpoint_the_ui_needs():
    paths = set(export_schema.schema()["paths"])
    assert {"/api/version", "/api/networth", "/api/positions", "/api/transactions",
            "/api/jobs", "/api/jobs/{job_id}"} <= paths


def test_money_is_published_as_a_string_not_a_number():
    """A JSON number is an IEEE double. Putting a household's net worth through one would undo the
    DECIMAL(18,2) the store keeps."""
    money = export_schema.schema()["components"]["schemas"]["Money"]
    assert money["properties"]["amount"]["type"] == "string"


def test_the_honesty_fields_are_part_of_the_contract():
    """These are not decorations — a client must be typed to know a total is partial and why."""
    schemas = export_schema.schema()["components"]["schemas"]
    assert "is_partial" in schemas["NetWorth"]["properties"]
    entity = schemas["EntityTotal"]["properties"]
    assert {"contributes", "excluded_reason", "owner_warning", "evidence_as_of"} <= set(entity)
    job = schemas["Job"]["properties"]
    assert {"outcome", "gate", "changed_something"} <= set(job)


# ── the stream ───────────────────────────────────────────────────────────────────────────────────────

@pytest.fixture()
def app_and_client(tmp_path, make_workspace):
    a = make_workspace("alpha", {"A Share": 1000})
    mf = tmp_path / "family.toml"
    mf.write_text(f'[family]\nreporting_currency = "INR"\n\n[[entity]]\nid = "alpha"\nworkspace = "{a}"\n')
    app = create_app(mf, token="t")
    return app, TestClient(app, headers={"host": HOST})


def _read_events(client, url) -> list[tuple[str, str]]:
    with client.stream("GET", url) as r:
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/event-stream")
        events, name = [], None
        for line in r.iter_lines():
            if line.startswith("event: "):
                name = line[7:]
            elif line.startswith("data: ") and name:
                events.append((name, line[6:]))
        return events


def test_a_stream_ends_with_the_outcome(app_and_client):
    _, client = app_and_client
    r = client.post("/api/jobs", json={"verb": "verify", "entity": "alpha"},
                    headers={TOKEN_HEADER: "t"})
    events = _read_events(client, f"/api/jobs/{r.json()['id']}/stream")

    assert events and events[-1][0] == "done", "a stream must always finish by saying how it ended"
    done = json.loads(events[-1][1])
    assert done["state"] == "finished" and done["outcome"] in {"ok", "attention"}


def test_narration_is_streamed_as_opaque_lines(app_and_client):
    """Only `import` publishes structure mid-run, so parsing prose into progress would mean inventing a
    contract that does not exist and breaking it on the next copy edit upstream."""
    _, client = app_and_client
    r = client.post("/api/jobs", json={"verb": "verify", "entity": "alpha"}, headers={TOKEN_HEADER: "t"})
    events = _read_events(client, f"/api/jobs/{r.json()['id']}/stream")
    logs = [json.loads(d) for name, d in events if name == "log"]
    assert all(isinstance(line, str) for line in logs)


def test_the_outcome_survives_the_stream_closing(app_and_client):
    """A viewer who navigates away, or reconnects, must still learn what happened — the stream is a
    convenience, never the record."""
    _, client = app_and_client
    r = client.post("/api/jobs", json={"verb": "verify", "entity": "alpha"}, headers={TOKEN_HEADER: "t"})
    job_id = r.json()["id"]
    _read_events(client, f"/api/jobs/{job_id}/stream")

    after = client.get(f"/api/jobs/{job_id}").json()
    assert after["state"] == "finished" and after["outcome"] is not None


def test_streaming_a_job_this_session_never_ran_says_so(app_and_client):
    _, client = app_and_client
    r = client.get("/api/jobs/deadbeef/stream")
    assert r.status_code == 404 and "restart forgets" in r.json()["detail"]["reason"]


def test_a_verbs_narration_is_kept_line_by_line(make_workspace):
    """The runner must accumulate lines as they arrive, not hand over one blob at the end — a viewer needs
    to ask 'what is new since line N?'."""
    a = make_workspace("alpha", {"A": 1})
    job = verbs.Runner().run("verify", entity_id="alpha", workspace=pathlib.Path(a))
    assert isinstance(job.log_lines, list)
    assert job.log == "\n".join(job.log_lines)
