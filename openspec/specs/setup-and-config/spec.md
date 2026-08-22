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

When an import reports a password-locked file, the UI SHALL let the user supply the password and retry the
import — so a non-technical user can complete the whole daily loop without a terminal.

#### Scenario: A locked statement becomes imported
- **WHEN** a file reports 🔒 and the user supplies the correct password
- **THEN** the retried import succeeds, the password is never returned by any endpoint, and no WLW log or
  state retains it

### Requirement: A password is proven before the user is asked to keep it

The system SHALL attempt the password and confirm the file actually opens **before** offering to store it.
A password that has not been shown to work SHALL NOT be written to a workspace's configuration.

#### Scenario: The password is wrong
- **WHEN** a supplied password does not open the file
- **THEN** the user is told it did not work and nothing is written anywhere

### Requirement: Keeping a password is the user's explicit choice, with its consequence stated

Once a password is proven, the UI SHALL offer exactly two outcomes and SHALL NOT choose for the user:

1. **Add it to the password ring** — stored as a *named* entry by WLC's convention (its own file, with the
   config referencing it), so it is among the passwords tried against future documents. The user names it,
   with a suggestion derived from the institution; a name already in the ring SHALL NOT be silently
   overwritten.
2. **Use it once** — the password opens this file for this import and is then discarded. It is written
   nowhere.

> **The consequence that must be stated for "use it once".** WLC's guarantee is `store = replay(corpus)`:
> a rebuild re-reads the source documents. A password that was never stored means that document cannot be
> re-opened on a future rebuild without the user supplying it again — so a one-off password silently makes
> the store non-reproducible from its corpus. The choice is legitimate and stays; presenting it without
> that consequence is not.

#### Scenario: The password joins the ring
- **WHEN** the user chooses to keep it and names it
- **THEN** it lands as a named entry in that workspace by WLC's convention, appears in the collateral view's
  ring as a reference, and is tried against future documents

#### Scenario: The password is used once
- **WHEN** the user chooses one-time use
- **THEN** the import completes, nothing is persisted, and the user is told plainly that a future rebuild
  will ask for this document's password again

#### Scenario: A name collides
- **WHEN** the suggested or entered name already exists in the ring
- **THEN** the user is shown the conflict and chooses — WLC's convention allows several values under one
  name, so combining is a decision, never a silent replacement

### Requirement: The app teaches how to collect statements

Because WLW never connects to an institution, obtaining documents is the user's own step — and in practice
it is where onboarding stalls, not at the drop zone (UX-VALIDATION P6). The system SHALL ship a help page
covering how to obtain statements in a form the engine can actually read: which document to ask each kind
of institution for, why a *statement* beats a screenshot or a summary page, what to do about
password-protected and scanned files, and how to keep a full period rather than a fragment.

The help SHALL cover the companion tool `document-collector` — which retrieves statement attachments from
the user's own webmail — as an **optional, separately-installed** aid, described and linked, never driven
from WLW. Reaching into a mailbox is the user's decision and stays outside this application.

#### Scenario: An empty inbox
- **WHEN** an entity's inbox has no files
- **THEN** the empty state explains where statements come from and links to the help page, rather than
  showing an unexplained drop target

#### Scenario: A user asks how to get a year of statements
- **WHEN** they open the help page
- **THEN** it describes the per-institution routes and the document-collector option, with the boundary
  stated: WealthLens never signs in to anything on their behalf

### Requirement: Connecting an existing workspace is explicit and validated

Adding an entity SHALL require the user to pick the workspace, and the bridge SHALL validate it (opens
read-only, schema version compatible) before writing the manifest entry — reporting incompatibility as a
clear message naming the found vs required versions.

#### Scenario: An incompatible store is refused with a reason
- **WHEN** a chosen workspace's store schema is older than the bridge's pinned WLC supports
- **THEN** setup refuses the entry and tells the user which side to upgrade — it never half-adds
