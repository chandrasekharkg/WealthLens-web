# stop-jobs-on-shutdown — stopping the app stops its running verbs, cleanly and within a bound

> **Status: implemented 2026-11-19 (spec promoted).** Raised by the home lab's UPS programme: a long power cut now ends in a forced
> host halt (SIGTERM, then SIGKILL a few minutes later). Pairs with WLC `shutdown-safe-writes`, which makes a
> verb stopped mid-write leave no file that looks finished.

## What happens today

The bridge runs each verb as a `python -m wealthlens.cli` subprocess and nothing stops it when the bridge stops.
- **Under systemd** (dad's `wealthlens-dad.service`) the unit's whole cgroup gets SIGTERM, so the verb is signalled
  anyway, but the bridge does not wait for it or say what it stopped. The journal shows only uvicorn's lines.
- **When only the bridge's own process is signalled** (`kill <pid>`, the launcher's stale-port cleanup, a
  supervisor that signals one pid), the verb is orphaned. It runs on with nobody to read its result, still
  holding the workspace.

## What changes

On shutdown (FastAPI lifespan exit) the runner:
1. stops accepting work: a queued job, or one submitted after this point, finishes as `failed` with a message
   saying the app was stopping, and never starts;
2. sends SIGTERM to every verb it started and logs which job it stopped;
3. waits up to `WLW_STOP_GRACE` seconds (default 15) for them to exit, then SIGKILLs any that remain.

With WLC `shutdown-safe-writes`, a verb stopped this way removes its partial files and reports `interrupted`.
A verb killed after the grace leaves at worst a hidden `.partial`. Either way the live store is untouched, as the
existing restart requirement already says.

Deployment note (not code): a supervisor's stop timeout should exceed the grace, e.g. `TimeoutStopSec=30` for
the default 15 s. uvicorn waits for open connections before the app's shutdown runs, and a job's progress stream
stays open while the job runs, so the launcher bounds that wait (`--timeout-graceful-shutdown 5`, written by WLC's
`bootstrap.py`; set it by hand in a hand-written launcher).

## Test plan (bridge pytest)

| Assertion | Why pytest can hold it |
|---|---|
| A running verb receives SIGTERM at shutdown and the runner waits for it to exit | a stand-in "engine" script that records the signal |
| A verb that ignores SIGTERM is killed once the grace expires, and shutdown returns within about the grace | the same script, trapping TERM |
| After shutdown a submitted job never starts and finishes `failed`, saying why | runner state, no process |
| Leaving the app's lifespan calls the runner's shutdown | `TestClient` as a context manager with a stub runner |
