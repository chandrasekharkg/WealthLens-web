"""The bridge's log records what happened and never whose money (structured-logs, ADR-0023).

Until now the only access log was uvicorn's, which printed the raw path and query string. Opening a
statement page wrote its file name, period, provider and payload ref into the log. These tests feed invented
markers through every route a value could travel by and assert that none of them comes out, in either format.
No engine and no browser are needed: TestClient, plus the stand-in engine from test_stop_jobs_on_shutdown.
"""
from __future__ import annotations

import io
import json
import logging
import pathlib
import re
import stat
import time

import pytest
from fastapi.testclient import TestClient

from wealthlens_web import logs
from wealthlens_web.api.app import create_app
from wealthlens_web.core import verbs

# Invented markers: if any of them shows up in a log line, a value leaked.
FILE = "Zmarker-Statement-4471.pdf"
PERIOD = "Zmarker-2031-02"
REF = "statements/zmarker/Zmarker-Statement-4471.pdf"
ENTITY = "zentity"
AMOUNT = "987654.32"
MARKERS = (FILE, PERIOD, "zmarker", ENTITY, AMOUNT, "?")
TRACE = "4bf92f3577b34da6a3ce929d0e0e4736"


@pytest.fixture(params=["text", "json"])
def log(request):
    """Route the bridge's log into a buffer in the given format; restore the loggers afterwards."""
    names = ("wealthlens_web", "uvicorn", "uvicorn.error", "uvicorn.access")
    saved = {n: (lg.handlers[:], lg.level, lg.propagate, lg.disabled)
             for n in names for lg in [logging.getLogger(n)]}
    buf = io.StringIO()
    logs.configure(request.param, stream=buf)
    buf.fmt = request.param
    yield buf
    for n, (h, lvl, prop, dis) in saved.items():
        lg = logging.getLogger(n)
        lg.handlers, lg.level, lg.propagate, lg.disabled = h, lvl, prop, dis


def _lines(buf) -> list[str]:
    return [line for line in buf.getvalue().splitlines() if line.strip()]


def _records(buf) -> list[dict]:
    assert buf.fmt == "json"
    return [json.loads(line) for line in _lines(buf)]


def _assert_clean(buf) -> None:
    out = buf.getvalue()
    for marker in MARKERS:
        assert marker not in out, f"{marker!r} reached the log:\n{out}"


@pytest.fixture()
def client(tmp_path):
    ws = tmp_path / "zentity-WealthLens-data"
    ws.mkdir()
    mf = tmp_path / "family.toml"
    mf.write_text(f'[family]\nreporting_currency = "INR"\n\n[[entity]]\nid="{ENTITY}"\nworkspace="{ws}"\n')
    app = create_app(mf, host="127.0.0.1", port=8765, token="t")

    @app.get("/api/zz-test/boom", include_in_schema=False)
    def boom():                                        # a fault whose text quotes a value
        raise RuntimeError(f"could not read {FILE} for {AMOUNT}")

    return TestClient(app, base_url="http://127.0.0.1:8765")


# ── the access line ────────────────────────────────────────────────────────────────────────────────────

def test_opening_a_statement_page_logs_the_route_template_and_none_of_its_values(client, log):
    r = client.get(f"/api/workspace/{ENTITY}/document/page",
                   params={"page": 2, "filename": FILE, "payload_ref": REF, "provider": "zmarker",
                           "period": PERIOD})
    assert r.status_code == 404                       # no such file; the line is what matters
    lines = _lines(log)
    assert len(lines) == 1, lines
    assert "/api/workspace/{entity_id}/document/page" in lines[0]
    assert "404" in lines[0]
    _assert_clean(log)
    if log.fmt == "json":
        (rec,) = _records(log)
        assert rec["route"] == "/api/workspace/{entity_id}/document/page"
        assert rec["method"] == "GET" and rec["status"] == 404
        assert isinstance(rec["duration_ms"], (int, float)) and rec["duration_ms"] >= 0
        assert len(rec["trace_id"]) == 32


def test_a_path_that_matches_no_route_is_logged_as_a_bucket_never_as_itself(client, log):
    client.get(f"/{ENTITY}/{FILE}")
    out = log.getvalue()
    assert "unmatched" in out
    _assert_clean(log)


def test_static_paths_fall_in_the_static_bucket():
    assert logs.route_of({"path": "/assets/index-x1.js"}) == "static"
    assert logs.route_of({"path": "/"}) == "unmatched"           # no route matched (no built frontend)

    class R:                                                     # what FastAPI leaves in the scope
        path = "/"
    assert logs.route_of({"path": "/", "route": R()}) == "static"
    R.path = "/api/jobs/{job_id}"
    assert logs.route_of({"path": "/api/jobs/abc", "route": R()}) == "/api/jobs/{job_id}"


def test_uvicorns_own_access_log_is_off_once_the_app_exists(client):
    access = logging.getLogger("uvicorn.access")
    assert access.disabled and not access.propagate        # (pytest attaches its own capture handlers)


# ── errors ─────────────────────────────────────────────────────────────────────────────────────────────

