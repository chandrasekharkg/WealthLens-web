"""Stopping the app stops its running verbs, cleanly and within a bound (stop-jobs-on-shutdown).

A long power cut now ends in a forced host halt: SIGTERM, then SIGKILL a few minutes later. The bridge runs each
verb as a subprocess, and until now nothing stopped that subprocess when the bridge stopped. A verb either got
an unannounced signal (systemd's cgroup) or was orphaned holding the workspace (a single-pid kill). The stand-in
"engine" here is a shell script handed to the Runner as its interpreter, so no WLC is needed.
"""
from __future__ import annotations

import pathlib
import stat
import time

import pytest
from fastapi.testclient import TestClient

from wealthlens_web.api.app import create_app
from wealthlens_web.core import verbs

ENVELOPE = '{"verb":"rebuild","outcome":"failed","exit_code":130,"message":"interrupted"}'


def _engine(tmp_path: pathlib.Path, *, on_term: str) -> pathlib.Path:
    """A fake `python` that ignores its `-m wealthlens.cli …` arguments, says it began, and runs until stopped."""
    script = tmp_path / "engine.sh"
    script.write_text(f"""#!/bin/sh
trap '{on_term}' TERM
touch "{tmp_path}/began"
while :; do sleep 0.05; done
""")
    script.chmod(script.stat().st_mode | stat.S_IXUSR)
    return script


def _wait_for(path: pathlib.Path, seconds: float = 10) -> None:
    deadline = time.monotonic() + seconds
    while not path.exists():
        assert time.monotonic() < deadline, f"{path.name} never appeared"
        time.sleep(0.02)


def test_a_running_verb_is_sent_sigterm_and_waited_for(tmp_path):
    clean = f"touch {tmp_path}/got-term; echo '{ENVELOPE}'; exit 130"
    runner = verbs.Runner(python=str(_engine(tmp_path, on_term=clean)))
    job = runner.submit("rebuild", entity_id="alpha", workspace=tmp_path)
    _wait_for(tmp_path / "began")
    runner.shutdown(grace=10)
    assert (tmp_path / "got-term").exists()                  # a SIGTERM, not a kill
    assert runner.our_pids == frozenset()                     # nothing it started outlives it
    _wait_for_state(job, verbs.JobState.FINISHED)
    assert job.outcome is verbs.Outcome.FAILED and job.exit_code == 130


def test_a_verb_that_ignores_sigterm_is_killed_when_the_grace_runs_out(tmp_path):
    runner = verbs.Runner(python=str(_engine(tmp_path, on_term="")))   # an empty trap ignores TERM
    job = runner.submit("rebuild", entity_id="alpha", workspace=tmp_path)
    _wait_for(tmp_path / "began")
    t0 = time.monotonic()
    runner.shutdown(grace=0.5)
    assert time.monotonic() - t0 < 5                          # it does not wait past the grace
    assert runner.our_pids == frozenset()
    _wait_for_state(job, verbs.JobState.FINISHED)
    assert job.outcome is verbs.Outcome.FAILED


def test_after_shutdown_new_work_never_starts_and_says_why(tmp_path):
    runner = verbs.Runner(python=str(_engine(tmp_path, on_term="exit 130")))
    runner.shutdown(grace=1)
    job = runner.run("verify", entity_id="alpha", workspace=tmp_path)
    assert not (tmp_path / "began").exists()
    assert job.state is verbs.JobState.FINISHED and job.outcome is verbs.Outcome.FAILED
    assert "stopping" in job.message


def test_leaving_the_apps_lifespan_shuts_the_runner_down(tmp_path, make_workspace):
    a = make_workspace("alpha", {"A": 1})
    mf = tmp_path / "family.toml"
    mf.write_text(f'[family]\nreporting_currency = "INR"\n\n[[entity]]\nid="alpha"\nworkspace="{a}"\n')

    class Stub(verbs.Runner):
        def __init__(self):
            super().__init__()
            self.graces: list[float] = []

        def shutdown(self, grace=verbs.STOP_GRACE):
            self.graces.append(grace)

    runner = Stub()
    with TestClient(create_app(mf, runner=runner, stop_grace=7)):
        assert runner.graces == []
    assert runner.graces == [7]


def _wait_for_state(job, state, seconds: float = 10) -> None:
    deadline = time.monotonic() + seconds
    while job.state is not state:
        assert time.monotonic() < deadline, f"job stuck in {job.state}"
        time.sleep(0.02)


@pytest.fixture(autouse=True)
def _no_leftover_engines(tmp_path):
    yield
    # a failing test must not leave a looping stand-in behind
    import subprocess
    subprocess.run(["pkill", "-f", str(tmp_path / "engine.sh")], check=False)


def test_the_stop_grace_is_read_from_the_environment_and_a_bad_one_refuses_to_start(monkeypatch):
    from wealthlens_web import serve
    monkeypatch.delenv("WLW_STOP_GRACE", raising=False)
    assert serve.stop_grace() == verbs.STOP_GRACE
    monkeypatch.setenv("WLW_STOP_GRACE", "25")
    assert serve.stop_grace() == 25.0
    for bad in ("soon", "-1", "9999"):
        monkeypatch.setenv("WLW_STOP_GRACE", bad)
        with pytest.raises(SystemExit):
            serve.stop_grace()
