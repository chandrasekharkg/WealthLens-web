# ADR-0003 — Frontend stack: React + Vite, web-first, minimal dependencies

**Status:** ACCEPTED 2026-08-22 (supersedes the PROPOSED draft that left the React vs React Native
question open)

## Context

The deliverable is a **web application** served locally by the bridge: setup flows, workspace and family
management, operational verbs, and interactive reports over a localhost JSON API. Known users are
households on desktop browsers; the phone story is a phone's *browser* over LAN once ADR-0004 phase 2
exists — not an app-store binary. The seed UI (WLC PR #1) is already React-family territory in spirit:
plain HTML/CSS with custom properties, hand-rolled sort/filter, `fetch` against a local API.

## Decision

**React + Vite + TypeScript, web-first**, with a deliberately small dependency set.

| Concern | Choice | Why this one |
|---|---|---|
| Framework | **React 18** | Largest contributor pool; the founding contributor's stack; nothing here needs more. |
| Build | **Vite** | Fast dev, trivial static build, no bundler archaeology. |
| Language | **TypeScript** | The bridge API is a contract between two layers in one repo — typed responses catch skew at build time rather than in a household's dashboard. |
| Server state | **TanStack Query** | Long-running verbs, polling job status, refetch-on-focus and cache invalidation are its exact remit; hand-rolling this is where local dashboards usually rot. |
| Tables | **TanStack Table (headless)** | Krishnus hand-rolled sort/filter well, but Holdings across a family grows columns and rows fast. Headless = no styling lock-in. |
| Charts | **Recharts** | Adequate for allocation/trend; React-native API. Kept to ONE charting dependency. |
| Styling | **Plain CSS with custom properties** — no framework | Continues the seed UI's approach, keeps markup readable for contributors who aren't front-end specialists, and adds nothing to audit. |
| Routing | **React Router** | Six areas plus workspace drill-down needs real URLs (deep-linking to a workspace's Health tab is a support tool). |
| Tests | **Vitest + React Testing Library**, **Playwright** for critical flows | The promotion guard (ADR-0005/0006) gets an end-to-end test that asserts it is unreachable without a completed check. |

**Rejected: React Native + react-native-web.** It buys a hypothetical native app and costs a heavier
toolchain plus web output that fights the DOM for exactly what this product is made of — dense tables and
charts. If a genuine native requirement appears (offline mobile, push, biometrics), it becomes its own
ADR superseding this one, and the bridge API is unchanged by that choice.

## Constraints that bind regardless of the above

- **Self-contained build.** No CDN scripts, no external fonts, no analytics, no telemetry. The app must
  work, and stay private, on a machine with no internet.
- **The frontend talks only to the bridge.** No direct filesystem or store access; no third-party
  network calls of any kind.
- **Shipped built.** Releases include the built `frontend/dist`, and the bridge serves it — a user needs
  Python and a browser, never Node. Node is a *contributor* dependency only. (This follows directly from
  ADR-0006's tired-user standard: installing a JS toolchain is not part of anyone's onboarding.)
- **Accessible and degradable.** Keyboard-navigable, screen-reader-sane, and legible without JS-driven
  layout tricks. Households rely on this; some of them at 11pm.

## Consequences

- One new toolchain for contributors (Node/npm), scoped to `frontend/` and not required to run WLW.
- Dependency count is a reviewed budget, not an accident: additions to the table above are ADR-worthy,
  because "small enough to audit" is part of this project's trust story.
- TypeScript types for the bridge API should be generated from or checked against the bridge's own
  schema, so the contract cannot drift silently — an early implementation task.
