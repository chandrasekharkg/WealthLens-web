"""The single place this app calls WealthLens-core's lens.

Every lens call goes through here — deliberately. `lens.py` is on WLC's stable surface but young, and a
signature change upstream should be a one-file fix rather than a hunt through the aggregation code. Nothing
above this module imports `wealthlens.lens`.

Each function takes an already-open connection. Opening belongs to `workspaces`, closing belongs to the
caller, because a caller that must RELEASE a store so a verb can run has to own the handle.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from wealthlens_web.core.money import Money

TOTAL_ROW = "TOTAL"


# WLC stores money as DECIMAL(18,2), so two places IS the store's own scale. Pinning it here — at the one
# boundary where the scale is known — keeps every figure consistent instead of leaking whatever the pandas
# round-trip happened to produce ("3500.0" from one query, "3500.00" from another). Money itself stays
# scale-agnostic, because not every currency has two decimals and that decision is not ours to bake in.
_MONEY_SCALE = Decimal("0.01")


def _dec(v) -> Decimal:
    """A store figure as a Decimal at the store's scale, without a float surviving in the middle of it."""
    return Decimal(str(v if v is not None else 0)).quantize(_MONEY_SCALE, rounding=ROUND_HALF_UP)


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


# ── identifiers ──────────────────────────────────────────────────────────────────────────────────────
# data-conventions: an instrument with no market identifier must SAY so. lens emits NULL for cash, for a
# deposit, for a property — and a NULL that a caller has to interpret is exactly the blank the rule forbids,
# because a filter on ISIN would then both hide it and match it by accident. So the kind is explicit.

NO_IDENTIFIER = {"kind": "none"}


def _identifier(isin) -> dict:
    text = "" if isin is None else str(isin).strip()
    if not text or text.lower() in {"nan", "none"}:
        return NO_IDENTIFIER
    return {"kind": "isin", "value": text}


def positions(con, *, on: str | None, owner: str, currency: str) -> list[dict]:
    """Instrument-level holdings. One row per position, each carrying how it was valued and how current
    the evidence behind it is."""
    from wealthlens import lens
    df = lens.holdings(on=on, owner=owner, con=con)
    out = []
    for _, r in df.iterrows():
        row_ccy = str(r["currency"]) if "currency" in df.columns and r["currency"] else currency
        out.append({
            "name": r["name"],
            "asset_class": r["asset_class"],
            "account_id": r["account_id"],
            "quantity": (None if r["quantity"] is None or _isnan(r["quantity"]) else float(r["quantity"])),
            "value": Money(_dec(r["value_inr"]), row_ccy),
            "identifier": _identifier(r.get("isin")),
            "as_of": str(r["as_of"])[:10],
            "basis": r["basis"],
        })
    return out


def transactions(con, *, since: str | None, until: str | None, currency: str) -> list[dict]:
    """Ledger-level rows. The finest granularity, and the one scoped exposure exists to gate."""
    from wealthlens import lens
    df = lens.transactions(since=since, until=until, con=con)
    return [{
        "date": str(r["value_date"])[:10],
        "bank": r["bank"],
        "account_id": r["account_id"],
        "narration": r["narration"],
        # Signed: negative left the household. The sign is the fact, so it is not split into a type column.
        "amount": Money(_dec(r["signed_amount"]), currency),
        "balance": Money(_dec(r["current_balance"]), currency),
    } for _, r in df.iterrows()]


def _isnan(v) -> bool:
    try:
        return v != v
    except Exception:       # a non-numeric is simply not NaN
        return False
