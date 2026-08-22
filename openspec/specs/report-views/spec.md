# Report views

What the UI shows: per-entity and family reports rendered from `lens.py` answers. Views present; they never
compute financial semantics of their own.

## ADDED Requirements

### Requirement: Views are projections of lens answers

Every figure shown SHALL originate from WLC's public read surface via the bridge. The frontend SHALL NOT
derive financial values beyond display arithmetic (sums of rows already provided, percentage-of-total for
layout). Any semantic need (a new grouping, a new basis) is a `lens.py` feature request upstream.

#### Scenario: A new analytic is needed
- **WHEN** a view needs a figure the bridge cannot supply from lens
- **THEN** the change lands in WLC's lens first and the view consumes it — the frontend never computes it
  from raw rows

### Requirement: The core view set

The system SHALL provide, per entity and family-wide: net worth by asset class (with basis), holdings
(with as-of and quantity/value), and point-in-time views for a chosen date. Spending and cashflow views
SHALL be provided per entity where lens exposes them.

#### Scenario: Point-in-time family view
- **WHEN** a user selects a past date
- **THEN** every figure shown is the lens answer for that date, per entity, with each entity's as-of
  honesty preserved (see family-aggregation)

### Requirement: Aggregate views are computed point-in-time at one chosen date

The date in the context bar SHALL be the basis of computation, not a label: an aggregate view asks each
**reachable** store for its position as of that date and combines those answers (ADR-0016). A view or
artifact therefore carries **one** as-of date.

This SHALL NOT be used to conceal two facts that remain true:

- a store that could not be opened is named as excluded, and the total is labelled partial
  (family-aggregation);
- a store whose newest evidence predates the chosen date is answering from what it has, which is not the
  same as being complete to that date.

#### Scenario: A family view at a chosen date
- **WHEN** a user picks a date and views family net worth
- **THEN** every constituent figure is that store's position at that date, and the view states the single
  date it was computed at

#### Scenario: A lagging store inside a point-in-time view
- **WHEN** one entity's newest evidence is older than the chosen date
- **THEN** the view states that its answer covers evidence only up to that entity's own latest — the shared
  date does not make a lagging store current

### Requirement: Uncertainty is rendered, not hidden

`basis` labels, `units_incomplete`/footing warnings, and "needs attention" import outcomes SHALL be
visible in the views they affect — the UI's polish must never exceed the data's honesty.

#### Scenario: A footing break reaches the dashboard
- **WHEN** an entity's latest import reported a footing break
- **THEN** views over that entity carry the warning until the underlying condition clears

### Requirement: An empty view says which kind of empty it is

There are three, they are not interchangeable, and each SHALL be distinguishable with its own recovery:

1. **Nothing here yet** — the store holds no data for this view. The recovery is to import.
2. **Nothing matches** — data exists; the active filter, search or date excludes it. The recovery is to
   clear the filter, and the view SHALL say how many rows exist unfiltered.
3. **Cannot be shown** — the store is unreachable, busy, or lens could not answer. The recovery is to fix
   that cause, which the view SHALL name.

Rendering any of these as another is a defect. The third is the dangerous one: an unreachable store drawn
as an empty table is indistinguishable from genuinely owning nothing, and a household reading "no holdings"
when their store was merely locked has been told something false about their money.

#### Scenario: A filter excludes everything
- **WHEN** a user filters a populated holdings view down to nothing
- **THEN** the view says the filter matched no rows and how many exist without it — never "you have no
  holdings"

#### Scenario: A store is locked while its view is open
- **WHEN** a verb holds the store and a view over it is requested
- **THEN** the view states that it is busy and why, and shows no zero-value figures

#### Scenario: A genuinely new workspace
- **WHEN** a workspace has been created but nothing imported
- **THEN** the view says so and offers the import flow

### Requirement: Import-from-the-UI shows WLC's verdict verbatim

The import trigger SHALL render WLC's structured per-file outcomes (imported / needs-attention, with
warnings) as returned — summarized counts MAY be added, but no file's warning may be dropped.

#### Scenario: An import with warnings
- **WHEN** a triggered import returns files needing attention
- **THEN** the UI lists each such file with its warning types, matching `import --json`
