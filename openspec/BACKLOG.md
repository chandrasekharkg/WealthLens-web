# Backlog

Small, real, and observed by using the app — not a wish list. Each item says what is wrong now, because in
a month the sentence "polish the passwords table" will mean nothing to anybody.

Bigger pieces of work live in `BUILD-PLAN.md` (phases) or as an OpenSpec change; this file is for the ones
that are a day's work or less.

## Next session (2026-08-24)

1. **`lens` returns the store's full projection.** WLC change `full-column-read-surface` — the read surface
   answers with every stored column, described, so columns are WLW's choice rather than a WLC release.
   Blocks the acquisition date on the market-instruments report, which is deliberately not being faked in
   the meantime. **Start here**: the multi-lot question (a position with several acquiring events has
   several dates) is answered before anything is built.
2. **`native-cas-primary`** — the native reader becomes the depository CAS parser. Spec written; the NSDL
   printed-total oracle is built before casparser is cut from that path, never the reverse.

## Observed on 2026-08-23, unscheduled

- **The password ring's table is ragged.** Each row's Copy control sits wherever the name before it ended,
  so the column of copies does not line up. It is a column; it should read as one.
- **A statement in the collateral list is not openable.** The app knows the file's path and shows its name;
  a reader who wants to look at the document it came from has to go and find it in the filesystem by hand.
  Note the boundary before building: WLW never *reads* a statement (ADR-0001), so this is "ask the OS to
  open this path", not a viewer — and it has to refuse a path outside the workspace rather than trust one.
- **No report answers "what came from which document?"** Every position knows its source, and there is no
  way to ask the question from the other end: this file, ingested on this date — what did it put in the
  store, and what did it not? That is the report a person opens when a figure looks wrong, and the one that
  makes an under-reading parser visible. It is also the natural home for the import history that Activity
  forgets on restart.
