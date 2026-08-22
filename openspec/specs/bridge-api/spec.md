# Bridge API

The single seam between the SPA and the stores: a local, read-only JSON API over `lens.py`, plus the
manifest and the one sanctioned import trigger. Security posture per ADR-0004.

## ADDED Requirements

### Requirement: Read-only by construction

The bridge SHALL open every WLC store read-only. No endpoint SHALL execute writes against a store; the
sole side-effecting endpoint is the import trigger, which runs `wealthlens import --json` as a subprocess
(list-args, stdin closed, timeout) against exactly one named, manifest-declared workspace.

#### Scenario: Import against "all" is refused
- **WHEN** the import endpoint is called without a single named entity
- **THEN** it refuses — there is no "import into all" (each import is one workspace's own gates)

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

### Requirement: Responses carry the contract's honesty fields

Entity-scoped responses SHALL include the lens-provided `basis`/as-of/warning fields; family-scoped
responses SHALL include the per-entity decomposition (family-aggregation spec). The bridge SHALL state the
WLC version it is running against in a version endpoint.

#### Scenario: Version skew is diagnosable
- **WHEN** the SPA and bridge disagree on capabilities
- **THEN** the version endpoint reports bridge version + WLC version + pinned-supported range, enough to
  name the mismatch
