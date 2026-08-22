# ADR-0011 — Extensions: user-hosted modules, declaratively rendered pages, a visible boundary

**Status:** ACCEPTED 2026-08-22

## Context

WLW should let a household run its own additions — a module, an API, its own storage, a custom page — in
the same process and the same UI, without forking. The requirement came with two conditions that pull
against each other: contributing an extension must be **effortless**, and the boundary between what the
project ships and what a user plugged in must stay **clear**.

The hard half is the frontend. Three ways a custom page can reach a React app:

1. **Runtime-loaded JavaScript** (module federation / importing a bundle from a URL). Most powerful, and
   worst on every other axis: arbitrary third-party JS inside a page that renders financial data, a build
   toolchain for every extension author, and a test burden nobody can bound.
2. **Declarative pages** — the extension supplies data endpoints plus a manifest describing what to show;
   the shipped UI renders it with the shipped components.
3. **Fork the frontend.** Defeats the purpose.

## Decision

**Extensions are a backend module plus a declarative page manifest. No user JavaScript runs in the UI.**

**Backend.** An extension is a Python module discovered at startup (an `extensions/` folder in the
workspace, plus entry points for installable ones). It may expose FastAPI routes under a reserved prefix
(`/ext/<name>/…`), and it may bring **its own storage** — that is the extension's business and entirely
its own. ADR-0002's "no database" binds *WLW*; it does not forbid an extension from having one, and WLW
never stores or manages extension data on its behalf.

**Frontend.** An extension declares pages as data: a title, an icon, and an ordered list of sections —
`table`, `chart`, `stat`, `text`, `form` — each naming the extension endpoint that feeds it and how to map
the response onto the section's fields. The shipped renderer draws it with the same table and chart
components everything else uses.

**The boundary is visible.** Extension pages are grouped separately in navigation and carry a marker
identifying them as user-supplied, with the extension's name. A household must always be able to tell what
the project shipped from what they (or a contributor) added — the same honesty rule the data views follow.

**Extensions never gain privileges the app does not have.** They read through the same `core/` layer,
under the same granularity rules (ADR-0008); they cannot write a WLC store, cannot invoke verbs outside the
job model, and cannot bypass the security middleware.

## Why declarative wins here

- **Effortless, as required**: an extension is a Python file and a manifest. No bundler, no npm, no build.
- **Testable within ADR-0010**: the *renderer* is tested once, thoroughly. An extension is then data, and
  its manifest is validated by a pure function — so extensions cost the project almost no test burden,
  which is precisely the failure mode we are avoiding.
- **Consistent by construction**: extension pages inherit the app's components, i18n, money formatting and
  accessibility, rather than each reinventing them badly.
- **Reviewable**: a manifest can be read. A minified bundle cannot.

The honest cost: an extension cannot draw something the section vocabulary does not express. That is the
trade — and the right response to a real gap is to grow the vocabulary for everyone, not to open a hole
that lets one extension inject code. If runtime-loaded JS ever becomes genuinely necessary, it needs its
own ADR superseding this one, with a sandboxing and review story attached.

## Consequences

- The section vocabulary is a public contract and versioned as one.
- A "hello world" extension (a module + a manifest + one endpoint) belongs in the repo as the canonical
  example, and doubles as the renderer's test fixture.
- Navigation, i18n and the boundary marker must all handle extension-supplied strings — which are
  untrusted text, escaped and never rendered as markup.
