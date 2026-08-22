"""Reports, as a list of reports — each a series of sections.

One flat table of everything is content-accurate and unreadable: a hundred-odd rows of mixed cash,
deposits, property and securities answers "what do I own" only in the sense that the data is present
somewhere on the page. So a report is **sections**, each backed by one lens answer, each labelled with the
kind of thing it holds.

**This is presentation, not recomputation.** Asking lens several questions and laying the answers out is
what a presenter is for. Re-deriving figures lens already computes — subtotal hierarchies, coverage
arithmetic — would be recomputing WLC's semantics and stays forbidden. The test for any number here: did it
come from a lens *answer*, or from a sum of our own?

The section list is expected to churn — more columns, better icons, new cuts — so it is data, defined once
below, rather than a screen per report.
"""
from __future__ import annotations

import dataclasses

from wealthlens_web.core import aggregate, money, provenance

# Asset classes as WLC actually labels them. Anything not claimed by a section still appears in
# "everything", so a class added upstream is never silently invisible — just not yet grouped.
CASH = "savings"


@dataclasses.dataclass(frozen=True)
class SectionSpec:
    id: str
    title: str
    icon: str
    classes: tuple[str, ...] = ()
    note: str | None = None


@dataclasses.dataclass(frozen=True)
class ReportSpec:
    id: str
    title: str
    subtitle: str
    sections: tuple[SectionSpec, ...]


REPORTS: tuple[ReportSpec, ...] = (
    ReportSpec(
        id="accounts",
        title="Accounts",
        subtitle="What sits with a bank, a builder, or a card issuer.",
        sections=(
            SectionSpec("cash", "Cash at bank", "🏦", (CASH,),
                        note="The running balance of each account's latest transaction."),
            SectionSpec("deposits", "Fixed deposits", "🔒", ("fixed_deposit",),
                        note="Valued by accrual to the date shown, not by a stale statement figure."),
            SectionSpec("cards", "Credit cards", "💳", ("credit_card", "payable"),
                        note="Amounts owed — these reduce net worth."),
            SectionSpec("property", "Property", "🏠", ("real_estate",)),
        ),
    ),
    ReportSpec(
        id="market",
        title="Market instruments",
        subtitle="Things with a price somebody else sets.",
        sections=(
            SectionSpec("equities", "Equities", "📈", ("listed_equity", "unlisted_equity")),
            SectionSpec("funds", "Mutual funds & ETFs", "📊", ("mutual_fund", "etf")),
            SectionSpec("bonds", "Bonds & sovereign gold", "🧾", ("bond",)),
        ),
    ),
    ReportSpec(
        id="everything",
        title="Everything",
        subtitle="Every position in one table — accurate, and the least readable of the three.",
        sections=(SectionSpec("all", "All positions", "📋"),),
    ),
)


def spec(report_id: str) -> ReportSpec | None:
    return next((r for r in REPORTS if r.id == report_id), None)


def catalogue() -> list[dict]:
    """The list of reports, for the nav — no store is opened to build it."""
    return [{"id": r.id, "title": r.title, "subtitle": r.subtitle,
             "sections": [{"id": s.id, "title": s.title, "icon": s.icon} for s in r.sections]}
            for r in REPORTS]


def build(m, report_id: str, *, on: str | None = None,
          our_pids: frozenset[int] = frozenset()) -> dict:
    """One report: every section, its rows, and a total per section."""
    found = spec(report_id)
    if found is None:
        raise KeyError(report_id)

    rows = aggregate.positions(m, on=on, our_pids=our_pids)
    all_rows = rows.rows()
    claimed = {c for r in REPORTS for s in r.sections for c in s.classes}

    sections = []
    for section in found.sections:
        if section.classes:
            mine = [row for row in all_rows if row.get("asset_class") in section.classes]
        elif section.id == "all":
            mine = all_rows
        else:
            # A class no section claims still has to land somewhere visible, or a class added upstream
            # would vanish from every report without a word.
            mine = [row for row in all_rows if row.get("asset_class") not in claimed]
        sections.append({
            "id": section.id,
            "title": section.title,
            "icon": section.icon,
            "note": section.note,
            "rows": mine,
            # The section total is a sum of lens ANSWERS in one currency, which `money.total` refuses to do
            # across currencies rather than guessing.
            "total": _total(mine),
            "count": len(mine),
        })

    return {
        "id": found.id,
        "title": found.title,
        "subtitle": found.subtitle,
        "as_of": rows.as_of,
        "reporting_currency": rows.reporting_currency,
        "is_partial": rows.is_partial,
        "excluded": [{"entity_id": e.entity_id, "label": e.label, "reason": e.excluded_reason,
                      "owner_warning": e.owner_warning} for e in rows.excluded],
        "provenance": provenance.for_rows(rows).as_dict(),
        "sections": sections,
    }


def _total(rows: list[dict]) -> money.Money | None:
    """core computes, the API serialises (ADR-0018) — so this hands back Money, not its wire shape."""
    try:
        return money.total([r["value"] for r in rows if r.get("value") is not None])
    except money.MixedCurrency:
        return None                       # a mixed-currency section states no total rather than a wrong one
