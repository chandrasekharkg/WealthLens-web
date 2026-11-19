# ADR-0023 — The bridge's log says what happened, never to whose money

**Status:** PROPOSED 2026-11-19, to be ACCEPTED when `structured-logs` is implemented · Extends ADR-0003
(no telemetry) and ADR-0019 (secret exposure); supersedes nothing.

## Context

The bridge's only log today is what uvicorn prints: one access line per request with the **raw path and query
string**, plus a few server events. On a real household's machine that line has carried file names, statement
periods, providers and payload refs (`/api/workspace/<entity>/document/page?payload_ref=…&filename=…`). It stays on
the user's own disk, but it still records the household's documents in a file nobody thinks of as sensitive. It
also gives the reader nothing they want: no duration, no job outcome, and no way to tie a job to the request that
started it.

The home lab wants to ship its two instances' logs (dad's, and the owner's Mac) to its own log store, the
kgc_home_agents proposal `2026-11-19-lightweight-apps-observability`. WealthLens is built to run light on any user's
machine, so the lab copy is an exception. Everything lab-specific is the lab's: the collector, its parsing, the
dashboard and the alerts. The app's part must be useful to every user on its own and must add no dependency, port,
process or network call.

## Decision

1. **A log line carries shape, never values.** What a line may hold: route templates, methods, statuses, durations,
   job ids, verb names, outcomes, gate names, exit codes, exception *types*, and trace ids. What it never holds: query
   strings; raw paths; entity ids; amounts, names or file names; a verb's `message`, narration or stderr; and an
   exception's text or traceback. Secrets were already excluded (ADR-0019); this extends the rule to the household's
   data in general. The rule holds in every format and on every install, because the lab copy is just someone's log
   file shipped somewhere.
2. **The bridge writes its own access line** and turns uvicorn's off, in both formats. A launcher can't forget a
   flag that leaks, and there is one code path, not one for the lab.
3. **Two formats, one switch.** Human-readable text by default, because a person reads a terminal. Set
   `WLW_LOG_FORMAT=json` and every line is one JSON object, for anyone who pipes the log into a tool. The standard
   library only (`logging`, `json`, `contextvars`, `secrets`); no logging or tracing package.
4. **Correlation without a tracing library.** Each request gets a W3C trace id: the one in a well-formed incoming
   `traceparent`, otherwise a freshly generated one. A job carries the trace id of the request that submitted it. The
   header is a correlation id only. It authorises nothing, and a malformed one is replaced, not echoed.
5. **The bridge sends nothing anywhere.** It writes lines to its standard error. Shipping, retention and rotation
   belong to whoever runs it. ADR-0003's "no telemetry" stands unchanged.

## Consequences

- An owner's existing log keeps any values it already holds. The rule applies from the change forward, and a lab
  collector should start at the end of an existing file.
- Narration stays available where it always was, on the job, through the API (bridge-api "Narration never
  contaminates the result"). It just never reaches the process log.
- A future need for richer job summaries means an allow-listed set of count fields, with its own leak test. It
  never means "log the result".
