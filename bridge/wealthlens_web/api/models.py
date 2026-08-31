"""The response contract, declared once.

These models exist so the API's shape is **published** rather than implied by whatever a handler happened
to return. The frontend's types are generated from them, and a drift test fails when the two diverge — so
a contract change the UI has not adopted breaks at build time rather than in a household's dashboard
(bridge-api).

Money is `{amount, currency}` with the amount as a **string**. JSON numbers are IEEE doubles, and putting a
household's net worth through one would undo the DECIMAL(18,2) the store keeps and this app just spent
effort preserving. A string crosses the wire exactly and the client formats it.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from wealthlens_web.core.verbs import JobState, Outcome
from wealthlens_web.core.workspaces import Availability


class Money(BaseModel):
    amount: str = Field(description="Exact decimal as a string — never a JSON number (see module docstring)")
    currency: str = Field(description="ISO 4217 code")


class Identifier(BaseModel):
    kind: Literal["isin", "none"] = Field(description="'none' is STATED, never inferred from a blank field")
    value: str | None = None


class Holder(BaseModel):
    process: str
    pid: int
    ours: bool = Field(description="True only when this app started the process — never inferred")


class RowProvenance(BaseModel):
    """The provenance + audit columns every fact row can carry — the WHO column set (Primitive A) and the
    `source_id` the source popup opens on (Primitive B). All optional: a derived/aggregate row that has no
    single originating document leaves them None rather than inventing one."""
    source_id: str | None = None
    created_by: str | None = None
    created_at: str | None = None
    updated_by: str | None = None
    updated_at: str | None = None


class SourceTableCount(BaseModel):
    table: str
    rows: int


class WorkspaceInfo(BaseModel):
    label: str
    availability: Availability
    detail: str | None = None
    schema_version: str | None = None
    holder: Holder | None = None


class ClassTotal(BaseModel):
    asset_class: str
    value: Money
    basis: str | None = Field(default=None, description="How WealthLens-core valued this line")


class EntityTotal(BaseModel):
    entity_id: str
    label: str
    owner: str = Field(description="Whose beneficial share these figures are valued for")
    total: Money | None = None
    evidence_as_of: str | None = Field(
        default=None, description="Newest DOCUMENT evidence — not the date the view was computed at")
    contributes: bool
    status: Literal["ok", "stale", "excluded"] = "ok"
    excluded_reason: str | None = None
    owner_warning: str | None = None
    workspaces: list[WorkspaceInfo] = []
    by_class: list[ClassTotal] = []


class Provenance(BaseModel):
    """What an exported or printed artifact carries so a figure survives leaving the app (ADR-0013)."""

    title: str
    scope: str = Field(description="Whose money this is, in words a reader outside the household can use")
    as_of: str | None = Field(default=None, description="The single date everything was computed at")
    reporting_currency: str
    stores: list[str] = []
    filters: list[str] = []
    warnings: list[str] = Field(
        default=[], description="What a shared date does NOT fix: exclusions, and stale evidence")
    row_count: int | None = None


class NetWorth(BaseModel):
    granularity: Literal["aggregate"]
    as_of: str | None = Field(default=None, description="The date the view was COMPUTED at")
    reporting_currency: str
    total: Money | None = None
    is_partial: bool = Field(description="True when a declared entity could not be included")
    stale_count: int = Field(default=0, description="Included entities answering from stale evidence")
    entities: list[EntityTotal]
    provenance: Provenance


class Excluded(BaseModel):
    entity_id: str
    label: str
    reason: str | None = None
    owner_warning: str | None = None


class PositionRow(RowProvenance):
    entity_id: str
    entity_label: str
    name: str | None = None
    asset_class: str | None = None
    account_id: str | None = None
    instrument_id: str | None = None            # the stable key a drill-down links on (holding → its history)
    quantity: float | None = None
    value: Money
    identifier: Identifier
    as_of: str | None = None
    basis: str | None = None
    # the position's stored projection (WLC full-column-read-surface): acquisition history, the reason a
    # zero is a zero, and cheap instrument metadata. NULL where the store has no events to say — which the
    # presenter reads as "not known for this household", not as a gap.
    first_acquired_on: str | None = None        # earliest acquisition, walked over the succession chain
    last_acquired_on: str | None = None
    lots: int | None = None                     # distinct acquiring dates (decisions, not fills)
    fills: int | None = None
    last_valued_on: str | None = None           # the PIT anchor for an unexplained zero
    disposition: str | None = None              # NULL = live; else written_off / sold / succeeded / unknown
    closed_on: str | None = None
    # NULL = confirmed by (or not gated on) a latest CAS; 'superseded' = still counted, but a newer statement
    # of its own demat dropped it and we could not explain where it went — an honest "load the missing CAS".
    reconciliation: str | None = None
    subtype: str | None = None
    amfi_code: str | None = None
    jurisdiction: str | None = None


class TransactionRow(RowProvenance):
    entity_id: str
    entity_label: str
    date: str | None = None
    bank: str | None = None
    account_id: str | None = None
    account_label: str | None = Field(default=None, description="Legible per-account identity, e.g. 'SBI ••1375' (canonical-folded)")
    narration: str | None = None
    amount: Money = Field(description="Signed: negative left the household")
    balance: Money | None = None


class Positions(BaseModel):
    provenance: Provenance
    granularity: Literal["positions"]
    as_of: str | None = None
    reporting_currency: str
    is_partial: bool
    excluded: list[Excluded] = []
    rows: list[PositionRow] = []


class Transactions(BaseModel):
    provenance: Provenance
    granularity: Literal["transactions"]
    as_of: str | None = None
    reporting_currency: str
    is_partial: bool
    excluded: list[Excluded] = []
    rows: list[TransactionRow] = []


CardStatus = Literal["paid", "paid_minimum", "partial", "unpaid", "nil", "pending"]
"""A statement's paid-state, derived from the action tuple (minimum due / due date) vs the next cycle's
payments: fully paid / at least the minimum / less than the minimum / nothing / nothing owed / no next cycle
yet. None when the store lacks the facts to decide."""


class CardRow(BaseModel):
    """One credit card in the picker, tagged with whose store it came from."""

    account_id: str
    issuer: str
    statements: int = Field(description="How many statements are loaded for this card")
    since: str | None = Field(default=None, description="Date of the first transaction on record")
    last_statement: str | None = Field(default=None, description="Closing date of the newest statement")
    outstanding: Money | None = Field(default=None, description="The newest statement's new balance — ₹ owed")
    status: CardStatus | None = Field(default=None, description="The newest statement's paid-state (the star)")
    entity_id: str | None = None
    entity_label: str | None = None


class Cards(BaseModel):
    provenance: Provenance
    granularity: Literal["cards"]
    reporting_currency: str
    is_partial: bool
    excluded: list[Excluded] = []
    rows: list[CardRow] = []


class CardStatementSummary(BaseModel):
    """One statement in a card's history — the period selector, each row self-summarising."""

    statement_date: str | None = None
    previous_balance: Money | None = None
    new_balance: Money | None = None
    spends: Money = Field(description="Σ purchases this period")
    payments: Money = Field(description="Σ credits and bill payments this period")
    transactions: int
    status: CardStatus | None = Field(default=None, description="This statement's paid-state (the star)")
    source_id: str | None = Field(default=None, description="The document this statement came from")


