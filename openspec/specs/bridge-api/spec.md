# Bridge API

The single seam between the SPA and the stores: a local JSON API over `lens.py` (read-only against WLC
stores), plus the manifest and a **closed, enumerated set** of side-effecting hand-offs to WLC (verb runs,
upload/inbox, config/secret writes). Security posture per ADR-0004, as superseded on the LAN question by
[ADR-0020](../../decisions/0020-lan-serving-and-write-surface.md).

## ADDED Requirements

### Requirement: No endpoint writes a store, and the side-effecting set is closed

The bridge SHALL open every WLC store read-only, and no endpoint SHALL execute a write against a store.
Side effects are limited to a **closed, enumerated set**, each a hand-off to WLC rather than an act of
custody (ADR-0005): depositing an upload into a workspace inbox; writing a value into that workspace's WLC
configuration by WLC's own convention (setup-and-config, identity-and-settings); running a WLC verb as a
subprocess (list-args, stdin closed, timeout) against exactly one named, manifest-declared workspace; and
writing WLW's own manifest. Anything outside that list is a defect.

> Earlier drafts called the bridge "read-only, with import as the sole side effect". That was never true of
> the design — uploads, password writes and other verbs all have effects. The honest invariant is the one
> above: **no store writes**, and a list short enough to audit.

