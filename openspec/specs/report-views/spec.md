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

### Requirement: Uncertainty is rendered, not hidden

`basis` labels, `units_incomplete`/footing warnings, and "needs attention" import outcomes SHALL be
visible in the views they affect — the UI's polish must never exceed the data's honesty.

#### Scenario: A footing break reaches the dashboard
- **WHEN** an entity's latest import reported a footing break
- **THEN** views over that entity carry the warning until the underlying condition clears

### Requirement: Import-from-the-UI shows WLC's verdict verbatim

The import trigger SHALL render WLC's structured per-file outcomes (imported / needs-attention, with
warnings) as returned — summarized counts MAY be added, but no file's warning may be dropped.

#### Scenario: An import with warnings
- **WHEN** a triggered import returns files needing attention
- **THEN** the UI lists each such file with its warning types, matching `import --json`
