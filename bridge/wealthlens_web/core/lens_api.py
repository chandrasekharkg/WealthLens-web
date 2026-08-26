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


def value_series(con, *, currency: str, owner: str = "self", months: int = 36) -> list[dict]:
    """Portfolio value per asset class at each month-end — the growth-chart series. Asset value, not net
    worth (liabilities excluded)."""
    from wealthlens import lens
    df = lens.value_series(months=months, owner=owner, con=con)
    return [{"date": _date(r["as_of"]), "asset_class": r["asset_class"],
             "value": Money(_dec(r["value"]), currency)} for _, r in df.iterrows()]


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
            "name": _str(r["name"]),
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
            **_prov(r),
        })
    return out


def sources(con) -> list[dict]:
    """The source registry — one row per document/feed registered in this store, newest capture first.
    Its own verb so every WLC call still funnels through this one module (collateral shapes these into the
    Workspace document list); the read is a plain projection, not new arithmetic."""
    from wealthlens import lens
    df = lens.sql(
        "SELECT source_id, source_type, provider, payload_ref, row_count, captured_at, "
        "       period_start, period_end, content_sha256, detail "
        "FROM sources ORDER BY captured_at DESC NULLS LAST, source_id",
        con=con,
    )
    return df.to_dict("records")


def source_detail(con, source_id: str) -> dict:
    """One source's full provenance — the record behind the "source" popup (Primitive B). The adapter facts
    live in `detail` (already a dict); empty {} when the id is unknown so the popup fails soft."""
    from wealthlens import lens
    d = lens.source_detail(source_id, con=con)
    if d.get("detail") is None:     # a source with no adapter facts → an empty object, never a null the DTO rejects
        d["detail"] = {}
    return d


def source_tables(con, source_id: str) -> list[dict]:
    """Which store tables one source wrote, and how many rows into each — the "tables updated" line on the
    source popup / Workspace. Empty when the id touched nothing (or is unknown)."""
    from wealthlens import lens
    df = lens.source_tables(source_id, con=con)
    return [{"table": r["table"], "rows": int(r["rows"])} for _, r in df.iterrows()]


def transactions(con, *, since: str | None, until: str | None, currency: str) -> list[dict]:
    """Ledger-level rows. The finest granularity, and the one scoped exposure exists to gate."""
    from wealthlens import lens
    # bank_only: the card:* subledger has no running balance and lives in the card views; a "bank
    # transactions" ledger that mixed it in would show a NaN balance on every card line.
    df = lens.transactions(since=since, until=until, bank_only=True, con=con)
    return [{
        "date": str(r["value_date"])[:10],
        "bank": r["bank"],
        "account_id": r["account_id"],
        "narration": r["narration"],
        # Signed: negative left the household. The sign is the fact, so it is not split into a type column.
        "amount": Money(_dec(r["signed_amount"]), currency),
        # A row without a running balance (rare on a real bank account) reads as absent, not zero.
        "balance": _money(r["current_balance"], currency),
        **_prov(r),
    } for _, r in df.iterrows()]


def _money(v, currency: str) -> Money | None:
    """A store number as Money, or None for NULL/NaN — an absent balance is an absence, not zero."""
    return None if v is None or _isnan(v) else Money(_dec(v), currency)


def _paid_status(con) -> dict[tuple[str, str], str]:
    """{(issuer, 'YYYY-MM-DD') → paid/paid_minimum/partial/unpaid/nil/pending} for every statement — the star
    on the statement list and the card picker. The lens derives it from the captured action tuple (minimum due /
    due date) against the NEXT cycle's payment credits; the newest statement, having no next cycle yet, is
    'pending'."""
    from wealthlens import lens
    df = lens.card_paid_status(con=con)
    return {(str(r["issuer"]), str(r["statement_date"])[:10]): str(r["status"]) for _, r in df.iterrows()}


def cards(con, *, currency: str) -> list[dict]:
    """One row per credit card in this store — the picker. `outstanding` is the latest statement's new balance
    (₹ owed) and `status` the newest statement's paid-state (the picker star). Cards are a household liability,
    not owner-scoped, so every card in the store is returned."""
    from wealthlens import lens
    df = lens.cards(con=con)
    status = _paid_status(con)
    def _st(issuer, last):
        return status.get((str(issuer), last)) if last else None
    return [{
        "account_id": r["account_id"],
        "issuer": r["issuer"],
        "statements": int(r["statements"]),
        "since": _date(r.get("since")),
        "last_statement": _date(r.get("last_statement")),
        "outstanding": _money(r.get("outstanding"), currency),
        "status": _st(r["issuer"], _date(r.get("last_statement"))),
    } for _, r in df.iterrows()]


