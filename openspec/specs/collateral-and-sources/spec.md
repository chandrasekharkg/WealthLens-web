# Collateral and sources

Browsing what a store was built from, opening those documents without a password hunt, and retracting a
source that should never have been there. This is the pane that makes the custodian legible.

## ADDED Requirements

### Requirement: The password ring tells the user which password opens a file

WLC already records, per file, **which named password reference** opened it (`password_cache`, keyed by
content hash — it stores the reference, not the secret). The collateral view SHALL surface that reference
beside each document, so a user opening a statement in their own PDF viewer knows which password applies
instead of guessing through a list.

#### Scenario: A statement's password is identified by name
- **WHEN** a document that WLC has previously opened is listed
- **THEN** the name of the password that opens it is shown — never the value

#### Scenario: A document nothing has opened yet
- **WHEN** no password reference is recorded for a file
- **THEN** the view says so plainly and offers the supply-a-password flow, rather than showing a blank

### Requirement: Revealing a password value is deliberate, momentary, and never displayed

The value behind a reference SHALL be released only on an explicit per-document user action, SHALL be
delivered straight to the clipboard without being rendered on screen, SHALL be cleared from the clipboard
after a short interval, and SHALL never appear in a log, an error, or any bulk listing response.

#### Scenario: Copying a password
- **WHEN** a user asks for the password of one document
- **THEN** the value reaches the clipboard, is not shown in the page, is cleared automatically after the
  interval, and the action is recorded in Activity as an event without the value

#### Scenario: A listing never carries secrets
- **WHEN** the collateral listing for a workspace is fetched
- **THEN** it contains password *references* only; no request that returns more than one document's
  metadata may carry any password value

### Requirement: Collateral shows each document's fate

Each file SHALL show what became of it: detected type, import outcome, the source it registered, and its
contribution (rows loaded). A file that failed, was rejected, or is still in the inbox SHALL be
distinguishable at a glance from one that loaded cleanly.

#### Scenario: An unparsed document is visible as such
- **WHEN** a file sits in the inbox unrecognised
- **THEN** it appears with that status and offers the diagnose flow (UC-C4)

### Requirement: A source can be retracted, and retraction states exactly what it removes

The system SHALL let a user remove everything one source contributed — WLC's delete-a-source guarantee.
Because this deletes stored facts, it SHALL be treated as destructive: the UI SHALL first show what will
be removed (the source, its document, and the row counts per table), and SHALL require a typed
confirmation naming the document, in the same guarded shape as promotion (ADR-0005).

#### Scenario: Removing a wrongly-imported statement
- **WHEN** a user retracts a source
- **THEN** they are shown its exact contribution before confirming, and afterwards the store contains no
  row from that source and no other source's rows are affected

#### Scenario: Retraction is never a bulk action
- **WHEN** the collateral view offers retraction
- **THEN** it applies to one named source at a time; there is no "remove all failed" sweep

### Requirement: Retraction goes through WLC — and in v1 it is TAUGHT, not built

Retraction SHALL be performed by a WLC verb invoked as a subprocess (ADR-0005), never by WLW writing to a
store. **Where no such verb exists, the UI SHALL show the user the exact steps to perform it in WLC**
(ADR-0012) — a copyable command with the source identified — rather than a disabled control or a local
reimplementation.

> **v1 position:** `capture_io.delete_source()` exists in WLC as a function with no CLI verb, and few
> households need retraction early. So v1 teaches it. **Graduation trigger:** when WLC gains a retraction
> verb, or when enough users ask, the taught command becomes the guarded in-app action specified above —
> the requirements below are written now so that graduation changes the mechanism, not the safeguards.

#### Scenario: No retraction verb is installed
- **WHEN** a user asks to remove a source and the installed WLC cannot be driven to do it
- **THEN** the UI shows the precise steps to run in WLC, naming the source, and nothing in WLW writes to
  the store

#### Scenario: The taught command is correct by construction
- **WHEN** the steps are displayed
- **THEN** they name WLC's own verb and the real source identifier, so following them cannot diverge from
  what the app would have done
