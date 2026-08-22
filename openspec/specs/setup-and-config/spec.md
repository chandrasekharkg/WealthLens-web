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

### Requirement: The manifest is the only file WLW OWNS

`family.toml` is the only file whose content WLW authors on its own behalf; guided setup SHALL persist its
outcome exclusively there. The manifest SHALL contain no financial data, no passwords, and no store keys —
paths, labels, and presentation preferences only.

> Everything else WLW writes, it writes **into a WLC workspace by WLC's convention**, not as its own state:
> an uploaded file into the inbox, a value into that workspace's `config.toml` or secret file
> (identity-and-settings), a `manual/*.yaml` fact. Those are deposits, and the enumerated set lives in
> bridge-api. WLW keeps no state of its own beyond the manifest (ADR-0002).

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

### Requirement: Browser upload deposits into the inbox — and only the inbox

Statement upload SHALL write the file into the chosen entity's `statements/` inbox and nowhere else, with
an extension allowlist matching what WLC dispatch accepts, a size cap, and WLC's non-clobber naming (an
existing file is never overwritten). Upload performs no parsing and no store writes — custody begins and
ends with WLC's import gates (ADR-0005).

#### Scenario: A duplicate filename arrives
- **WHEN** an uploaded file's name already exists in the inbox
- **THEN** both files survive under distinct names, and nothing is overwritten

### Requirement: The locked-file loop closes in the browser

When an import reports a password-locked file, the UI SHALL let the user supply the password, place it in
that workspace's WLC config per WLC's conventions, and retry the import — so a non-technical user can
complete the whole daily loop without a terminal.

#### Scenario: A locked statement becomes imported
- **WHEN** a file reports 🔒 and the user supplies the correct password
- **THEN** the retried import succeeds, the password lives only in that workspace's WLC config, and no
  WLW log, response, or state retains it

### Requirement: Connecting an existing workspace is explicit and validated

Adding an entity SHALL require the user to pick the workspace, and the bridge SHALL validate it (opens
read-only, schema version compatible) before writing the manifest entry — reporting incompatibility as a
clear message naming the found vs required versions.

#### Scenario: An incompatible store is refused with a reason
- **WHEN** a chosen workspace's store schema is older than the bridge's pinned WLC supports
- **THEN** setup refuses the entry and tells the user which side to upgrade — it never half-adds