class CardStatements(BaseModel):
    entity_id: str
    issuer: str
    statements: list[CardStatementSummary] = []


class CardStatementLine(RowProvenance):
    date: str | None = None
    description: str | None = None
    amount: Money = Field(description="Signed: a purchase is negative, a payment/credit positive")
    direction: Literal["spend", "payment"]
    funded_by_bank: str | None = Field(default=None, description="For a payment line: the bank account that funded it")
    funded_by_date: str | None = None


class CardStatement(BaseModel):
    """One card statement, itemised — the current-month view."""

    entity_id: str
    issuer: str
    statement_date: str | None = None
    previous_balance: Money | None = None
    new_balance: Money | None = None
    source_id: str | None = Field(default=None, description="The document this statement came from — opens the PDF")
    transactions: list[CardStatementLine] = []
    provenance: Provenance


class CardBillPaymentRow(RowProvenance):
    """A credit-card bill payment on the bank statement — the bank→card drill-down. Carries the payment's own
    provenance (the bank statement the debit came from), independent of how the bill was resolved."""

    date: str | None = None
    bank: str | None = Field(default=None, description="The account the payment left from")
    amount: Money = Field(description="₹ paid (positive)")
    narration: str | None = None
    issuer: str | None = Field(default=None, description="The card, identified by the amount or the narration")
    statement_date: str | None = Field(
        default=None, description="The bill this settled — the drill target, when the card is loaded")
    resolved: bool = Field(description="True when the card's statement is loaded and openable")
    match: Literal["exact", "cycle", "none"] | None = Field(
        default=None,
        description="How the statement was resolved: 'exact' = its closing balance equals the amount (this "
                    "payment cleared that bill); 'cycle' = no exact match, the cycle's latest statement is "
                    "offered instead (typically a partial payment); 'none' = unresolved")
    entity_id: str | None = None
    entity_label: str | None = None


