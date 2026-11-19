# Tasks — structured-logs

> Derived from proposal.md on 2026-11-19. Not started: the spec change lands first, and code waits for the owner's go.

- [ ] Bridge tests for each row of the test plan, each failing on today's code
- [ ] `wealthlens_web/logs.py` (stdlib only): a text and a JSON formatter, the trace-id `contextvars` value,
      and `traceparent` parsing
- [ ] An access middleware: the route template or a bucket, the status, the duration, and the trace id; uvicorn's
      `uvicorn.access` logger disabled at `create_app`
- [ ] Exception logging: the exception type and route only; the response is unchanged
- [ ] `Job` gains the submitting trace id and its start and finish times; the Runner writes `job_result` on every finish
      path, including "did not start: the app was stopping"
- [ ] Route the existing bare `print`s (the start-up address, "stopping job pid …") through the logger
- [ ] `serve.log_format()` reads `WLW_LOG_FORMAT` and refuses a bad value; the formatter is applied to the `uvicorn` and
      `uvicorn.error` loggers too
- [ ] README: the switch, the stream (stderr), and what a line never contains
- [ ] Mark ADR-0023 ACCEPTED, promote the spec delta into `openspec/specs/bridge-api/spec.md`, and archive the change
- [ ] Tell the kgc_home_agents controller the field names and the stream; its collector then sets `WLW_LOG_FORMAT=json`
      on both lab instances
