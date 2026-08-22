# Setup and config

The ease-of-use layer WLC's CLI deliberately doesn't provide: guided first-run, workspace connection, and
family-manifest management — without WLW ever becoming a second custodian of secrets.

## ADDED Requirements

### Requirement: Setup drives WLC's own mechanisms, never re-implements them

Workspace creation SHALL be performed by invoking WLC's own `wealthlens init` (subprocess), and statement
import by `wealthlens import --json`. WLW SHALL NOT create stores, write schema, or place secrets itself.

#### Scenario: Creating a new family member's workspace
- **WHEN** setup creates a workspace for a new entity
- **THEN** the workspace is produced by WLC's init flow, and WLW's only write is the manifest entry
  declaring it

### Requirement: The manifest is the only file WLW writes

Guided setup SHALL persist its outcome exclusively to `family.toml`. The manifest SHALL contain no
financial data, no passwords, and no store keys — paths, labels, and presentation preferences only.

#### Scenario: Manifest stays clean
- **WHEN** any setup flow completes
- **THEN** a review of `family.toml` shows entity declarations and preferences, and nothing that would
  matter if the file were public

### Requirement: Secrets are pointed at, never held

Where setup needs a statement password or key to exist (for WLC to use), it SHALL direct the user to WLC's
own config surfaces (the workspace's `config.toml` / secret files) and MAY write there **only** via WLC's
documented conventions, in that workspace. Secrets SHALL never transit to the frontend, appear in bridge
logs, or be echoed back by any API.

#### Scenario: A password is configured
- **WHEN** a user supplies a statement password during setup
- **THEN** it lands in that entity's WLC workspace per WLC's convention, is never returned by any endpoint,
  and never appears in a log line

### Requirement: Connecting an existing workspace is explicit and validated

Adding an entity SHALL require the user to pick the workspace, and the bridge SHALL validate it (opens
read-only, schema version compatible) before writing the manifest entry — reporting incompatibility as a
clear message naming the found vs required versions.

#### Scenario: An incompatible store is refused with a reason
- **WHEN** a chosen workspace's store schema is older than the bridge's pinned WLC supports
- **THEN** setup refuses the entry and tells the user which side to upgrade — it never half-adds
