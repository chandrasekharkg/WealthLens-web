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

## Reachability — the diary as a lens, not a destination

Today's asymmetry is the whole problem this section fixes. `SourcePopup` — the *simpler* "where did this come
from" view — is already **Primitive B**: a self-contained modal (`role="dialog"`, backdrop, Escape-to-close,
fresh mount per open, prop surface `{entity, sourceId, format, onClose}`) reached from six screens.
`HoldingDiaryPanel` — the *richer* "whole story of this holding" view — renders as an inline `<section>`
(`.statement-drill`, pushed into the page flow) and is mounted from exactly ONE screen (Reports). The more
valuable view is the harder to reach, and it isn't even a popup. The diary already has the right prop shape
(`{entity, instrument, name, format, onClose}`, self-fetching) — what's missing is the shell and the doorways.

### Make it Primitive A (symmetric with the source popup)
1. **Extract a shared modal shell.** There is no reusable dialog today — `SourcePopup` hand-rolls its
   backdrop / `aria-modal` / Escape / focus-trap, and any second popup would duplicate it. Extract a `Modal`
   (backdrop-click + Escape close, focus trap, scroll lock, mounted-fresh semantics) and render BOTH popups
   in it — the diary becomes a popup and the source popup sheds its bespoke chrome in the same change.
2. **The diary renders in the shell unchanged.** Same component, same self-fetch; only its outer `<section>`
   becomes the modal body. Reports keeps working (it just opens the popup instead of growing a section).
3. **Add an optional anchor.** `HoldingDiaryPanel` gains `focusDiaryId?: string` — open scrolled to that line,
   briefly highlighted. This is what turns "reach the diary" into "reach THIS line," and it's what the review
   queue and the story strip both need.

### The doorways (the intuitive ways in)
- **The instrument name is a doorway** — the same principle as "the Source link is a doorway." Wherever a
  holding's name appears (Reports ✓, Family's per-member net worth, any future holdings list), the name is a
  button that opens the diary popup. One small `<InstrumentLink entity instrument name/>` used everywhere, so
  reachability is a property of the *name*, not of the screen that happens to show it.
- **URL-addressable** — `?holding=<entity>/<instrument>[&line=<diary_id>]` opens the popup on load. Every open
  becomes bookmarkable, reload-surviving, and **shareable** (dad can be sent a link straight to the holding
  whose question he needs to answer). It also makes every navigation below free — they just set the URL.
- **The review queue IS the diary, filtered** — an open question is a diary line. Clicking a queue item opens
  the diary popup anchored (`focusDiaryId`) to that line, in context of its neighbours — no separate detail
  view to build, and the answer is given right where the line lives.
- **The two popups cross-link** — SourcePopup already lists "which store tables it wrote"; extend it to the
  holdings a document touched → click one → its diary. And the diary's own Source link → SourcePopup. Provenance
  becomes a graph a person can walk both directions (statement → holdings, holding → statements).
- **Story-first depth (never the 120-row wall)** — the popup opens on the FOLDED story (the ~3-line sameness
  view: acquired · confirmation span · today), with "full transcript" one expand away. Reaching in is a glance
  by default; the balance-run collapse is what makes the popup usable as a quick-look, not a data dump.
- **The story strip entries are anchors** — inside the popup, clicking a story entry scrolls the transcript to
  the span it summarises (the strip is the index, the transcript is the full text — same `focusDiaryId` path).

### The anti-pattern to avoid
Do **not** add a "Diary" tab to the nav. The diary is a lens you pull over a holding, not a place you visit —
a destination would force "which holding?" up front and strand it away from the numbers it explains. Popup +
deep-link + the name-as-doorway keeps it *attached to context* everywhere, which is the whole point.

## The four surfaces

### 1. Holding drill-down (extend `HoldingDiaryPanel`, now a popup — see Reachability)
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

## Frontend refactor (prerequisite — see Reachability)
- Extract a shared `Modal` shell; render `SourcePopup` (Primitive B) and `HoldingDiaryPanel` (Primitive A) in
  it. `SourcePopup` sheds its bespoke backdrop/dialog chrome in the same change (net line reduction).
- `HoldingDiaryPanel` gains `focusDiaryId?` (open anchored to a line) and its story-first default view.
- New `<InstrumentLink>` — the name-as-doorway, used wherever a holding appears.
- URL state `?holding=<entity>/<instrument>[&line=<diary_id>]` drives the popup (open/close = set/clear query).

## Contract additions (bridge)
- `GET /api/holdings/{entity}/{instrument}/story` — the timeline (read-only; ships first).
- `GET /api/review-queue/{entity}` — the aggregated open questions with action descriptors.
- `POST /api/annotations/{entity}` — the answer (writes the corpus document via a verb; last).
- Diary line DTO gains `understanding: understood|answered|open` alongside the existing verdict fields.
- SourcePopup's detail gains the holdings a document touched (for the two-way provenance cross-link).

## Status — step 0 in place (2026-08-29, commit 12a6feb)
Built and trialable, verified in the browser against the synthetic demo family:
- Shared `Modal` shell (`Modal.tsx`); the diary renders as a popup (Primitive A) OR inline, chosen by a
  `presentation` prop, with a live inline⇄popup switch in the head so both framings can be compared.
- The sameness balance-run collapse is baked into the panel (folds ≥3 identical consecutive balance lines to
  one "Confirmed" row; a labelled toggle reveals every row; data untouched; unit-tested).

`diary_id` is now exposed on the `DiaryLine` DTO (WLC `lens.holding_diary` → bridge model → generated types,
commits b9532d1 / 75d5f5d) — so `focusDiaryId` anchoring, the review-queue → line deep-link, and the
annotation binding key are all UNBLOCKED. Still to do in step 0: `<InstrumentLink>` (name-as-doorway
everywhere), URL state, and wiring `focusDiaryId` into the panel (scroll-to + highlight on open).

## Sequencing (mirrors the engine's)
0. **The reachability refactor** — shared `Modal`, diary-as-popup, `<InstrumentLink>`, URL state. Pure
   frontend, ships FIRST and independently: it makes today's diary reachable before any interpretation lands,
   and every surface below mounts into it. *(Modal + diary-as-popup + sameness-fold done; see Status.)*
1. Story strip + fund-costs line + pledge badge (read-only, engine step 2).
2. Review queue, read-only actions only — upload deep-links (engine step 3's rename lands with it); queue
   items open the diary popup anchored to their line.
3. Feedback control + annotations (engine step 4).
4. CDSL rows appear everywhere automatically as parity lands (#8) — no UI change by design.
