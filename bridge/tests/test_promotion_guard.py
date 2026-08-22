"""The one irreversible act, and the gate this app owns.

WLC's `promote` has eight gates of its own, and the eighth — show the tally, type the store's name — needs
a terminal. The bridge runs verbs with stdin closed, so it must pass `--yes`, which skips exactly that
gate. The bridge therefore OWNS it, and owning it means enforcing it on the server: a disabled button is
not a guard for something that cannot be undone.
"""
from __future__ import annotations

import pathlib

import pytest
from fastapi.testclient import TestClient

from wealthlens_web.api.app import create_app
from wealthlens_web.api.security import TOKEN_HEADER
from wealthlens_web.core import verbs

HOST = "127.0.0.1:7788"


@pytest.fixture()
def app_client_ws(tmp_path, make_workspace):
    ws = make_workspace("alpha", {"A": 1000})
    mf = tmp_path / "family.toml"
    mf.write_text(f'[family]\nreporting_currency = "INR"\n\n[[entity]]\nid = "alpha"\nworkspace = "{ws}"\n')
    app = create_app(mf, token="t")
    return app, TestClient(app, headers={"host": HOST}), pathlib.Path(ws)


def _promote(client, **body):
    return client.post("/api/jobs", json={"verb": "promote", "entity": "alpha", **body},
                       headers={TOKEN_HEADER: "t"})


def _finished_rebuild(runner: verbs.Runner, workspace: pathlib.Path,
                      outcome: verbs.Outcome = verbs.Outcome.OK) -> verbs.Job:
    """A rebuild that has completed, as the runner would record one."""
    job = verbs.Job(id="rb1", verb="rebuild", entity_id="alpha", workspace=workspace.resolve(),
                    state=verbs.JobState.FINISHED, outcome=outcome)
    runner._jobs[job.id] = job
    return job


# ── the guard ────────────────────────────────────────────────────────────────────────────────────────

def test_promotion_without_a_reviewed_rebuild_is_refused(app_client_ws):
    """There is no tally to have reviewed, so there is nothing the user can have agreed to."""
    _, client, _ = app_client_ws
    response = _promote(client, confirm="alpha")
    assert response.status_code == 409
    assert "nothing has been rebuilt" in response.json()["detail"]["reason"]


def test_promotion_without_the_typed_confirmation_is_refused(app_client_ws):
    app, client, ws = app_client_ws
    _finished_rebuild(app.state.runner, ws)
    response = _promote(client, after="rb1")
    assert response.status_code == 409
    assert "type 'alpha'" in response.json()["detail"]["reason"]


def test_a_wrong_confirmation_is_refused(app_client_ws):
    app, client, ws = app_client_ws
    _finished_rebuild(app.state.runner, ws)
    assert _promote(client, confirm="beta", after="rb1").status_code == 409


def test_a_stale_tally_is_refused(app_client_ws):
    """The client is echoing a rebuild that is no longer the latest, so the tally on screen is not the one
    that would be installed. Promoting it would install something nobody reviewed."""
    app, client, ws = app_client_ws
    _finished_rebuild(app.state.runner, ws)
    newer = verbs.Job(id="rb2", verb="rebuild", entity_id="alpha", workspace=ws.resolve(),
                      state=verbs.JobState.FINISHED, outcome=verbs.Outcome.OK)
    app.state.runner._jobs[newer.id] = newer

    response = _promote(client, confirm="alpha", after="rb1")
    assert response.status_code == 409
    assert "newer rebuild" in response.json()["detail"]["reason"]


def test_a_rebuild_that_failed_does_not_count_as_review(app_client_ws):
    app, client, ws = app_client_ws
    _finished_rebuild(app.state.runner, ws, outcome=verbs.Outcome.FAILED)
    assert _promote(client, confirm="alpha", after="rb1").status_code == 409


def test_a_rebuild_for_another_workspace_does_not_count(app_client_ws, make_workspace):
    app, client, _ = app_client_ws
    elsewhere = make_workspace("beta", {"B": 1})
    _finished_rebuild(app.state.runner, pathlib.Path(elsewhere))
    assert _promote(client, confirm="alpha", after="rb1").status_code == 409


def test_a_reviewed_rebuild_lets_promotion_run(app_client_ws):
    """With the review in place the job starts — and the engine's own seven gates still apply to it."""
    app, client, ws = app_client_ws
    _finished_rebuild(app.state.runner, ws)
    response = _promote(client, confirm="alpha", after="rb1")
    assert response.status_code == 202
    assert response.json()["verb"] == "promote"


def test_the_guard_is_the_server_not_the_button(app_client_ws):
    """Called directly, with no UI involved, the refusal still stands."""
    app, _, ws = app_client_ws
    with pytest.raises(verbs.PromotionNotReviewed):
        app.state.runner.check_promotion(ws, after=None, confirm="alpha", expected="alpha")


# ── and the engine's gates are still there behind it ─────────────────────────────────────────────────

def test_the_engines_own_gates_still_refuse_underneath(app_client_ws):
    """The bridge owns gate eight. It does not replace the other seven — a promotion that passes the
    review guard still meets the engine's refusals, here with no candidate to install."""
    app, client, ws = app_client_ws
    _finished_rebuild(app.state.runner, ws)
    job_id = _promote(client, confirm="alpha", after="rb1").json()["id"]

    import time
    for _ in range(200):
        body = client.get(f"/api/jobs/{job_id}").json()
        if body["state"] == "finished":
            break
        time.sleep(0.05)

    assert body["outcome"] == "refused"
    assert body["gate"] == "no-candidate"
    assert body["changed_something"] is False
