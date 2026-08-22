# Family aggregation

One view over N family members' holdings, while every member keeps their own separate encrypted WLC store.
This capability is the reason WLW exists — and its constraint is the reason it can be trusted.

## ADDED Requirements

### Requirement: Aggregation is read-time composition, never storage

The system SHALL compose family views by querying each entity's store read-only at request time and
combining the results in memory. It SHALL NOT create, persist, or maintain any combined store, table,
export, or materialized view of more than one entity's data.

#### Scenario: The family view leaves no artifact
- **WHEN** a family net-worth view is rendered and the bridge process then exits
- **THEN** no file anywhere contains more than one entity's financial data

### Requirement: Every aggregated figure stays attributable

Each row and total in a family view SHALL carry the entity it came from, and a combined figure SHALL be
decomposable into per-entity parts in the UI. "Whose is this?" is always answerable.

#### Scenario: A combined holding is decomposable
- **WHEN** two entities hold the same instrument and the family view shows a combined position
- **THEN** the view can expand it into the per-entity positions, each labelled with its entity

### Requirement: The family manifest defines the family — nothing else does

Membership of the family view SHALL come only from `family.toml`: entities, their workspace paths, display
labels. The system SHALL NOT auto-include a discovered workspace without it being declared in the manifest.

#### Scenario: A workspace on disk is not automatically family
- **WHEN** a `*-WealthLens-data` workspace exists beside declared ones but is absent from the manifest
- **THEN** no view includes it, and setup MAY offer it as a candidate to add — offering is not including

### Requirement: An entity may span several workspaces

An entity MAY declare more than one workspace (a legacy workspace beside a current one). The system SHALL
aggregate an entity's workspaces exactly as it aggregates entities: read-time, in memory, every figure
attributable to the workspace it came from.

#### Scenario: A person with a legacy and a current workspace
- **WHEN** an entity declares two workspaces and both hold positions
- **THEN** the entity's view combines them with per-workspace attribution, and no combined artifact is
  written

### Requirement: Partial availability degrades honestly

If one entity's store is missing, locked by another process, or fails to open, family views SHALL render
the remaining entities and state plainly which entity is missing and why — never a silently smaller total.

#### Scenario: One store is unavailable
- **WHEN** an entity's store cannot be opened at request time
- **THEN** the family total is labelled as excluding that entity, with the reason, rather than presented
  as the family's whole position

### Requirement: Whose share is being valued is declared, never defaulted into silence

Each entity SHALL declare the owner identity its figures are valued for, and the system SHALL use it when
asking WLC for that entity's money.

> This is not a preference. WLC weights every money figure by a caller-supplied owner, and an instrument
> that IS owned but not by that owner contributes **zero** — with no error. A family view that defaulted
> would silently under-report every jointly-held or transferred asset in any store whose ownership rows
> name someone else. That is a wrong headline number with nothing to notice, which is the failure class
> this project exists to prevent.

#### Scenario: A store records joint ownership
- **WHEN** an entity's store contains ownership rows naming an entity id
- **THEN** the manifest's declared owner for that entity is used, and the resulting figures include that
  entity's beneficial share

#### Scenario: The declared owner matches nothing in the store
- **WHEN** a store has ownership rows and none names the declared owner
- **THEN** the system SHALL surface that as a warning on that entity — a total of zero from a populated
  store is reported as a misconfiguration, never as an answer

#### Scenario: A store with no ownership rows
- **WHEN** no instrument in a store carries ownership
- **THEN** every instrument is implicitly wholly owned and the declared owner does not change the figures

### Requirement: An aggregate is uniform by construction

Aggregation SHALL read every store with **one** engine — the bridge's installed WLC (ADR-0017) — and SHALL
include only stores at that engine's schema version. A store at any other version SHALL be excluded and
named, with the total labelled partial, in exactly the same shape as an unreachable store.

> The risk in mixed versions is not failure to read; it is coherence. Parts built under different engine
> semantics mean subtly different things, and a total assembled from them cannot be explained anywhere. The
> aggregated set is therefore uniform by construction rather than by hope.

#### Scenario: One workspace was built by an older engine
- **WHEN** a family view is requested and one store's schema version differs from the engine's
- **THEN** that entity is excluded and named with both versions, the total is labelled partial, and the
  remaining entities aggregate normally

#### Scenario: The excluded workspace is still legible
- **WHEN** a version-skewed workspace is opened
- **THEN** its identity, path, schema version and collateral are shown — only money figures are withheld,
  because only those would be incoherent

#### Scenario: Bringing it back
- **WHEN** a user asks how to include an excluded workspace
- **THEN** the UI names the path: rebuild it with this engine, then promote — the replay that WLC's
  `promote` gate already requires

### Requirement: Per-workspace freshness is surfaced

Because a declared workspace may be a synced copy from another machine (ADR-0006), family views SHALL
surface each workspace's freshness (latest store as-of; file age where meaningful), so a lagging copy is
visible as such. Staleness is labelled, never smoothed.

#### Scenario: A synced copy lags
- **WHEN** one entity's workspace is a file copy last updated days ago
- **THEN** that entity's figures carry their freshness alongside, and the family total notes the oldest
  constituent

### Requirement: Provenance signals survive aggregation

Per-entity `basis`, staleness (as-of dates), and footing signals from WLC SHALL flow through to family
views. A family total whose parts have mixed bases or divergent as-of dates SHALL say so.

#### Scenario: Mixed-freshness family total
- **WHEN** one entity's holdings are as of last month and another's are as of yesterday
- **THEN** the family view surfaces both as-of dates rather than implying a single point in time
