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


def _date(v) -> str | None:
    """A store date as an ISO string, or None for NULL/NaT — dates the store could not fill are absences,
    not the epoch."""
    if v is None or _isnan(v):
        return None
    return str(v)[:10]


def positions(con, *, on: str | None, owner: str, currency: str) -> list[dict]:
    """Instrument-level holdings. One row per position, each carrying how it was valued and how current
    the evidence behind it is."""
    from wealthlens import lens
    df = lens.holdings(on=on, owner=owner, con=con)
    out = []
    for _, r in df.iterrows():
        row_ccy = str(r["currency"]) if "currency" in df.columns and r["currency"] else currency
        def _int(v):
            return None if v is None or _isnan(v) else int(v)
        def _str(v):
            return None if v is None or (isinstance(v, float) and _isnan(v)) else str(v)
        out.append({
            "name": r["name"],
            "asset_class": r["asset_class"],
            "account_id": r["account_id"],
            "instrument_id": _str(r.get("instrument_id")),
            "quantity": (None if r["quantity"] is None or _isnan(r["quantity"]) else float(r["quantity"])),
            "value": Money(_dec(r["value_inr"]), row_ccy),
            "identifier": _identifier(r.get("isin")),
            "as_of": str(r["as_of"])[:10],
            "basis": r["basis"],
            "first_acquired_on": _date(r.get("first_acquired_on")),
            "last_acquired_on": _date(r.get("last_acquired_on")),
            "lots": _int(r.get("lots")),
            "fills": _int(r.get("fills")),
            "last_valued_on": _date(r.get("last_valued_on")),
            "disposition": _str(r.get("disposition")),
            "closed_on": _date(r.get("closed_on")),
            "subtype": _str(r.get("subtype")),
            "amfi_code": _str(r.get("amfi_code")),
            "jurisdiction": _str(r.get("jurisdiction")),
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


def _money(v, currency: str) -> Money | None:
    """A store number as Money, or None for NULL/NaN — an absent balance is an absence, not zero."""
    return None if v is None or _isnan(v) else Money(_dec(v), currency)


def cards(con, *, currency: str) -> list[dict]:
    """One row per credit card in this store — the picker. `outstanding` is the latest statement's new balance
    (₹ owed). Cards are a household liability, not owner-scoped, so every card in the store is returned."""
    from wealthlens import lens
    df = lens.cards(con=con)
    return [{
        "account_id": r["account_id"],
        "issuer": r["issuer"],
        "statements": int(r["statements"]),
        "since": _date(r.get("since")),
        "last_statement": _date(r.get("last_statement")),
        "outstanding": _money(r.get("outstanding"), currency),
    } for _, r in df.iterrows()]


def card_statements(con, *, issuer: str, currency: str) -> list[dict]:
    """The statement list for one card, newest first — the period selector, each row self-summarising."""
    from wealthlens import lens
    df = lens.card_statements(issuer, con=con)
    return [{
        "statement_date": _date(r["statement_date"]),
        "previous_balance": _money(r.get("previous_balance"), currency),
        "new_balance": _money(r.get("new_balance"), currency),
        "spends": Money(_dec(r["spends"]), currency),
        "payments": Money(_dec(r["payments"]), currency),
        "transactions": int(r["transactions"]),
    } for _, r in df.iterrows()]


def card_statement(con, *, issuer: str, period: str | None, currency: str) -> dict:
    """One card statement, itemised — the current-month view (or `period` for an older one). Returns the header
    (closing date, previous/new balance) and the transaction lines, amounts SIGNED (a purchase is negative)."""
    from wealthlens import lens
    df = lens.card_statement(issuer, period=period, con=con)
    hdr = df.attrs.get("statement", {})
    return {
        "issuer": hdr.get("issuer") or issuer,
        "statement_date": hdr.get("statement_date"),
        "previous_balance": _money(hdr.get("previous_balance"), currency),
        "new_balance": _money(hdr.get("new_balance"), currency),
        "transactions": [{
            "date": _date(r["date"]),
            "description": r["description"],
            "amount": Money(_dec(r["amount"]), currency),
            "direction": r["direction"],
            # the funding account for a payment line (the reverse of the bank→card drill-down), or None
            "funded_by_bank": _str(r.get("funded_by_bank")),
            "funded_by_date": _date(r.get("funded_by_date")),
        } for _, r in df.iterrows()],
    }


def _num(v) -> float | None:
    """A store number as a float, or None for NULL/NaN. Diary balances are UNIT quantities, not money."""
    return None if v is None or _isnan(v) else float(v)


def _str(v) -> str | None:
    return None if v is None or (isinstance(v, float) and _isnan(v)) else str(v)


def _holding_performance(con, instrument: str, currency: str) -> dict | None:
    """One holding's performance summary, or None when the store has no cost basis for it."""
    from wealthlens import lens
    df = lens.holding_performance(instrument, con=con)
    if df.empty:
        return None
    r = df.iloc[0]
    def m(v):
        return None if v is None or _isnan(v) else Money(_dec(v), currency)
    return {
        "invested": m(r.get("invested")),
        "current": m(r.get("current")),
        "gain": m(r.get("gain")),
        "realised": m(r.get("realised")),
        "unrealised": m(r.get("unrealised")),
        "abs_return_pct": _num(r.get("abs_return_pct")),
        "xirr_pct": _num(r.get("xirr_pct")),
        "corp_action": bool(r.get("corp_action")),
        "synthetic_dates": bool(r.get("synthetic_dates")),
    }


def _holding_lineage(con, instrument: str) -> list[dict]:
    """The succession chain a holding belongs to — former names, mergers, ISIN changes."""
    from wealthlens import lens
    df = lens.holding_lineage(instrument, con=con)
    return [{
        "date": _date(r["date"]),
        "from_isin": _str(r["from_isin"]),
        "from_name": _str(r["from_name"]),
        "to_isin": _str(r["to_isin"]),
        "to_name": _str(r["to_name"]),
        "action": _str(r["action"]),
        "ratio": _str(r["ratio"]),
        "note": _str(r["note"]),
    } for _, r in df.iterrows()]


def holding_diary(con, *, instrument: str, currency: str = "INR") -> dict:
    """One holding's full detail — its performance summary, its identity lineage (succession chain), and the
    complete CAS transcript with the `role` on each line. Balances in the transcript are unit quantities, not
    money, so they are plain numbers; the performance figures are Money."""
    from wealthlens import lens
    df = lens.holding_diary(instrument, con=con)
    lines = [{
        "date": _date(r["date"]),
        "line_kind": r["line_kind"],
        "role": _str(r["role"]),
        "action": _str(r["action"]),
        "description": _str(r["description"]),
        "debit": _num(r["debit"]),
        "credit": _num(r["credit"]),
        "closing": _num(r["closing"]),
        "pledged": _num(r["pledged_bal"]),
        "locked": _num(r["locked_bal"]),
        "free": _num(r["free_bal"]),
        "booked": _str(r["booked_event_id"]) is not None,
    } for _, r in df.iterrows()]
    name = _str(df["name"].iloc[0]) if len(df) else None
    if name is None:   # a holding with no CAS transcript (e.g. one reached only through a merger) still has a name
        row = con.execute("SELECT name FROM instruments WHERE instrument_id = ? LIMIT 1", [instrument]).fetchone()
        name = _str(row[0]) if row else None
    return {
        "instrument": instrument,
        "name": name,
        "performance": _holding_performance(con, instrument, currency),
        "lineage": _holding_lineage(con, instrument),
        "lines": lines,
    }


def card_bill_payments(con, *, currency: str) -> list[dict]:
    """The credit-card bill payments on the bank statement — the bank→card drill-down. Each row is a bank
    debit that settled a card; `resolved` says whether the card's statement is loaded and openable, and when
    it is, (issuer, statement_date) is the drill target."""
    from wealthlens import lens
    df = lens.card_bill_payments(con=con)
    return [{
        "date": _date(r["date"]),
        "bank": r["bank"],
        "amount": Money(_dec(r["amount"]), currency),
        "narration": r["narration"],
        "issuer": None if r.get("issuer") is None or (isinstance(r.get("issuer"), float) and _isnan(r["issuer"]))
                  else str(r["issuer"]),
        "statement_date": _date(r.get("statement_date")),
        "resolved": bool(r["resolved"]),
    } for _, r in df.iterrows()]


def _isnan(v) -> bool:
    import pandas as pd
    try:
        return bool(pd.isna(v))     # handles NaN, NaT, and pandas NA (nullable ints) without the != ambiguity
    except (TypeError, ValueError):  # a non-scalar / non-numeric is simply not NaN
        return False