class CardBillPayments(BaseModel):
    provenance: Provenance
    granularity: Literal["card_payments"]
    reporting_currency: str
    is_partial: bool
    excluded: list[Excluded] = []
    rows: list[CardBillPaymentRow] = []


class DiaryLine(RowProvenance):
    """One line of a holding's CAS transcript. Balances are UNIT quantities, not money."""

    diary_id: str | None = Field(
        default=None,
        description="Stable content-hash id of the diary line — the anchor a review-queue item or story "
        "entry deep-links to, and the key a user annotation binds to.",
    )
    date: str | None = None
    line_kind: str
    role: str | None = Field(default=None, description="Why the line did/didn't move ownership")
    action: str | None = None
    description: str | None = None
    debit: float | None = None
    credit: float | None = None
    closing: float | None = None
    pledged: float | None = None
    locked: float | None = None
    free: float | None = None
    booked: bool = Field(description="True when this line reached the quantity ledger")
    broker: str | None = Field(default=None, description="DP/broker name of the demat this line touched")
    verdict: str | None = Field(default=None, description="Interpreted category (UI renders label + tone)")
    needs_review: bool = Field(default=False, description="An off-market/CA line WLC could not classify — flag it")


class HoldingPerformance(BaseModel):
    """One holding's performance summary, from its cost basis. None on the drill-down when there is none."""

    invested: Money | None = None
    current: Money | None = None
    gain: Money | None = None
    realised: Money | None = None
    unrealised: Money | None = None
    abs_return_pct: float | None = None
    xirr_pct: float | None = Field(default=None, description="Money-weighted return")
    corp_action: bool = Field(default=False, description="Cost & value may sit on different ISINs — approximate")
    synthetic_dates: bool = Field(default=False, description="Buy dates were inferred — XIRR is approximate")


class HoldingPosition(BaseModel):
    """One demat account's slice of a holding — the per-broker breakdown a consolidated diary needs, because
    the transcript below merges every broker's lines. Shares are UNIT quantities, not money."""

    broker: str | None = Field(default=None, description="DP/broker name of the demat (falls back to its DP-ID)")
    account_masked: str | None = Field(default=None, description="Last 4 of the demat id, e.g. ••1857")
    shares: float | None = Field(default=None, description="Units currently held in this demat")
    since: str | None = Field(default=None, description="First acquired date in this demat, when the ledger knows it")
    reconciliation: str | None = Field(default=None, description="e.g. 'superseded' — this demat's slice is unconfirmed")


class LineageEdge(BaseModel):
    """One recorded change in a holding's identity — a merger, demerger, or ISIN change."""

    date: str | None = None
    from_isin: str | None = None
    from_name: str | None = None
    to_isin: str | None = None
    to_name: str | None = None
    action: str | None = None
    ratio: str | None = None
    note: str | None = None


