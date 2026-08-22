# Identity and settings

The config screen: everything `wealthlens init` asks at bootstrap, editable afterwards — plus the rest of
a workspace's WLC configuration — without a text editor and without WLW becoming a second custodian of
secrets.

## ADDED Requirements

### Requirement: Nothing is write-once at bootstrap

Every value WLC's bootstrap collects — the holder's name as it appears on statements, PAN, and any field
`wealthlens init` adds later — SHALL be viewable and editable afterwards in the UI. A user who typed
something wrong during first run, or who never ran first run themselves, SHALL be able to correct it
without opening a terminal or a text editor.

> This is the free-landing test (ADR-0012) applied to setup: if WLC's bootstrap gains a question, the
> settings screen SHALL gain the field. The field list therefore derives from WLC's own config contract —
> its config template and init flow — rather than being hardcoded here, so the two cannot drift silently.

#### Scenario: A mistyped PAN is corrected
- **WHEN** a user opens settings for a workspace whose PAN was entered wrongly
- **THEN** they can replace it, the change lands in that workspace by WLC's own convention, and the next
  import uses it

#### Scenario: Someone else ran the bootstrap
- **WHEN** a workspace was created on another machine or by a helper
- **THEN** every bootstrap-collected value is visible as set-or-unset and can be filled in here

### Requirement: Settings are per workspace, not global

Identity and parser configuration belong to **one WLC workspace**. The editor SHALL live in the workspace
detail pane, scoped to that entity, and SHALL NOT appear in global settings. A value SHALL never be
written to a workspace other than the one on screen.

> Global settings hold only WLW's own presentation preferences (the manifest's `[view]`). Household-wide
> identity does not exist: each entity has their own PAN and their own name.

#### Scenario: Two workspaces are open in different tabs
- **WHEN** identity is edited for one entity
- **THEN** only that entity's workspace is written, and the other's configuration is untouched

### Requirement: PAN is treated as a secret, not as a display field

PAN is both an identity and a password — it unlocks CAS and many statements. It SHALL therefore follow the
password ring's rules (collateral-and-sources): stored by WLC's own convention in its own file with
restrictive permissions, never inlined into `config.toml`, never returned by a listing endpoint, never
logged, and shown in the UI as **set or unset** with a masked indicator rather than as readable text.
Revealing it SHALL require an explicit per-request action and SHALL deliver it to the clipboard without
rendering it on screen.

#### Scenario: The settings screen is opened
- **WHEN** a workspace with a configured PAN is displayed
- **THEN** the field shows that a PAN is set, masked — the value is not present in the page or in the
  response that built it

#### Scenario: A PAN is supplied
- **WHEN** a user enters a PAN
- **THEN** it is written where WLC expects it, with WLC's file permissions, and `config.toml` continues to
  reference it rather than containing it

### Requirement: Editing configuration preserves what the user did not edit

WLC's `config.toml` ships as a commented, self-documenting file and uses a value-reference syntax
(a pointer to a secret file, or to another key). An edit SHALL preserve comments, key order, formatting,
and every reference expression not being changed — a naive parse-and-rewrite that discards the guidance
around the keys is a defect, not a cosmetic issue.

#### Scenario: One value is changed
- **WHEN** a single setting is saved
- **THEN** a diff of `config.toml` shows only that key's line changed, with all comments and unrelated keys
  byte-identical

#### Scenario: A referenced value is edited
- **WHEN** a key whose value points at a secret file is updated
- **THEN** the pointer is preserved and the target file is updated — the secret is not inlined into
  `config.toml`

### Requirement: Invalid configuration is refused before it is written

Values SHALL be validated in shape before the write (PAN's format, a name that is not empty, a well-formed
reference), and a rejected value SHALL leave the file untouched. Where WLC can verify a value in use, the
UI SHALL offer that verification rather than asserting success — a saved PAN is not proof the PAN is right.

#### Scenario: A malformed PAN is rejected
- **WHEN** a value not matching PAN's format is submitted
- **THEN** it is refused with a clear message and `config.toml` is unchanged

#### Scenario: Proving a password actually works
- **WHEN** a statement password or PAN is saved and a locked file exists
- **THEN** the UI offers to retry that import, so success is demonstrated rather than assumed

### Requirement: The settings screen states where the values live

The editor SHALL name the workspace path it is writing to, and SHALL make the underlying files reachable
(the custodian-is-visible principle) — so a user who prefers a text editor is never locked out and can see
exactly what the UI changed.

#### Scenario: A user wants to see the file
- **WHEN** the settings screen is open
- **THEN** the path of the configuration being edited is displayed and the file can be revealed
