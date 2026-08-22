# ADR-0003 — Frontend stack

**Status:** PROPOSED (genuinely open — this is the one skeleton decision deliberately left to the
implementing contributors; the founding request mentioned "React Native", and this ADR frames the choice
rather than pre-empting it)

## Context

The deliverable is a **web application** served locally by the bridge: setup flows + interactive reports,
consuming a localhost JSON API. The known near-term users are households on desktop browsers; a plausible
later want is viewing from a phone (which phase-2 LAN serving covers via the *browser* — a native app is a
separate, further question).

## Options

1. **React (web), Vite toolchain.** The boring, dominant choice for exactly this shape: SPA over a local
   JSON API, huge contributor familiarity, no native toolchain. Charting and table ecosystems are richest
   here. Phone access works through the phone's browser once LAN serving (ADR-0004 phase 2) exists.
2. **React Native + react-native-web.** One codebase that could later ship a real mobile app. Cost: a
   heavier toolchain, web output that fights the DOM for tables/charts (the core of this product), and
   native-app distribution questions (stores, signing) that a local-first privacy tool may never want.
3. **Svelte/Vue/HTMX-style server-rendered.** Lighter, but smaller contributor pools, and the founding
   contributor's stated stack is React-family.

## Recommendation (to be confirmed by the implementers)

**Option 1 — React + Vite, web-first.** Reports and tables are DOM-native work; the phone story is the
browser over LAN, not an app store. Revisit Option 2 only if a genuine native-app requirement emerges
(offline mobile, push, biometrics) — at which point it becomes its own ADR superseding this one.

## Constraints that hold regardless of choice

- **Fully self-contained build**: no CDN scripts, no external fonts, no telemetry — the frontend must work
  and stay private on a machine with no internet.
- Talks ONLY to the bridge API; no direct store or filesystem access.
- Accessibility and plain-HTML degradability are cared about: this is a tool households rely on.
