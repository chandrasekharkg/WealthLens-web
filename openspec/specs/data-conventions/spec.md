# Data conventions

House rules for every figure that crosses the bridge API or reaches a component. They exist so that
ambiguity is impossible by construction rather than caught by review.

## ADDED Requirements

### Requirement: Money is never a bare number

Every monetary figure SHALL travel as an amount paired with its currency, and components SHALL NOT render
a money value that arrived without one. A bare number in a money position is a defect, not a shortcut.

#### Scenario: A total crosses the API
- **WHEN** any endpoint returns a monetary figure
- **THEN** it carries its currency alongside, and a client that ignores currency cannot silently render a
  foreign amount as a domestic one

#### Scenario: A foreign-denominated holding
- **WHEN** a holding is priced in a currency other than the store's reporting currency
- **THEN** the response carries both the reporting-currency figure and the native amount with its own
  currency, rather than presenting a converted number as if it were native

### Requirement: Sums are only ever taken within one currency

The system SHALL NOT add amounts of differing currencies. Aggregation happens on the reporting-currency
figure; a mixed-currency set with no reporting figure is reported as unsummable, never silently added.

#### Scenario: Mixed currencies in one view
- **WHEN** a view aggregates holdings across currencies
- **THEN** it sums the reporting-currency values and states the reporting currency, or declines to total

### Requirement: Currency resolves at three levels

Currency SHALL resolve as account → store → aggregator (ADR-0016). An **account** is displayed in its own
currency and never converted away for its own view. A **store** has a default currency for figures spanning
one entity's accounts. An **aggregator** (a family or multi-store view) has a reporting currency declared in
the manifest. Display resolves inward; aggregation resolves outward.

#### Scenario: Looking at one foreign account
- **WHEN** a user opens a USD account held alongside INR accounts
- **THEN** its balances and transactions are shown in USD — its own currency is the point of that view

#### Scenario: Looking at net worth across those accounts
- **WHEN** the same user views net worth
- **THEN** one figure appears, in the declared reporting currency, named as such

### Requirement: Mixed currencies may be shown; they may not be silently summed

A table MAY display rows of differing currencies side by side, each with its own. Any total over such a
table SHALL be the reporting-currency figure and SHALL name that currency — or SHALL be omitted.

#### Scenario: A family holdings table spans currencies
- **WHEN** rows in several currencies are listed
- **THEN** each row shows its own currency, and the footer total is stated in the reporting currency

### Requirement: A conversion discloses the age of the rate it used

Where conversion is required, the rate SHALL be the newest one **on or before** the view's date, and the
view SHALL be able to show **which date that rate came from**. A conversion SHALL NOT use a rate from after
the view's date, and SHALL NOT fall back to a default rate when none exists.

> **This requirement previously demanded refusal of any non-exact rate. That was wrong**, and checking the
> engine is what showed it: valuing at a point in time correctly means the last rate on or before that date,
> because markets close and weekends exist. Demanding an exact-date rate would refuse a correct figure most
> days of the year. The real defect is doing it *silently* — a rate from three years ago and a rate from
> yesterday produce equally confident-looking numbers. WLC reports `fx_as_of` alongside `price_as_of` for
> exactly this, so the UI shows the age rather than inferring it.

#### Scenario: A converted figure whose rate is stale
- **WHEN** the newest applicable rate is materially older than the view's date
- **THEN** the view shows the rate's date beside the figure, so a reader can judge it

#### Scenario: No rate exists at all
- **WHEN** nothing can convert a holding to the reporting currency
- **THEN** it is not converted at a default rate; it appears with the value its own source stated, labelled
  with the basis WLC gave it, and it is never silently omitted from a total

### Requirement: A reporting currency WLC cannot compute is refused, not approximated

Where the installed WLC cannot express figures in the declared reporting currency, the system SHALL refuse
with a clear reason naming what it can do.

> WLC's FX table stores an INR-relative rate (`fx_rates.inr_rate`) and its value columns are INR-named, so
> v1 supports an INR pivot. Generalizing it is a tracked WLC change (ADR-0016), not something WLW may
> approximate around.

#### Scenario: A household declares a non-INR reporting currency
- **WHEN** the manifest declares a reporting currency the engine cannot pivot to
- **THEN** setup reports it plainly, names what is supported, and does not silently report INR figures
  under another currency's label

### Requirement: Market instruments carry an identifier; the rest say they have none

A market-traded instrument (equity, fund, ETF, bond) SHALL carry its ISIN, and views SHALL be able to
display and filter by it. Instruments that legitimately have no market identifier — a fixed deposit, a
property, cash, unlisted equity recorded by hand — SHALL be explicitly marked as identifier-less rather
than carrying an empty field indistinguishable from a missing one.

> Refines the founding rule "everything imported from a money market includes an ISIN": true for
> market instruments, and deliberately not forced onto the many real holdings WLC tracks that have no
> ISIN to carry. The invariant that matters is that "no identifier" is *stated*, never inferred from a
> blank.

#### Scenario: A holding with no market identifier
- **WHEN** a fixed deposit or a property appears in a holdings view
- **THEN** its identifier field reads as "not applicable" rather than blank, and filters on ISIN neither
  hide it accidentally nor match it accidentally

### Requirement: A foreign-held account displays without a special case

These conventions SHALL be sufficient that an account held abroad — a different currency and jurisdiction —
renders correctly with no code path specific to it. This is the standing test of whether the conventions
are strong enough (ADR-0012).

#### Scenario: A foreign current account appears
- **WHEN** WLC models an account whose currency and jurisdiction differ from the reporting ones
- **THEN** its balances show in their own currency, aggregate only via the reporting-currency figure, and
  format per locale — with no branch anywhere that names that currency or country

#### Scenario: A special case would be needed
- **WHEN** displaying such an account would require code specific to it
- **THEN** that is a defect in these conventions, and the fix belongs here — not in a per-currency branch

### Requirement: Every user-visible string is translatable

The UI SHALL render text through a message catalog, with no user-visible string literals in components.
Numbers, dates and currencies SHALL be formatted through locale-aware formatting, and the shipped locale
is English with Indian digit grouping available (a value shown as `1,00,000` where the locale calls for
it, not `100,000`).

#### Scenario: A new locale is added without touching components
- **WHEN** a translator supplies a new catalog
- **THEN** the UI renders in that language with no component changes

#### Scenario: Grouping follows the locale, not the developer
- **WHEN** a figure is displayed
- **THEN** its grouping and decimal conventions come from the active locale's formatter

### Requirement: Extension-supplied text is data, never markup

Strings originating from an extension (page titles, labels, values) SHALL be escaped and rendered as text.
The system SHALL NOT render extension-supplied content as HTML or execute anything it contains.

#### Scenario: An extension supplies markup in a label
- **WHEN** an extension's manifest or response contains markup or script
- **THEN** it appears as literal text and nothing is executed