class HoldingDiary(BaseModel):
    """One holding's full detail — performance, identity lineage, and the CAS transcript."""

    entity_id: str
    instrument: str
    name: str | None = None
    performance: HoldingPerformance | None = None
    positions: list[HoldingPosition] = []
    lineage: list[LineageEdge] = []
    lines: list[DiaryLine] = []
    provenance: Provenance


class PerformanceBucket(BaseModel):
    """One asset-class slice of the current portfolio value."""

    asset_class: str
    value: Money
    share: float = Field(default=0, description="Percent of the positive-bucket total; computed in the bridge")


class PerformancePoint(BaseModel):
    """One (month, asset-class) value on the growth series, with its PRE-SUMMED stack position."""

    date: str | None = None
    asset_class: str
    value: Money
    base: Money | None = Field(default=None, description="Cumulative stack floor below this band")
    top: Money | None = Field(default=None, description="Cumulative stack ceiling incl. this band")


class Performance(BaseModel):
    """The portfolio, for the charts: the current value breakup and the monthly value series per class.
    Every figure the charts REPORT (total, share, axis ticks, stack edges) is computed here, not the UI."""

    reporting_currency: str
    total: Money | None = Field(default=None, description="Portfolio total = sum of positive buckets")
    breakup: list[PerformanceBucket] = []
    series: list[PerformancePoint] = []
    axis_max: Money | None = Field(default=None, description="Growth-chart Y-axis maximum")
    axis_ticks: list[Money] = Field(default=[], description="Growth-chart Y-axis tick values (money labels)")


class FamilyMemberRow(BaseModel):
    """One household member and the money moved to them from a store."""

    member_id: str | None = None
    name: str | None = None
    relationship: str | None = None
    transfers: int = 0
    total: Money
    first_transfer: str | None = None
    last_transfer: str | None = None
    holdings: int = Field(default=0, description="Instruments the store attributes to this member")
    entity_id: str | None = Field(default=None, description="The sending store")
    entity_label: str | None = None


class Family(BaseModel):
    provenance: Provenance
    granularity: Literal["family"]
    reporting_currency: str
    is_partial: bool
    excluded: list[Excluded] = []
    rows: list[FamilyMemberRow] = []


class TransferRow(RowProvenance):
    """One bank transfer to a household member."""

    date: str | None = None
    bank: str | None = None
    narration: str | None = None
    amount: Money


class FamilyTransfers(BaseModel):
    entity_id: str
    person: str
    transfers: list[TransferRow] = []
    provenance: Provenance


class Deposit(BaseModel):
    """Where an uploaded statement landed. A deposit, not an import — nothing was parsed."""

    filename: str
    renamed_from: str | None = Field(
        default=None, description="Set when a name collided: both files are kept, never overwritten")
    entity_id: str
    inbox: str


class DiagnoseBundle(BaseModel):
    """The safe-to-share diagnostic for an unrecognized statement — STRUCTURE ONLY, no values, names, or ids.
    The on-ramp a user hands to their AI agent, or reads alongside the 'Add your bank' guide."""

    filename: str
    fingerprint: str | None = Field(default=None, description="A stable id for this layout — same format, same id")
    pages: int | None = None
    needs_ocr: bool = Field(default=False, description="True when scanned pages carry content no text parser reads")
    scanned: int = 0
    report: str = Field(description="The masked layout report — every value replaced by its shape")


class RawParseLine(BaseModel):
    """One extracted line, placed by geometry and reduced to its masked shape. NO raw content — the shape and
    the box are safe to share; the real text lives only on the PDF the browser renders locally."""

    bbox: dict = Field(description="Word bounding box in PDF points: {x0, x1, top, bottom}")
    fate: str = Field(description="interpreted | not_interpreted | dropped | furniture")
    reason: str | None = None
    shape: str = Field(description="The masked shape (# per digit, <ISIN>, <W> per word) — safe to share")


class RawParsePage(BaseModel):
    page: int
    lines: list[RawParseLine] = Field(default_factory=list)


