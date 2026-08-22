# Bridge API

The single seam between the SPA and the stores: a local, read-only JSON API over `lens.py`, plus the
manifest and the one sanctioned import trigger. Security posture per ADR-0004.

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

### Requirement: Localhost hardening (phase 1)

The bridge SHALL bind loopback only; SHALL reject requests whose `Host` header is not the bound
address:port; SHALL reject requests bearing a foreign `Origin`; and state-changing endpoints SHALL require
a per-session token issued with the page. A configuration to bind beyond loopback SHALL NOT exist in
phase 1 (ADR-0004 phase 2 is the only path there).

#### Scenario: Cross-site POST from a browser tab
- **WHEN** an arbitrary webpage fires a POST at the bridge's import endpoint
- **THEN** it is rejected (foreign/absent Origin + missing token) and no subprocess runs

#### Scenario: DNS-rebinding read attempt
- **WHEN** a request arrives with a Host header naming an external domain resolved to 127.0.0.1
- **THEN** it is rejected before any store is opened

### Requirement: Secrets and keys never cross the API

No endpoint SHALL return store keys, statement passwords, or file contents from a workspace's secret
files; error messages SHALL NOT embed them; logs SHALL NOT record them.

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
