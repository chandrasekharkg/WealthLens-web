"""The single place this app calls WealthLens-core's lens.

Every lens call goes through here — deliberately. `lens.py` is on WLC's stable surface but young, and a
signature change upstream should be a one-file fix rather than a hunt through the aggregation code. Nothing
above this module imports `wealthlens.lens`.

Each function takes an already-open connection. Opening belongs to `workspaces`, closing belongs to the
caller, because a caller that must RELEASE a store so a verb can run has to own the handle.
"""
from __future__ import annotations

from decimal import Decimal

from wealthlens_web.core.money import Money

TOTAL_ROW = "TOTAL"


def _dec(v) -> Decimal:
    """A store figure as a Decimal, without a float in the middle of it."""
    return Decimal(str(v if v is not None else 0))


def net_worth_by_class(con, *, on: str | None, owner: str, currency: str) -> list[dict]:
    """Net worth per asset class. The engine's own TOTAL row is dropped: a caller that both keeps it and
    sums the classes double-counts, and this way there is exactly one place the total is computed."""
    from wealthlens import lens
    df = lens.networth(on=on, owner=owner, con=con)
    return [{"asset_class": r["asset_class"],
             "value": Money(_dec(r["value_inr"]), currency),
             "basis": r.get("basis")}
            for _, r in df.iterrows() if str(r["asset_class"]).upper() != TOTAL_ROW]


def evidence_as_of(con) -> str | None:
    """The newest DOCUMENT evidence date — not a price pull, and not the date we happened to ask for."""
    from wealthlens import lens
    return lens.latest_evidence(con=con)


def owner_entities(con) -> list[str]:
    """Whom this store's ownership rows attribute instruments to. Empty means implicitly wholly owned."""
    from wealthlens import lens
    df = lens.owners(con=con)
    return [] if df.empty else [str(v) for v in df["owner_entity_id"].tolist()]
