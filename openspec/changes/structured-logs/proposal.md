# structured-logs — a log that says what happened, in text or JSON, and never to whose money

> **Status: proposed 2026-11-19, not implemented.** Decision: [ADR-0023](../../decisions/0023-logs-carry-shape-not-values.md).
> Raised by the kgc_home_agents proposal `2026-11-19-lightweight-apps-observability` (v2, after this repo's review),
> which ships the home lab's two instances' logs to its own log store. The lab owns everything lab-specific (the
> collector, its parsing, the dashboard, the alerts). This change is the app's whole part: useful on every install,
> with no new dependency.

## What happens today

- The only access log is uvicorn's: `INFO: 127.0.0.1:59509 - "GET /api/workspace/me/document/page?page=1&payload_ref=…&filename=… HTTP/1.1" 200 OK`.
  It holds the raw path and query string, so it holds file names, statement periods, providers and the entity id.
  It has no duration.
- A job leaves no line when it finishes. Its outcome lives only in memory, for the API, until a restart.
- Nothing ties a job to the request that started it, or a request to the TLS front's view of it.
- The bridge's own lines (the start-up address, "stopping job pid …") are bare `print`s to stderr.

## What changes

1. **The bridge writes its own access line**, one per request, after the response: `method`, `route` (the matched
   route's template, e.g. `/api/workspace/{entity_id}/document/page`), `status`, `duration_ms`, `trace_id`. Paths that
   match no API route log a fixed bucket instead (`static` for `/assets/…` and `/`, `unmatched` otherwise), never
   the raw path. **uvicorn's access logger is turned off by the app**, so no launcher has to remember a flag.
2. **`job_result`, one line when each job finishes:** `job` (the verb), `job_id`, `outcome`, `gate` (if it refused),
   `exit_code`, `duration_s`, `trace_id` (the submitting request's). Level `info` for ok, `warning` for
   attention/refused, `error` for failed. **No `message`, no narration, no stderr, no entity id, no result payload.**
   v1 has no `summary` field. Counts can come later through an allow-list with its own leak test (ADR-0023).
3. **A trace id per request.** Taken from an incoming `traceparent` only when it matches
   `00-<32 hex>-<16 hex>-<2 hex>` with a non-zero trace and span id; otherwise one is generated
   (`secrets.token_hex(16)`). It's held in a `contextvars` value that the formatter reads, so every line written while
   serving that request carries it. A job copies it when submitted. The header authorises nothing.
4. **An unhandled error in a request** logs `error` with the route, the status and the exception's *type* only. Its
   text and traceback are never logged, because an exception message can quote a value. The response is unchanged.
5. **One switch, `WLW_LOG_FORMAT`:** `text` (the default) or `json`. In `text` the same fields print as one readable
   line, e.g. `GET /api/networth 200 12ms`. In `json` every line the bridge writes, its own and uvicorn's server
   events, is one JSON object with `time` (UTC ISO-8601), `level`, `msg`, and the fields above when known. Any other
   value refuses to start, as `WLW_STOP_GRACE` does.
6. **One stream, standard error**, where the bridge's diagnostics and uvicorn's server events already go. The bridge
   opens no file and sends nothing (ADR-0003). Rotation and shipping belong to whoever redirects the stream: systemd's
   journal on AIPC, and on the Mac whatever the launcher or a launchd agent chooses.

What does **not** change: WLC (a verb's stdout stays its result envelope, untouched); the job API and its narration;
the frontend; `wealthlens-serve`'s flags. The standard library only (`logging`, `json`, `contextvars`, `secrets`).

## Test plan (bridge pytest — AGENTS.md §1, first layer)

Every row runs through `TestClient` or the Runner with a stand-in engine (as in `test_stop_jobs_on_shutdown.py`),
and captures the log handler's output. No browser and no WLC are needed.

| Assertion | Why pytest can hold it |
|---|---|
| **The leak test:** a request to a document route with synthetic `?filename=…&period=…&payload_ref=…` writes exactly one access line, in both formats. Its `route` is the template, and no `?`, no query value and no entity id appears anywhere in the captured output | `TestClient` plus the captured handler; the values are invented markers |
| A request to `/assets/x.js` logs `route=static`, and to `/nope` logs `route=unmatched`; the raw path never appears | the same |
| A well-formed `traceparent` sets `trace_id` to its trace part. A malformed one, or one whose trace is all zeros, gets a fresh 32-hex id that is not the supplied text | header in, captured field out |
| `job_result`: a stand-in engine whose envelope `message` and stderr carry synthetic markers (a file name, an amount) yields one `job_result` with the outcome, exit code, job id, a `duration_s` ≥ 0, and the submitting request's `trace_id`. None of the markers or the entity id appears | Runner with the stand-in from `test_stop_jobs_on_shutdown.py` |
| A route that raises an exception with a synthetic marker in its text logs `error` with the exception type, and the marker appears nowhere | a test-only route added to the app under test |
| In `json` mode every captured line parses as JSON and has `time`, `level`, `msg`; in `text` mode no line is JSON | parse each line |
| uvicorn's access logger is disabled once the app is created | `logging.getLogger("uvicorn.access")` state |
| `WLW_LOG_FORMAT`: unset → `text`, `json` → `json`, anything else → refuses to start | `serve.log_format()`, as `stop_grace()` is tested |

Each test must fail on today's code. The leak test fails today because uvicorn's own line has the query string; under
`TestClient` the assertion is that the bridge's line exists and the uvicorn logger is off.

## Out of scope

- Shipping, parsing, dashboards and alerts are the lab's (kgc_home_agents).
- The 02:30 nightly check is the lab's cron, not a WLW job; its heartbeat comes from the lab's wrapper.
- OpenTelemetry, any tracing or logging package, and a log file written by the app.
- WLC's own logging: verbs run as subprocesses whose stdout is the result contract, so they get no log lines.