class RawParseView(BaseModel):
    """The geometry-aware fate of every extracted line, for the PDF-beside-interpretation overlay. Structure
    only (masked shapes + boxes); the user's real values are on the PDF, streamed to their own browser."""

    filename: str
    scale: float = Field(default=2.0, description="pixel:point ratio the page images are rendered at; the "
                         "overlay multiplies each box's point bbox by this to align")
    classified: bool = Field(default=True, description="True when the fates are auto-assigned (a depository "
                             "CAS); False when the type isn't classified yet and every line shows as furniture")
    summary: dict = Field(default_factory=dict, description="fate → count")
    pages: list[RawParsePage] = Field(default_factory=list)


class PasswordRef(BaseModel):
    kind: Literal["named", "unnamed", "none"] = Field(
        description="THREE states, not two: named, opened-by-something-unnamed, or never opened")
    name: str | None = None


class DocumentInfo(BaseModel):
    source_id: str
    kind: str
    provider: str | None = None
    filename: str | None = None
    payload_ref: str | None = None
    rows: int | None = None
    captured_at: str | None = None
    period_start: str | None = Field(default=None, description="Statement period start, when the source records one")
    period_end: str | None = Field(default=None, description="Statement period end / statement date")
    password: PasswordRef


class SourceDetail(BaseModel):
    """Everything the source popup shows for one fact row's source_id (Primitive B). `document` is the
    collateral view — filename, path, statement period, and the password to copy — reusing the exact shape the
    Workspace document list renders, so the popup opens the file and copies its password the same way. `detail`
    is the adapter's own captured facts (card min-due / statement date, …); `tables` is which store tables the
    source wrote. An unknown id fails soft: source_id None, no document, empty detail, no tables."""
    source_id: str | None = None
    adapter: str | None = Field(default=None, description="The parser that read this source (not on DocumentInfo)")
    document: DocumentInfo | None = None
    detail: dict[str, Any] = {}
    tables: list[SourceTableCount] = []


class SettingsInfo(BaseModel):
    holder_names: list[str] = []
    pan_set: bool = Field(description="Set or unset only — the value is never returned by any read")
    organize: bool
    secret_names: list[str] = []
    config_path: str


class Opened(BaseModel):
    """Confirmation that a collateral file was handed to the OS to open. The path is the user's own machine,
    already shown on this screen — returning it is feedback, not a leak."""
    path: str


class Revealed(BaseModel):
    """One re-obtainable secret, released on an explicit request (ADR-0019).

    This model exists on exactly one endpoint. Nothing that returns a list may carry it.
    """

    what: str
    value: str


class WorkspaceDetail(BaseModel):
    entity_id: str
    path: str
    workspace: WorkspaceInfo
    settings: SettingsInfo
    documents: list[DocumentInfo] = []


class ReportSection(BaseModel):
    id: str
    title: str
    icon: str
    note: str | None = None
    rows: list[PositionRow] = []
    total: Money | None = Field(default=None, description="None when the section spans currencies")
    count: int


class ReportSummary(BaseModel):
    """A report as it appears in the nav — no store is opened to build this."""

    id: str
    title: str
    subtitle: str
    sections: list[dict[str, str]] = []


class Report(BaseModel):
    id: str
    title: str
    subtitle: str
    as_of: str | None = None
    reporting_currency: str
    is_partial: bool
    excluded: list[Excluded] = []
    provenance: Provenance
    sections: list[ReportSection] = []


class EngineInfo(BaseModel):
    present: bool
    schema_version: str | None = None
    detail: str | None = None


class StoreInfo(BaseModel):
    entity_id: str
    workspace: str
    schema_version: str | None = None
    availability: Availability


class Version(BaseModel):
    engine: EngineInfo
    stores: list[StoreInfo] = []


class Job(BaseModel):
    id: str
    verb: str
    entity_id: str
    state: JobState
    outcome: Outcome | None = None
    gate: str | None = Field(default=None, description="Which gate refused — branch on this, not the message")
    message: str | None = None
    changed_something: bool = Field(description="False for a refusal: the store is untouched")
    result: dict[str, Any] = {}
    exit_code: int | None = Field(
        default=None, description="Recorded, never interpreted — `outcome` is the authority")
