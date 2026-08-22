# Manual facts

Guided authoring of `manual/*.yaml` — the facts no document can parse (unlisted equity, let-out property,
a hand-reconciled corporate action, a stopgap value awaiting its real statement). WLC already accepts these
as first-class corpus; today they must be hand-written YAML, which puts them out of reach of exactly the
people WLW exists for.

**These are corpus, not config.** A manual file is a *source artifact* like a downloaded statement — it is
replayed on every rebuild, its rows carry a `manual` source with a declared fidelity, and deleting it
removes its contribution. Authoring one is therefore an ADR-0005 "deposit input", not a store write.

## ADDED Requirements

### Requirement: Guided authoring in WLC's own vocabulary

The system SHALL provide form-based authoring for the manual schedules WLC defines, presenting **WLC's
existing vocabulary** — the ITR-2 schedule names and field names (`unlisted_equity_shares` /
`HeldUnlistedEqShrPrYr`, `house_property` / `ScheduleHP`, and the generic `target_table` + `key` +
`records` form) — and SHALL NOT invent a parallel vocabulary of its own.

#### Scenario: A user records unlisted equity without writing YAML
- **WHEN** a user completes the unlisted-equity form
- **THEN** a valid `manual/*.yaml` is written in WLC's documented shape, using the schedule's own field
  names, and `wealthlens import <data>/manual` applies it unchanged

#### Scenario: The form matches the tax form the user already knows
- **WHEN** a schedule exists in ITR-2
- **THEN** its fields are labelled as the tax form labels them, so a user transcribing from their own
  filing recognises every box

### Requirement: Fidelity is chosen explicitly, in plain language

Authoring SHALL require choosing the fact's standing — `authoritative` (100), `stopgap` (10–40), or
`reference` — explained in plain terms, defaulting to **nothing**. The UI SHALL state the consequence:
an authoritative fact a parser must never overwrite, versus a stopgap that a real document will supersede.

#### Scenario: A placeholder is recorded as a placeholder
- **WHEN** a user enters a value they read off a broker screenshot while waiting for the real statement
- **THEN** the UI guides them to `stopgap`, and the entry is visibly marked as awaiting supersession

### Requirement: Documents first — manual entry is offered as the exception

Where a fact could plausibly come from a document, the UI SHALL say so before accepting a manual entry,
and SHALL offer the document path (upload / diagnose) first. Manual authoring is for facts no document
can supply, or explicit stopgaps — never a convenient way to bypass parsing.

#### Scenario: A user tries to hand-enter a bank balance
- **WHEN** manual authoring is opened for a fact type a parser already covers
- **THEN** the UI recommends importing the statement instead, and requires an explicit choice to continue
  as a stopgap

### Requirement: Every entry is validated before it is written

The system SHALL validate a manual entry against the live store schema (table and column names, types,
required keys) **before** writing the file, reporting errors in the form rather than producing a YAML that
fails at import.

#### Scenario: An invalid column never reaches disk
- **WHEN** a form would produce a column name the schema does not have
- **THEN** the error is shown against that field and no file is written

### Requirement: Editing is round-trip safe and replay-honest

The system SHALL open existing `manual/*.yaml` for editing (including files hand-written outside WLW),
preserve any fields it does not present, and never silently drop or reformat content it did not author.
After any change, the UI SHALL state that the corpus changed and the store must be re-imported or rebuilt
to reflect it.

#### Scenario: A hand-written file survives a UI edit
- **WHEN** a YAML containing fields WLW's form does not expose is edited and saved
- **THEN** those fields are preserved verbatim in the written file

#### Scenario: The user learns the store is now behind the corpus
- **WHEN** a manual fact is added or changed
- **THEN** the UI marks that workspace as having un-applied corpus changes and offers import/rebuild

### Requirement: Evidence and provenance travel with the fact

Authoring SHALL support attaching `evidence` (the documents justifying the entry) and SHALL record the
entry's author-facing metadata as WLC defines it, so a manual fact is as auditable as a parsed one.

#### Scenario: A hand-reconciled corporate action carries its justification
- **WHEN** a user records a bonus issue from an AGM notice
- **THEN** the file lists that document as evidence, and the entry is traceable to it in review
