# Proposal — present the interpreted diary to end users (and take their answers)

Companion to WealthLens-core `openspec/changes/diary-interpretation/`. The engine produces: a verdict per
diary line, a story per holding, pledge spans, diagnosed gaps, an interpretation-coverage number, and (last)
an annotation mechanism. This change is where a household — dad, non-technical — meets all of it.

## Principles (carried from the build's decisions)

- **The verdict is WLC's, verbatim.** The frontend renders classifications; it never invents them.
- **Show the data and let feedback shape it** — but only where feedback is MEANINGFUL. The MF cost
  disclosure (TER/ARN/commission) is info-only, already absorbed in NAV: it gets a convenient display and
  NO feedback control. An `unmapped` transfer is a genuine question: it gets one.
- **Honesty rendering house style**: coverage and open questions are numbers on screen, not footnotes; a
  flag is a prompt with an action, never an alarm without one.
- **Fact vs interpretation stays visually distinct** — the reconciliation pill established the pattern:
  blank = confirmed fact; toned pill = introspection with a next step.
- **Sameness is evidence, not events.** A stock or MF held unchanged for ten years produces ~120 monthly
  balance lines with the same quantity — on a real store, balance lines are 62% of the whole diary (5,267
  of 8,447 rows). Those rows are not noise semantically: each is a statement CONFIRMING the position — the
  strongest possible evidence. But as ROWS they are pure clutter for exactly the holdings that deserve the
  least attention. So an unchanged run renders as ONE line of confidence, never a page of repetition —
  and the diary's default view becomes the EVENTFUL timeline, which is what a person opened it to see.

## The four surfaces

### 1. Holding drill-down (extend `HoldingDiaryPanel`)
- **Story strip** at the top: the `holding_story` timeline (acquired → additions → pledged-since →
  corp actions → exits/renames), each entry with its basis tone (booked / derived / inferred / answered).
  The transcript table stays below for the full detail — the story is navigation, not replacement.
- **Fund costs line** (disclosure rows): a quiet one-liner under the performance strip —
  "Regular plan via ARN-12195 · TER 2.57%" (+ commission when printed). No table rows shouting; no
  feedback control. This is the TER answer: visible in the one place someone examines a fund.
- **Pledge badge**: when a custody span is open, the holding header shows "pledged since ‹date›" (the span,
  not the instruction rows); the rows remain in the transcript for the curious.
- **Balance-run collapse** (the sameness principle, concretely): consecutive `balance` lines with an
  identical position (quantity + pledged/locked breakdown) fold into ONE span row —
  *"Unchanged at 1,200 units — confirmed by 120 statements, Jan 2016 → Aug 2026"* — expandable to the raw
  rows on click (nothing is hidden, it is folded; CSV export keeps every row). A balance line that CHANGES
  anything (quantity, a pledge appearing, a lock expiring) breaks the run and stands alone: change is an
  event, and events always show. For the ten-year untouched fund, the whole transcript becomes ~3 lines —
  acquired, the confirmation span, today — which is the truthful shape of that holding's story. The fold is
  presenter-side grouping over the same DTO rows (`line_kind='balance'` runs keyed on the position tuple);
  no engine change, no data loss.

### 2. The review queue (new — the interpretation-era heart)
One surface aggregating every open question the engine produces, each phrased in household terms WITH its
action:

| Source | The question as shown | The action offered |
|---|---|---|
| `reconciliation='unconfirmed'` holding (post-rename) | "Your latest statement no longer shows this — we still count it." | Upload that account's latest CAS (deep-link to Import) |
| Unchained group, diagnosed | "A statement for ~Apr–Jun 2019 seems to be missing for ‹account›." | Upload for that period |
| `unmapped` line | "We couldn't name this ‹date› transfer of ‹qty› units." | Answer it (the feedback control) |
| Per-file import warnings (footing, units, rejects) | already structured | Open the file's diagnose guidance |

Placement: a "Needs attention" card on Overview (count + top 3) linking to the full queue under Operations.
The count is the interpretation-coverage number's complement — the same honesty, one click deep.

### 3. The feedback control (new; ships LAST, after read-only surfaces)
On lines the engine marks answerable: a small "What was this?" affordance opening a picker of verdicts from
the engine's OWN vocabulary (gift in/out, family transfer, off-market sale, transmission, correction, …) +
optional counterparty + free-text note. Submits to a new bridge verb that writes the **annotation document**
(the corpus artifact — WLC design tier 3) and re-derives; the UI then shows the line as `answered` with the
user's words and full provenance (an annotation is a source you can open like any other). Free text is never
the primary field — the verdict comes from the vocabulary, so answers stay computable.

### 4. Reports (small deltas)
- The rename lands here: the pill reads "Unconfirmed — load latest CAS" (i18n key change).
- A "coverage" figure joins the provenance line of the diary-backed reports: "story 94% understood ·
  3 open questions" — the per-store honesty number, rendered where the numbers it qualifies live.

## Contract additions (bridge)
- `GET /api/holdings/{entity}/{instrument}/story` — the timeline (read-only; ships first).
- `GET /api/review-queue/{entity}` — the aggregated open questions with action descriptors.
- `POST /api/annotations/{entity}` — the answer (writes the corpus document via a verb; last).
- Diary line DTO gains `understanding: understood|answered|open` alongside the existing verdict fields.

## Sequencing (mirrors the engine's)
1. Story strip + fund-costs line + pledge badge (read-only, engine step 2).
2. Review queue, read-only actions only — upload deep-links (engine step 3's rename lands with it).
3. Feedback control + annotations (engine step 4).
4. CDSL rows appear everywhere automatically as parity lands (#8) — no UI change by design.
