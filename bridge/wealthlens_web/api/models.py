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
    entities: list[EntityTotal]
    provenance: Provenance


class Excluded(BaseModel):
    entity_id: str
    label: str
    reason: str | None = None
    owner_warning: str | None = None


class PositionRow(BaseModel):
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
    subtype: str | None = None
    amfi_code: str | None = None
    jurisdiction: str | None = None


class TransactionRow(BaseModel):
    entity_id: str
    entity_label: str
    date: str | None = None
    bank: str | None = None
    account_id: str | None = None
    narration: str | None = None
    amount: Money = Field(description="Signed: negative left the household")
    balance: Money


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


class CardRow(BaseModel):
    """One credit card in the picker, tagged with whose store it came from."""

    account_id: str
    issuer: str
    statements: int = Field(description="How many statements are loaded for this card")
    since: str | None = Field(default=None, description="Date of the first transaction on record")
    last_statement: str | None = Field(default=None, description="Closing date of the newest statement")
    outstanding: Money | None = Field(default=None, description="The newest statement's new balance — ₹ owed")
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


class CardStatements(BaseModel):
    entity_id: str
    issuer: str
    statements: list[CardStatementSummary] = []


class CardStatementLine(BaseModel):
    date: str | None = None
    description: str | None = None
    amount: Money = Field(description="Signed: a purchase is negative, a payment/credit positive")
    direction: Literal["spend", "payment"]


class CardStatement(BaseModel):
    """One card statement, itemised — the current-month view."""

    entity_id: str
    issuer: str
    statement_date: str | None = None
    previous_balance: Money | None = None
    new_balance: Money | None = None
    transactions: list[CardStatementLine] = []


class CardBillPaymentRow(BaseModel):
    """A credit-card bill payment on the bank statement — the bank→card drill-down."""

    date: str | None = None
    bank: str | None = Field(default=None, description="The account the payment left from")
    amount: Money = Field(description="₹ paid (positive)")
    narration: str | None = None
    issuer: str | None = Field(default=None, description="The card, identified by the amount or the narration")
    statement_date: str | None = Field(
        default=None, description="The bill this settled — the drill target, when the card is loaded")
    resolved: bool = Field(description="True when the card's statement is loaded and openable")
    entity_id: str | None = None
    entity_label: str | None = None


class CardBillPayments(BaseModel):
    provenance: Provenance
    granularity: Literal["card_payments"]
    reporting_currency: str
    is_partial: bool
    excluded: list[Excluded] = []
    rows: list[CardBillPaymentRow] = []


class DiaryLine(BaseModel):
    """One line of a holding's CAS transcript. Balances are UNIT quantities, not money."""

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


class HoldingDiary(BaseModel):
    """One holding's full transcript — every CAS line for it, in order (detailed_holding_diary)."""

    entity_id: str
    instrument: str
    name: str | None = None
    lines: list[DiaryLine] = []


class Deposit(BaseModel):
    """Where an uploaded statement landed. A deposit, not an import — nothing was parsed."""

    filename: str
    renamed_from: str | None = Field(
        default=None, description="Set when a name collided: both files are kept, never overwritten")
    entity_id: str
    inbox: str


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
    password: PasswordRef


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
