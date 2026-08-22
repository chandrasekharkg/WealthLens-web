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

The value behind a reference SHALL be released only on an explicit per-document user action, on its own
endpoint, and SHALL never appear in a log, an error, or any bulk listing response (ADR-0019). It SHALL be
delivered to the clipboard rather than rendered on screen, and the app SHOULD clear it after a short
interval.

> Clearing is **best-effort, not a guarantee**: a page cannot reliably clear a clipboard later — the
> permission is gated and focus-dependent in several browsers — and it would clobber whatever the user
> copied in between. Writing it as a SHALL would be an untestable promise, and the honest version is a
> value the user knows they now hold.
>
> This applies to re-obtainable secrets only. The store key has no reveal at any strength (ADR-0015).

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

> **v1 position.** `capture_io.delete_source()` exists in WLC as a function with **no CLI verb**, so there
> is no single command to teach. What v1 teaches instead is the sequence WLC genuinely supports, which is
> the corpus invariant doing the work: move the document into `_quarantine/` (which `rebuild` and `import`
> skip entirely), `wealthlens rebuild` to replay the remaining corpus into a fresh store alongside the
> current one, review the tally, then `wealthlens promote` — which re-checks and refuses rather than
> warning, so the taught sequence carries the same gates the app would.
>
> That is not a workaround — retraction *is* `store = replay(corpus)` with one document removed, and the
> taught sequence is more honest than a one-shot delete because the user sees the difference before
> promoting.
>
> **Graduation trigger:** if WLC gains a one-step retraction verb, or rebuild proves too slow for the
> households that need this, the sequence becomes the guarded in-app action specified above. The
> requirements are written now so graduation changes the mechanism, not the safeguards.

#### Scenario: A user asks to remove a source in v1
- **WHEN** retraction is requested and the installed WLC has no one-step verb
- **THEN** the UI shows the quarantine-rebuild-promote sequence with this document's real path filled in,
  and nothing in WLW writes to the store

#### Scenario: Taught steps must be executable as shown
- **WHEN** any command is displayed for the user to run
- **THEN** it names a verb the installed WLC actually has, with real paths and identifiers — a taught
  command that fails when pasted is worse than no button at all (UX-VALIDATION P4)
