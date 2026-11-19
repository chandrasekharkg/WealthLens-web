# Bridge API

## ADDED Requirements

### Requirement: A log line carries shape, never household values

The bridge SHALL write one access line per request, with the method, the matched route's **template**, the status,
the duration in milliseconds and a trace id. A path that matches no API route SHALL be logged as a fixed bucket
(`static` or `unmatched`), never as the raw path. uvicorn's own access log SHALL be disabled by the app.

No line the bridge writes, in any format, SHALL contain a query string, a raw path, an entity id, a verb's
message, narration or stderr, an exception's text or traceback, or any amount, name or file name
([ADR-0023](../../../../../decisions/0023-logs-carry-shape-not-values.md)).

#### Scenario: Opening a statement page
- **WHEN** the browser requests a document page with the file name, period and payload ref in its query string
- **THEN** the log has one access line naming the route template, the status and the duration, and none of those
  values

#### Scenario: A request that fails inside the bridge
- **WHEN** a route raises an exception whose text quotes a value
- **THEN** the log records an error with the route and the exception's type, and not its text

### Requirement: Each job leaves one result line, tied to the request that started it

When a job finishes, by any path (completed, refused, failed, timed out, or never started because the app was
stopping), the bridge SHALL write one `job_result` line with the verb, the job id, the outcome, the gate if one
refused, the exit code, the duration, and the trace id of the request that submitted it.

#### Scenario: A rebuild that refuses
- **WHEN** a rebuild started from the UI is refused by a gate
- **THEN** one `job_result` line at warning level names the verb, the outcome `refused` and the gate, carries
  the submitting request's trace id, and has neither the verb's message nor its narration

### Requirement: A trace id is accepted only when well formed

The bridge SHALL take a request's trace id from an incoming W3C `traceparent` only when the header is well formed
and its trace and span ids are non-zero; otherwise it SHALL generate a fresh random one. The trace id SHALL be
used only to correlate lines and SHALL authorise nothing.

#### Scenario: Behind the TLS front
- **WHEN** the front forwards a well-formed `traceparent`
- **THEN** every line written for that request, and the `job_result` of a job it submitted, carries that trace id

#### Scenario: A malformed header
- **WHEN** a request carries a `traceparent` that is malformed or all zeros
- **THEN** the request's lines carry a freshly generated trace id, and the supplied text appears nowhere

### Requirement: Readable by default, JSON on request

The log format SHALL be set by `WLW_LOG_FORMAT`: `text` (the default), one readable line per event; or `json`,
one JSON object per line with `time`, `level` and `msg`, covering the bridge's own lines and uvicorn's server
events. Any other value SHALL refuse to start. The bridge SHALL write its log to standard error only, and SHALL
open no log file and send no log anywhere.

#### Scenario: A lab instance
- **WHEN** the bridge starts with `WLW_LOG_FORMAT=json`
- **THEN** every line it writes parses as one JSON object

#### Scenario: A typo in the switch
- **WHEN** the bridge starts with `WLW_LOG_FORMAT=jsno`
- **THEN** it refuses to start and names the accepted values