#### Scenario: Import against "all" is refused
- **WHEN** the import endpoint is called without a single named entity
- **THEN** it refuses — there is no "import into all" (each import is one workspace's own gates)

#### Scenario: A new side effect appears
- **WHEN** an endpoint is added that writes anywhere
- **THEN** it either belongs to the enumerated set or the spec changes first — the list is the contract

### Requirement: Loopback by default; LAN serving is a trusted-LAN capability

The bridge SHALL bind loopback **by default**; SHALL reject requests whose `Host` header is not the **public**
host:port (the address the browser uses — `WLW_PUBLIC_ORIGIN`, which defaults to the bound
`http://<WLW_HOST>:<WLW_PORT>`); SHALL reject requests bearing an `Origin` other than the public origin; and
state-changing endpoints SHALL require a per-session token issued with the page. LAN serving beyond loopback is a
supported, **off-by-default** capability via the `WLW_HOST` configuration, permitted **only under a
trusted-home-LAN assumption** ([ADR-0020](../../decisions/0020-lan-serving-and-write-surface.md),
[ADR-0022](../../decisions/0022-public-origin-behind-a-tls-front.md)): there is **no per-user authentication**,
so any device on that LAN that can reach the host and load the page may view the presented workspaces. The bridge
MAY sit behind a TLS front on the same machine (the front terminates TLS and proxies to a loopback bind); it SHALL
then treat a loopback peer as remote unless the public origin is itself a loopback address. Serving beyond a trusted
home LAN SHALL wait for a further ADR that resolves authentication and per-entity viewer authorization.

#### Scenario: Cross-site POST from a browser tab
- **WHEN** an arbitrary webpage fires a POST at the bridge's import endpoint
- **THEN** it is rejected (foreign/absent Origin + missing token) and no subprocess runs

#### Scenario: DNS-rebinding read attempt
- **WHEN** a request arrives with a Host header naming an external domain resolved to 127.0.0.1
- **THEN** it is rejected before any store is opened

#### Scenario: Served behind a TLS front
- **WHEN** the public origin is `https://aipc.local:8444` and the bridge binds `127.0.0.1:8765`
- **THEN** a request with Host `aipc.local:8444`, Origin `https://aipc.local:8444` and the session token is
  accepted; Host `aipc.local:8765` is refused with `host`; Origin `http://aipc.local:8444` is refused with
  `origin`; and opening a document streams its bytes to the browser rather than opening it on the server

### Requirement: Secrets do not cross the API, except one named case

No endpoint SHALL return store keys or the contents of a workspace's secret files; error messages SHALL
NOT embed them; logs SHALL NOT record them.

The single exception (ADR-0019) is a **re-obtainable** secret — a PAN or a statement password — released
on a dedicated endpoint: one value, one field or document, per explicit user action, never present in any
listing response, never logged. **The store key has no such exception** and never will: it cannot be
re-obtained, so revealing it risks the whole store where revealing a statement password risks an
inconvenience.

#### Scenario: A listing never carries a value
- **WHEN** any endpoint returns more than one item's metadata
- **THEN** it contains references only — asking for a value is always a separate, single request

#### Scenario: The key is asked for
- **WHEN** any request would return key material
- **THEN** it is refused; there is no endpoint that can

#### Scenario: A store fails to open
- **WHEN** a store cannot be decrypted
- **THEN** the API reports the failure class and workspace label only — never key material or the
  attempted SQL

### Requirement: A framework-free read layer, reusable by other consumers

The bridge SHALL separate a `core/` read layer (workspace resolution, lens access, family aggregation,
freshness, the per-workspace job queue) from its HTTP layer. `core/` SHALL NOT depend on the web
framework, so a second consumer (an MCP server per ADR-0008, a test harness) reuses it without inheriting
a server.

#### Scenario: The read layer is exercised without HTTP
- **WHEN** family aggregation is tested
- **THEN** it is callable directly, with no server running and no request object involved

### Requirement: Data is requested at a stated granularity

Read APIs SHALL take an explicit granularity — `aggregate` (class/total level), `positions`
(instrument level), or `transactions` (ledger level) — rather than returning the widest data and letting
callers narrow it. This is what makes scoped exposure (ADR-0008) enforceable at the source.

#### Scenario: An aggregate request cannot leak positions
- **WHEN** a caller requests family net worth at `aggregate` granularity
- **THEN** the response contains no instrument-level rows, regardless of the caller's identity

### Requirement: Long-running verbs stream their progress

Verb execution SHALL expose progress as a stream (server-sent events), and its final outcome SHALL remain
retrievable after the stream closes, so a user who navigates away or reconnects still learns what
happened.

#### Scenario: A rebuild outlives its viewer
- **WHEN** a rebuild is started and the browser tab is closed, then reopened
- **THEN** the job's status and, once finished, its full result are still available in Activity

### Requirement: One mutating verb per workspace, with read handles released

The job model SHALL serialize mutation per workspace: at most one verb runs against a workspace at a time,
a second request for a busy workspace is refused or queued (never run concurrently), and the bridge SHALL
close its own read handles on that workspace for the verb's duration. This is DuckDB's read/write attach
conflict made structural — WLC learned it the hard way, and a UI that polls a dashboard while a rebuild
runs is exactly the shape that provokes it.

> Promoted here from ADR-0005's prose deliberately: a decision nothing tests is a decision that erodes.

#### Scenario: A second verb is requested while one runs
- **WHEN** a rebuild is running for an entity and an import is requested for the same entity
- **THEN** the second does not start concurrently, and the caller is told why

#### Scenario: A dashboard is open while a verb runs
- **WHEN** a verb starts against a workspace the bridge is currently reading
- **THEN** the bridge releases its handles first, and views over that workspace report it as busy rather
  than failing to open

#### Scenario: Different workspaces are unaffected
- **WHEN** one entity's workspace is busy
- **THEN** verbs and reads against other entities' workspaces proceed normally

### Requirement: A restart forgets job state, and never pretends otherwise

Job status and progress are held in memory (ADR-0002/ADR-0005), so a bridge restart loses the history of
what ran. The system SHALL say so plainly rather than presenting an empty Activity as "nothing happened".

What a restart does **not** change is the store: `rebuild` is non-destructive — it builds a fresh store
alongside the live one and tallies the two — so an interrupted verb leaves the live store intact.

#### Scenario: Activity after a restart
- **WHEN** the app is reopened after the bridge was restarted
- **THEN** Activity states that earlier jobs are not recorded, rather than showing a blank log implying an
  idle history

### Requirement: Stopping the app stops its verbs, within a bound

When the bridge shuts down it SHALL stop accepting jobs, SHALL send SIGTERM to every verb subprocess it started,
and SHALL wait up to a configured grace (`WLW_STOP_GRACE`, default 15 seconds) before killing any that remain. No
verb the bridge started SHALL outlive it.

#### Scenario: The host halts during a rebuild
- **WHEN** the bridge receives SIGTERM while a rebuild it started is running
- **THEN** the rebuild is signalled and given the grace to stop, and the bridge exits only after it has

#### Scenario: A verb that will not stop
- **WHEN** a verb is still running when the grace expires
- **THEN** it is killed, and shutdown does not wait any longer

### Requirement: A log line carries shape, never household values

The bridge SHALL write one access line per request, with the method, the matched route's **template**, the status,
the duration in milliseconds and a trace id. A path that matches no API route SHALL be logged as a fixed bucket
(`static` or `unmatched`), never as the raw path. uvicorn's own access log SHALL be disabled by the app.

No line the bridge writes, in any format, SHALL contain a query string, a raw path, an entity id, a verb's
message, narration or stderr, an exception's text or traceback, or any amount, name or file name
([ADR-0023](../../decisions/0023-logs-carry-shape-not-values.md)).

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

### Requirement: The truth about a store is re-established by asking it, not by remembering

Where a verb's outcome was lost to a restart, the system SHALL offer `rebuild --check` — which asserts
`store = replay(corpus)` and exits non-zero on drift — rather than reconstructing a claim from remembered
state. Verification beats recollection: a log says what a process reported, a check says what the store is.

#### Scenario: An interrupted rebuild
- **WHEN** a rebuild was running when the bridge died and its outcome is unknown
- **THEN** the UI offers the check as the way to learn the store's actual condition, and does not assert an
  outcome it cannot know

### Requirement: A lock is physics — it is surfaced, never broken

If a store is held by another process, the system SHALL NOT offer to clear, force, steal or delete the
lock, and SHALL NOT retry past it. It SHALL surface the engine's own error, including the holder it names,
rather than replacing it with a generic "busy".

> A force-unlock affordance is the shortest path to a corrupted store. It does not exist here.

#### Scenario: A verb is requested against a locked store
- **WHEN** the store cannot be opened because another process holds it
- **THEN** the user is told which process holds it, as the engine reported, and is offered no way to
  override it

### Requirement: The holder is reported as observed, and classified only as far as is knowable

Naming the process answers *who*; the user needs *what to do*. WLC's `StoreLocked` carries the holding
process and pid **as the database reported them**, or states that none was named. The UI SHALL pass that
through, and SHALL distinguish only what it can actually establish:

- **a process this bridge started** — the pid matches a verb it launched, so it will finish and release.
  The workspace shows as busy and no second verb is offered against it.
- **anything else** — reported by name and pid, with the honest statement that the app did not start it and
  cannot tell what it is; it holds until whatever owns it lets go.

The system SHALL NOT infer the holder's *identity* from its executable path. A `wealthlens` verb and a
Jupyter kernel are both "python", so a guess dressed as an observation is worse than an admitted gap — and
WLC deliberately reports rather than guesses for the same reason.

#### Scenario: A verb this bridge started is still running after a restart
- **WHEN** the bridge restarts while a rebuild it launched still holds the store
- **THEN** the workspace shows as busy, no competing verb can be started against it, and it becomes
  available on its own once that process finishes

#### Scenario: Something the bridge did not start holds the store
- **WHEN** the holder's pid is not one this bridge launched
- **THEN** the UI names the process and pid as reported and says it cannot identify it further

#### Scenario: The database named no holder
- **WHEN** `StoreLocked` carries no holder
- **THEN** the UI says the store is held but by what is unknown — it names no likely candidate

### Requirement: Leftover rebuild output is named, not mistaken for a result

A rebuild interrupted mid-run can leave a partial store file beside the live one. Where such a file is
found, the system SHALL identify it as incomplete output rather than presenting it as a rebuild result,
and removing it SHALL be treated as destructive (shown, confirmed, one at a time).

#### Scenario: A partial rebuild file is found
- **WHEN** a rebuild output exists from a run that did not complete
- **THEN** it is labelled as incomplete, never offered for promotion, and its removal is confirmed

### Requirement: A verb's result is read from its contract, never from its prose or its exit code

The bridge SHALL run verbs with WLC's machine-readable flag and SHALL classify the result from the
`outcome` it reports — `ok`, `attention`, `refused`, `failed` — never by parsing human output and never by
treating a non-zero exit as failure.

> `import` exits non-zero when a file merely needs attention. A bridge reading the exit code alone is
> forced to be wrong in one direction: calling ordinary imports failures, or hiding real breakage. WLC now
> reports both, and the outcome is the authority.

#### Scenario: An import where a file needs attention
- **WHEN** an import completes with an unparsed file
- **THEN** the job is recorded as completed-with-attention and its per-file verdicts are rendered — not as
  a failed job

#### Scenario: A refusal is surfaced with its cause
- **WHEN** a verb refuses
- **THEN** the UI states that nothing was changed and identifies the gate by its name, rather than showing
  the raw message alone

#### Scenario: Narration never contaminates the result
- **WHEN** a verb prints warnings or progress while running
- **THEN** the bridge parses only the result channel, and the narration is available separately as the
  job's log

### Requirement: The API schema is generated, not hand-maintained

The bridge SHALL publish a machine-readable schema of its endpoints and response models, and the
frontend's types SHALL be derived from it — so a contract change that the UI has not adopted fails at
build time rather than in a household's dashboard.

#### Scenario: A response model gains a field the UI ignores
- **WHEN** the bridge's models change and types are regenerated
- **THEN** the mismatch surfaces in the frontend build, not at runtime

### Requirement: Responses carry the contract's honesty fields

Entity-scoped responses SHALL include the lens-provided `basis`/as-of/warning fields; family-scoped
responses SHALL include the per-entity decomposition (family-aggregation spec). The bridge SHALL state the
WLC version it is running against in a version endpoint.

#### Scenario: Version skew is diagnosable
- **WHEN** the SPA and bridge disagree on capabilities
- **THEN** the version endpoint reports bridge version + WLC version + pinned-supported range, enough to
  name the mismatch

#### Scenario: Store skew is diagnosable by name
- **WHEN** any declared workspace is at a different schema version than the engine
- **THEN** the version endpoint reports the engine version alongside **each store's** version, so the skew
  is named rather than inferred from a failed view (ADR-0017)

#### Scenario: Store versions are never remembered
- **WHEN** a store's version is reported
- **THEN** it was read from that store at request time — no version is cached in the manifest, because a
  remembered version goes stale (ADR-0002)