def test_an_unhandled_error_logs_its_type_and_route_never_its_text(client, log):
    r = client.get("/api/zz-test/boom")
    assert r.status_code == 500
    out = log.getvalue()
    assert "RuntimeError" in out and "/api/zz-test/boom" in out
    assert "Traceback" not in out
    _assert_clean(log)


# ── the trace id ───────────────────────────────────────────────────────────────────────────────────────

def test_a_well_formed_traceparent_is_the_requests_trace_id(client, log):
    if log.fmt != "json":
        pytest.skip("fields are read from JSON")
    client.get("/api/version", headers={"traceparent": f"00-{TRACE}-00f067aa0ba902b7-01"})
    (rec,) = _records(log)
    assert rec["trace_id"] == TRACE


@pytest.mark.parametrize("header", [
    f"00-{'0' * 32}-00f067aa0ba902b7-01",                        # an all-zero trace id is invalid by the standard
    f"00-{TRACE}-{'0' * 16}-01",                                 # so is an all-zero span id
    f"00-{TRACE.upper()}-00f067aa0ba902b7-01",                   # upper-case hex is not the standard's form
    f"00-{TRACE}-00f067aa0ba902b7-01\n{FILE}",                   # a line break, i.e. log injection
    "zmarker",
])
def test_a_malformed_traceparent_is_replaced_and_never_echoed(header):
    got = logs.trace_from(header)
    assert re.fullmatch(r"[0-9a-f]{32}", got)
    assert got != TRACE and got not in header


def test_with_no_traceparent_each_request_gets_its_own_id():
    assert logs.trace_from(None) != logs.trace_from(None)


# ── job_result ─────────────────────────────────────────────────────────────────────────────────────────

def _engine(tmp_path: pathlib.Path, *, exit_code: int, envelope: dict) -> str:
    """A fake `python` that narrates a value on stderr and returns an envelope whose message quotes one."""
    script = tmp_path / "engine.sh"
    script.write_text(f"""#!/bin/sh
echo "reading {FILE}: balance {AMOUNT}" >&2
echo '{json.dumps(envelope)}'
exit {exit_code}
""")
    script.chmod(script.stat().st_mode | stat.S_IXUSR)
    return str(script)


def test_a_finished_job_leaves_one_result_line_and_none_of_its_words(tmp_path, log):
    env = {"verb": "rebuild", "outcome": "refused", "exit_code": 2, "gate": "footing",
           "message": f"{FILE} does not foot by {AMOUNT}", "tally": {"zmarker": 1}}
    runner = verbs.Runner(python=_engine(tmp_path, exit_code=2, envelope=env))
    token = logs.TRACE.set(TRACE)                     # the request that submitted it
    try:
        job = runner.submit("rebuild", entity_id=ENTITY, workspace=tmp_path)
    finally:
        logs.TRACE.reset(token)
    deadline = time.monotonic() + 10
    while "job_result" not in log.getvalue() and "rebuild refused" not in log.getvalue():
        assert time.monotonic() < deadline, "no job_result line"
        time.sleep(0.02)
    time.sleep(0.05)
    assert job.outcome is verbs.Outcome.REFUSED and job.message      # the job keeps its message, for the API
    assert len(_lines(log)) == 1
    _assert_clean(log)
    if log.fmt == "json":
        (rec,) = _records(log)
        assert rec["event"] == "job_result" and rec["level"] == "warning"
        assert rec["job"] == "rebuild" and rec["job_id"] == job.id
        assert rec["outcome"] == "refused" and rec["gate"] == "footing" and rec["exit_code"] == 2
        assert rec["duration_s"] >= 0 and rec["trace_id"] == TRACE
        assert "message" not in rec and "entity_id" not in rec


def test_a_job_refused_because_the_app_was_stopping_still_leaves_its_result_line(tmp_path, log):
    runner = verbs.Runner(python=_engine(tmp_path, exit_code=0, envelope={"outcome": "ok"}))
    runner.shutdown(grace=0)
    runner.run("verify", entity_id=ENTITY, workspace=tmp_path)
    out = log.getvalue()
    assert "verify" in out and "failed" in out
    _assert_clean(log)


# ── the format ─────────────────────────────────────────────────────────────────────────────────────────

def test_every_line_is_json_in_json_mode_and_none_is_in_text_mode(client, log):
    client.get("/api/version")
    logging.getLogger("uvicorn.error").info("Started server process [1]")    # one of uvicorn's own lines
    lines = _lines(log)
    assert len(lines) == 2
    for line in lines:
        if log.fmt == "json":
            rec = json.loads(line)
            assert {"time", "level", "msg"} <= rec.keys()
        else:
            with pytest.raises(ValueError):
                json.loads(line)


def test_the_format_is_read_from_the_environment_and_a_bad_one_refuses_to_start(monkeypatch):
    from wealthlens_web import serve
    monkeypatch.delenv("WLW_LOG_FORMAT", raising=False)
    assert serve.log_format() == "text"
    monkeypatch.setenv("WLW_LOG_FORMAT", "json")
    assert serve.log_format() == "json"
    for bad in ("jsno", "JSON5", ""):
        monkeypatch.setenv("WLW_LOG_FORMAT", bad)
        if bad == "":
            assert serve.log_format() == "text"       # empty is unset
            continue
        with pytest.raises(SystemExit):
            serve.log_format()
