# ADR-0016 — Currency: three defaults, one reporting figure, at one point in time

**Status:** ACCEPTED 2026-08-22

## Context

The UX validation gate found two related holes. A family artifact carried several as-of dates and no way to
state them honestly (P8), and a foreign-currency row appears in v1 views the moment one member banks abroad
(P9). Both are the same question: *what does a single total mean when its parts don't share a unit or an
instant?*

The worked example: three bank accounts, two in INR and one in USD. Navigating each one individually should
show it in its own currency — that is what the account *is*. But a net-worth figure across them exists only
if one currency has been chosen to express it in.

### What WLC can do today, checked rather than assumed

- `currency` exists on accounts, instruments, valuations and facts — but as a **column default of `'INR'`**,
  not as a configured property of the store.
- `fx_rates` is keyed `(currency, rate_date)` and its value column is **`inr_rate`**. Conversion columns
  elsewhere are named `fx_to_inr`, and `value_inr` appears across twenty modules.
- `fetch-fx` captures rates for replay, so rates carry provenance like every other fact.
- Point-in-time is real and correct for the hard case: lens accrues a fixed deposit's value *to* each date
  rather than teleporting today's value backwards.

So INR is not merely WLC's default — it is baked into the schema's vocabulary. That constrains what v1 can
honestly offer, and the constraint is stated here rather than discovered later.

## Decision

### 1. Currency is resolved at three levels

- **Account** — what the account is denominated in. This is what a user sees when looking *at* that account,
  and it is never converted away for its own view.
- **Store** — the entity's default, for figures spanning that person's accounts. Configured, not inferred.
- **Aggregator** — the reporting currency for a view spanning several stores. Declared in WLW's manifest.

Display resolves inward (an account shows its own currency); aggregation resolves outward (a total is
expressed in the reporting currency of the scope being totalled).

### 2. Mixed currencies may be *shown*; they may not be *summed*

A family holdings table showing rupee and dollar rows side by side is correct and stays. What may never
happen is those rows adding into one number without conversion. A total appears only in the reporting
currency, names that currency, and is computed from converted figures — or does not appear at all.

### 3. Every aggregate view is point-in-time at one chosen date

The date in the context bar is not decoration; it is the **basis of computation**. Aggregate views ask each
reachable store for its position *as of that date* and combine those answers. This is what resolves P8: an
artifact carries **one** as-of date, because one date was chosen and everything was computed at it.

Two things this does **not** erase, and the UI must keep saying:

- **Reachability.** A store that could not be opened is named as excluded (family-aggregation), and the
  total is labelled as partial.
- **Evidence coverage.** A store whose newest evidence predates the chosen date answers correctly *from
  what it has* — which is not the same as being complete to that date. Point-in-time makes the date
  unambiguous; it does not make a lagging store current, and presenting it as though it did would be the
  precise dishonesty this project exists to avoid.

### 4. Conversion uses a rate *at that date*, or the figure is refused

Converting at a point in time requires an FX rate for that date. Where one is missing, the view SHALL say
so and offer `fetch-fx` — it SHALL NOT fall back to today's rate, to the nearest rate, or to an unstated
approximation. A converted total is only as honest as the rate behind it, and rates in WLC carry provenance
precisely so this can be checked.

## What v1 can honestly ship

The three-level model is the design. The reporting currency being **freely selectable** is not v1, because
`fx_rates.inr_rate` and `value_inr` make INR the pivot in WLC's own vocabulary. So:

- v1 reads the reporting currency from the manifest and **supports what WLC can compute** — an INR pivot.
- A non-INR reporting currency is refused with a clear reason rather than silently approximated.
- Per-account and per-store currency **display** works now, because the data carries currency already.

Generalizing the pivot is a WLC change (tracked cross-repo), and it is a real one — twenty modules and a
schema column name. Naming it now is cheaper than discovering it during Phase 4.

## Consequences

- The manifest gains a reporting currency, and each entity may carry a store default; both are presentation
  facts, not secrets, so the manifest remains harmless if public (ADR-0002).
- Two cross-repo tasks for WLC: a **configured store default currency** (rather than a column default), and
  a **reporting-currency-relative FX pivot** to replace the INR-specific one.
- The provenance header (ADR-0013) carries one as-of date, the reporting currency, and the reachability and
  coverage caveats — which is what makes a single date defensible rather than convenient.
