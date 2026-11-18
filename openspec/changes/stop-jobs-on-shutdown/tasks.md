# Tasks — stop-jobs-on-shutdown

> Derived from proposal.md on 2026-11-19. Done the same day: bridge suite 287 passed (5 new; all fail on main).

- [x] Bridge tests for each row of the test plan, failing on today's code
- [x] `Runner.shutdown(grace)`: refuse new work, SIGTERM the verbs it started, wait, SIGKILL after the grace
- [x] FastAPI lifespan calls it; `WLW_STOP_GRACE` read by `serve.py` (default 15 s)
- [x] README: the stop grace, and a supervisor's stop timeout above it
- [x] Promote the spec delta into `openspec/specs/bridge-api/spec.md`
