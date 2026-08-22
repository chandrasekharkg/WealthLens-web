# ADR-0008 — MCP exposure of a household's own data: designed now, shipped later, gated hard

**Status:** ACCEPTED as design · **implementation DEFERRED beyond v1**

## Context

These users already work alongside AI assistants: onboarding happens over video calls with a desktop
agent doing much of the workload, WLC's own PARSER-AUTHORING is written *for* an assistant helping a
user, and the sibling PortfolioSimLab repo already exposes MCP tools. So "let an assistant answer
questions about my own holdings" is a natural ask, and `core/` (ADR-0007) makes it nearly free to build:
an MCP server is a second consumer of the same read layer.

**But it inverts this project's central promise, and that must be said plainly.**

WLC's pitch is *"your data never leaves your machine."* An MCP **server** is local and keeps that literally
true. The **client** is the problem: when a household connects a cloud-backed assistant, every tool result
that assistant reads becomes context sent to a remote model. Nothing in WealthLens transmits it — the user's
own client does — and that distinction is invisible to a non-technical person clicking "enable". A feature
that quietly converts "nothing leaves this machine" into "my entire portfolio is in a chat transcript" is
not a feature we may ship casually, however easy it is to build.

## Decision

**MCP exposure is a designed capability of WLW, not a v1 feature, and it ships only behind all of these:**

1. **Off by default; explicit, informed opt-in.** Enabling requires a deliberate action whose copy states
   the trade in plain language: *"An assistant you connect may send whatever it reads to its provider.
   Enable this only if you accept that for the data you scope below."* No dark-pattern default, no
   enabled-by-config-file-side-effect.
2. **Read-only, always.** MCP exposes queries. It never triggers WLC verbs — no import, no rebuild, and
   above all no promotion. The operations surface stays human-driven (ADR-0005/0006).
3. **Scoped, with aggregate-first defaults.** Scope is chosen per entity and per granularity:
   - *aggregate* (net worth by class, allocation, totals) — the default,
   - *positions* (instrument-level holdings), and
   - *transactions* (ledger detail) — each an additional, separate opt-in.
   A household can let an assistant reason about allocation without handing it every ISIN and balance.
4. **Local-only transport**, same posture as the bridge (ADR-0004): loopback, no LAN exposure without the
   phase-2 auth ADR.
5. **Visible while active.** The UI shows an unmistakable indicator when MCP is enabled, which entities
   and granularities are exposed, and a one-click disable. Enabling is not a thing a user can forget.
6. **Auditable.** Every MCP tool call is logged to Activity — tool, entity, granularity, timestamp — so a
   household can see exactly what was read and when.

## Why design it now rather than later

Because `core/` is being built now, and a read layer designed with scoping in mind costs nothing extra,
whereas retrofitting scope onto a layer that assumed a trusted caller is how privacy tools acquire
accidents. Concretely, `core/` should carry the granularity concept from the start, so both the HTTP API
and a future MCP server request data at a stated level rather than filtering after the fact.

## Alternatives considered

- **Ship MCP in v1 with the same trust as the UI.** Rejected: the UI's boundary is "whoever can run
  processes on this machine"; an MCP client's boundary is "wherever that client sends its context". Same
  process, entirely different exposure.
- **Put MCP in WLC instead.** Rejected: WLC is the custodian and stays minimal; the entity model, family
  manifest and aggregation that make MCP answers useful live here.
- **Never do it.** Rejected: the workflow is real and the value is real. The answer is a gate, not a ban.

## Consequences

- `core/` carries a granularity/scope parameter from its first commit.
- A future `bridge/wealthlens_web/mcp/` consumes `core/` with no HTTP dependency.
- The opt-in copy, the active indicator, and the Activity audit trail are UX work
  ([UX.md](../UX.md) — to be added when this is scheduled), not just backend work.
- If a local-model client becomes the common case, this ADR is worth revisiting: the trade changes
  materially when nothing leaves the machine at all.