def card_statements(con, *, issuer: str, currency: str) -> list[dict]:
    """The statement list for one card, newest first — the period selector, each row self-summarising."""
    from wealthlens import lens
    df = lens.card_statements(issuer, con=con)
    status = _paid_status(con)
    return [{
        "statement_date": _date(r["statement_date"]),
        "previous_balance": _money(r.get("previous_balance"), currency),
        "new_balance": _money(r.get("new_balance"), currency),
        "spends": Money(_dec(r["spends"]), currency),
        "payments": Money(_dec(r["payments"]), currency),
        "transactions": int(r["transactions"]),
        "status": status.get((str(issuer), _date(r["statement_date"]))) if _date(r["statement_date"]) else None,
        # each statement in the list IS one source — the document behind that row
        "source_id": _str(r.get("source_id")),
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
        # the statement's own source — so the header can open the statement document
        "source_id": _str(hdr.get("source_id")),
        "transactions": [{
            "date": _date(r["date"]),
            "description": r["description"],
            "amount": Money(_dec(r["amount"]), currency),
            "direction": r["direction"],
            # the funding account for a payment line (the reverse of the bank→card drill-down), or None
            "funded_by_bank": _str(r.get("funded_by_bank")),
            "funded_by_date": _date(r.get("funded_by_date")),
            **_prov(r),
        } for _, r in df.iterrows()],
    }


def _num(v) -> float | None:
    """A store number as a float, or None for NULL/NaN. Diary balances are UNIT quantities, not money."""
    return None if v is None or _isnan(v) else float(v)


def _str(v) -> str | None:
    # _isnan (pd.isna) catches NaT and pandas NA too, not just float NaN — so a derived row's NULL timestamp
    # (CAST(NULL AS TIMESTAMP)) yields None here, never the literal string "NaT".
    return None if v is None or _isnan(v) else str(v)


def _prov(r) -> dict:
    """The provenance + audit columns off a lens fact row — the WHO column set (Primitive A) and the
    `source_id` the source popup opens on (Primitive B). Every field optional: a lens row that doesn't carry
    a column, or carries it NULL (a derived/aggregate row with no single source), yields None, never a stand-in.
    Timestamps are trimmed to the second; the UI formats from there."""
    get = r.get if hasattr(r, "get") else (lambda k, d=None: d)
    out = {k: _str(get(k)) for k in ("source_id", "created_by", "updated_by")}
    for k in ("created_at", "updated_at"):
        v = _str(get(k))
        out[k] = v[:19] if v else None
    return out


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
        **_prov(r),
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


def family_transfers(con, *, currency: str) -> list[dict]:
    """Money moved to household members, per person. `member_id` is the recipient — the fan adds `entity_id`
    for the sending store, so the two never clash."""
    from wealthlens import lens
    df = lens.family_transfers(con=con)
    return [{
        "member_id": _str(r["entity_id"]),
        "name": _str(r["name"]),
        "relationship": _str(r["relationship"]),
        "transfers": int(r["transfers"]),
        "total": Money(_dec(r["total"]), currency),
        "first_transfer": _date(r.get("first_transfer")),
        "last_transfer": _date(r.get("last_transfer")),
        "holdings": int(r["holdings"]),
    } for _, r in df.iterrows()]


def transfers_to(con, *, person: str, currency: str) -> list[dict]:
    """Every bank transfer to one household member — the drill behind family_transfers."""
    from wealthlens import lens
    df = lens.transfers_to(person, con=con)
    return [{
        "date": _date(r["date"]),
        "bank": _str(r["bank"]),
        "narration": _str(r["narration"]),
        "amount": Money(_dec(r["amount"]), currency),
        **_prov(r),
    } for _, r in df.iterrows()]


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
        # how the statement was resolved — 'exact' (bill cleared), 'cycle' (fallback/partial), or 'none'
        "match": _str(r.get("match")),
        # the payment's own source (the bank statement the debit came from) — traceable whatever the match
        **_prov(r),
    } for _, r in df.iterrows()]


def _isnan(v) -> bool:
    import pandas as pd
    try:
        return bool(pd.isna(v))     # handles NaN, NaT, and pandas NA (nullable ints) without the != ambiguity
    except (TypeError, ValueError):  # a non-scalar / non-numeric is simply not NaN
        return False
