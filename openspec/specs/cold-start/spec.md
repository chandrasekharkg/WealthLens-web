# Cold start

From "nothing installed" to "a workspace I can trust" — the stretch every use case previously assumed had
already happened. Install and launch per ADR-0014; key custody per ADR-0015.

## ADDED Requirements

### Requirement: Installation prepares the machine and nothing else

The installer SHALL ensure a suitable Python runtime, install WealthLens-core and the bridge, create a
launcher, and open the browser at the local address. It SHALL NOT create workspaces, write configuration,
generate or place keys, or touch a store — data setup happens after launch, through WLC's own verbs
(ADR-0005).

#### Scenario: Installation completes
- **WHEN** the installer finishes
- **THEN** WLC and the bridge are installed, a launcher exists, the browser is open at the app — and no
  workspace, key or configuration file has been created

#### Scenario: Installation fails partway
- **WHEN** any step fails
- **THEN** the installer reports what it did, where, and what failed, in a form the user can send to
  someone — a silent failure on a household's machine is unfixable at a distance

### Requirement: Every launch preflights the engine

The app SHALL check, at each launch and not only at install, that WLC is present and within the bridge's
supported version range. A failing preflight SHALL produce a screen that names the problem and the fix —
never a blank page, a stack trace, or a dashboard that silently shows nothing.

> A user can upgrade WLC independently, move a folder, or run on a machine someone else set up. The
> installer's world is not guaranteed to have persisted.

#### Scenario: WLC is missing
- **WHEN** the bridge cannot find WealthLens-core
- **THEN** the app explains that the engine is missing and how to install it, rather than failing to load

#### Scenario: WLC is out of range
- **WHEN** the installed WLC is older or newer than the supported range
- **THEN** the screen names the found version, the supported range, and which side to change

### Requirement: Upgrades move engine-first, and a schema bump is a fleet event

The engine is the custodian and upgrades first; the presenter follows. Where an upgrade changes WLC's schema
version, every workspace SHALL be rebuilt and promoted before it re-enters aggregate views (ADR-0017), and
the UI SHALL say so plainly rather than letting family views quietly narrow.

#### Scenario: WLC is upgraded across a schema change
- **WHEN** the engine's schema version changes
- **THEN** the app states that each workspace needs a rebuild and promote, lists which still need it, and
  keeps aggregating the ones that are current

#### Scenario: Another machine runs a different WLW
- **WHEN** household members run different WLW versions
- **THEN** nothing is required of them — only the reading engine and the stores it reads must agree

### Requirement: The store key never crosses the bridge

No endpoint SHALL return the contents of a workspace's key file, and no page SHALL hold it. Where the user
must secure the key, the bridge SHALL reveal the file's location in the operating system's file manager,
scoped to workspace paths — it is not a general open-anything capability.

#### Scenario: Securing a new workspace's key
- **WHEN** a workspace is created and the user is asked to back up its key
- **THEN** the key file is revealed on their machine, and neither the response that built the screen nor
  the page itself contains the key

#### Scenario: An attempt to read the key
- **WHEN** any API is called in a way that would return key material
- **THEN** it is refused — there is no endpoint that can

### Requirement: The key ceremony states the stakes and is confirmed deliberately

Setup SHALL state, in plain words, that the key is the only way to open the store and that there is no
reset — and SHALL require an explicit confirmation that the user has stored it before continuing. The
confirmation SHALL be recorded against that workspace with its date.

#### Scenario: A user continues without confirming
- **WHEN** the confirmation has not been given
- **THEN** setup does not present the workspace as ready, and the outstanding backup remains visible

### Requirement: A key can be checked without being revealed

The system MAY display a short fingerprint of a workspace's key — a hash prefix, never the key — so a user
can verify that what they stored is the right secret for that workspace.

#### Scenario: Confirming the saved secret is the right one
- **WHEN** a user compares the secret in their password manager against the workspace
- **THEN** the fingerprint lets them confirm it matches, and the key itself is never displayed or returned

### Requirement: Key backup state is tracked per workspace, and visible across the family

Because every workspace has its own key, the family view SHALL show which workspaces have a confirmed
backup and when. Backup state (workspace, confirmed, date, fingerprint) SHALL live in the manifest — it
contains no secret and keeps WLW databaseless (ADR-0002).

#### Scenario: A household with several members
- **WHEN** four workspaces exist and two have confirmed backups
- **THEN** the other two are visible as unconfirmed, rather than silently assumed safe

#### Scenario: An existing workspace is connected rather than created
- **WHEN** a user connects a workspace they created earlier via the CLI
- **THEN** it starts unconfirmed — the system does not know whether it was ever backed up, and says so

### Requirement: First run has a designed empty state

With no manifest and no workspace, the app SHALL present a guided choice between creating a workspace and
connecting an existing one, SHALL surface discovered candidate workspaces as suggestions only, and SHALL
NOT present an empty dashboard.

#### Scenario: A workspace exists on disk but is undeclared
- **WHEN** setup discovers a workspace folder not in the manifest
- **THEN** it is offered as a candidate — offering is not including (family-aggregation)
