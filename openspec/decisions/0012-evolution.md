# ADR-0012 — Evolution: teach the command before building the button, and absorb new capability for free

**Status:** ACCEPTED 2026-08-22

## Context

Two questions come up constantly in a project like this, and answering them ad hoc is how scope creeps and
designs rot:

1. WLC can already do something, but has no verb WLW can drive. Do we build it, hide it, or reach around
   the boundary?
2. WLC will one day model something it doesn't today (foreign bank accounts, new asset classes). How much
   of WLW has to change when it does?

## Decision, part 1 — an unbuilt capability is *taught*, not hidden

When a capability exists in WLC but WLW cannot drive it within the ADR-0005 boundary, the UI SHALL show
the user **the exact command to run**, with the context they need to run it — not a disabled control, and
certainly not a local reimplementation.

This is the third option, and the right one. Hiding it fails the user who needs it. Building it spends
effort before demand exists. Teaching it costs a copyable string, keeps the boundary intact, and turns the
gap into documentation that is correct by construction because it names WLC's own verb.

**Native support follows demand, not anticipation.** A taught command graduates to a built-in when enough
people actually need it — evidence, not imagination, is the trigger (the same rule ADR-0009 applies to
the container).

**Worked example — retracting a source (v1).** `capture_io.delete_source()` exists in WLC with no CLI
verb. Very few households will need it early. So v1 shows the steps to do it in WLC, and the
collateral-and-sources spec records the graduation path rather than blocking on it.

## Decision, part 2 — new WLC capability must land in WLW for free

WLW's conventions SHALL be strong enough that a new WLC capability appears in the UI **without WLW
redesign**. This is a falsifiable claim, not an aspiration, and it is how we know the conventions are
right.

**The standing test case: a bank account held abroad.** WLC's schema already carries `currency` and
`jurisdiction` on accounts, instruments and facts, plus an `fx_rates` table — the scaffolding is there and
foreign-asset handling is on its roadmap. When it lands, a GBP current account should flow into WLW
because:

- money already travels as amount + currency, and a foreign holding already carries both its native amount
  and the reporting-currency figure (data-conventions);
- sums already refuse to cross currencies;
- formatting is already locale-driven, so a GBP figure formats as GBP without a code change;
- aggregation is already per-entity and attributable, so a foreign account is just another account.

**If that account requires more than a locale string and a label to display correctly, data-conventions was
wrong** — and the fix belongs in the conventions, not in a special case for foreign accounts. Any
capability that can only be added by special-casing is a signal that a convention is missing.

## Consequences

- "Show the command" becomes a reusable UI pattern with one component, not a one-off for retraction.
- Every deferred capability carries its graduation trigger, so deferral is a decision with an exit rather
  than a quiet omission.
- New WLC capabilities get reviewed against the free-landing test: what in WLW must change? If the answer
  is "a special case", that review is a design failure and is fixed in the conventions.
