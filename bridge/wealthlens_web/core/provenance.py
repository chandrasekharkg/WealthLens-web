"""What a figure needs in order to survive leaving the app.

Everything that keeps a number honest lives *around* it on screen: the scope, the date it was computed at,
the currency, which entities were excluded, which are answering from older evidence. Export it or print it
and all of that stays behind — so the provenance header travels with the artifact instead (ADR-0013).

It is composed **here**, in `core/`, rather than in the frontend. A header is a set of claims about the
data, and claims belong on the side of the wire that can be asserted with a plain function call (ADR-0018).
The client renders the lines; it does not decide what they say.

The mixed-scope problem this solves: a family artifact has several stores behind it. Earlier drafts had the
header carry "the as-of date", which is a single value a family view does not have. Point-in-time
aggregation gives it one — every store answered *at the same chosen date* — and the things that a shared
date does **not** fix are stated separately: who was excluded, and who is answering from older evidence
(ADR-0016).
"""
from __future__ import annotations

import dataclasses

from wealthlens_web.core.aggregate import (
    EntityRows,
    EntityView,
    FamilyNetWorth,
    FamilyPerformance,
    FamilyRows,
)


@dataclasses.dataclass(frozen=True)
class Provenance:
    """The header that travels with an exported or printed artifact."""

    title: str
    scope: str
    as_of: str | None
    reporting_currency: str
    stores: tuple[str, ...] = ()
    filters: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()
    row_count: int | None = None

    def as_dict(self) -> dict:
        return {
            "title": self.title,
            "scope": self.scope,
            "as_of": self.as_of,
            "reporting_currency": self.reporting_currency,
            "stores": list(self.stores),
            "filters": list(self.filters),
            "warnings": list(self.warnings),
            "row_count": self.row_count,
        }


def _scope(entities) -> str:
    """Whose money this is, in words a reader who has never seen the app can use.

    The single-name form keys on how many entities the household DECLARES, not on how many happened to be
    readable. Keying on the readable count collapses "a family of four, three of whom could be opened" to
    one person's name — which reads as a complete personal statement and is the precise dishonesty this
    header exists to prevent.
    """
    declared = list(entities)
    if len(declared) == 1:
        return declared[0].label
    contributing = [e for e in declared if e.contributes]
    if len(contributing) == len(declared):
        return f"Family ({len(declared)} members)"
    return f"Family ({len(contributing)} of {len(declared)} members)"


def _warnings(entities, as_of: str | None) -> tuple[str, ...]:
    """The caveats a single date does not remove.

    Two distinct facts, deliberately not merged. An **excluded** entity is missing from the figure
    altogether. An entity whose newest evidence predates the chosen date is *in* the figure but answering
    from what it has — correct, and not the same as being complete to that date.
    """
    out = []
    for e in entities:
        if not e.contributes:
            reason = getattr(e, "excluded_reason", None) or "unavailable"
            out.append(f"Excludes {e.label}: {reason}")
    if as_of:
        for e in entities:
            evidence = getattr(e, "evidence_as_of", None)
            if e.contributes and evidence and evidence < as_of:
                out.append(f"{e.label}: evidence only to {evidence}")
    return tuple(out)


def for_net_worth(got: FamilyNetWorth) -> Provenance:
    return Provenance(
        title="Net worth",
        scope=_scope(got.entities),
        as_of=got.as_of,
        reporting_currency=got.reporting_currency,
        stores=tuple(w.label for e in got.entities for w in e.workspaces),
        warnings=_warnings(got.entities, got.as_of),
    )


def for_drilldown(*, title: str, scope: str, reporting_currency: str, as_of: str | None = None,
                  row_count: int | None = None, stores: tuple[str, ...] = ()) -> Provenance:
    """A single-store, single-subject drill-down (a card statement, a person's transfers, a holding's diary).
    The reporting currency is a bridge decision like everywhere else — the UI must not pick it off row[0]."""
    return Provenance(title=title, scope=scope, as_of=as_of, reporting_currency=reporting_currency,
                      stores=stores, row_count=row_count)


def for_performance(got: FamilyPerformance) -> Provenance:
    """The header for the portfolio charts. Same shape as a row set's — a scope keyed on the DECLARED members,
    the date the breakup was valued at, and the caveats a shared date does not fix (who was excluded, who is
    stale). The charts are a family view, so this keeps them from reading as a complete personal statement
    when a store was left out."""
    return Provenance(
        title="Portfolio",
        scope=_scope(got.entities),
        as_of=got.as_of,
        reporting_currency=got.reporting_currency,
        warnings=_warnings(got.entities, got.as_of),
    )


def for_rows(got: FamilyRows, *, filters: tuple[str, ...] = ()) -> Provenance:
    return Provenance(
        title=got.granularity.value.capitalize(),
        scope=_scope(got.entities),
        as_of=got.as_of,
        reporting_currency=got.reporting_currency,
        filters=filters,
        warnings=_warnings(got.entities, got.as_of),
        row_count=len(got.rows()),
    )


# Kept so the type checker sees both shapes are accepted by the helpers above.
_ACCEPTED = (EntityView, EntityRows)
