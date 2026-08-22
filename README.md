# WealthLens-web

**The family's window onto WealthLens** — an interactive, local-first web UI for setup, reports, and a
single view across every family member's holdings. *(Working name: WLW.)*

WealthLens-core (WLC) is deliberately minimal: a provable, oracle-gated **data custodian** with an
encrypted store per person and a CLI. This repo is everything WLC deliberately is not: **the visualizer and
aggregator** — guided configuration instead of editing TOML, dashboards instead of notebooks, and one
family view over stores that remain strictly separate underneath.

> **Division of duties, in one line:** WLC owns the truth; WLW shows it.
> WLW never parses a statement, never writes a store, and holds **no database** — it is a stateless
> read-only presenter over [`lens.py`](https://github.com/chandrasekharkg/WealthLens-core), plus one
> durable artifact: the **family manifest** (`family.toml` — which workspaces exist, whose they are, and
> how to present them).

## What it does

- **Setup, guided.** First-run flows for creating/connecting a WLC workspace, passwords/config seeding,
  and adding family members' workspaces — the ease-of-use layer WLC's CLI doesn't try to be.
- **Reports.** Net worth, holdings, spending, point-in-time views — everything `lens.py` can answer,
  rendered interactively, per person or for the whole family.
- **Family aggregation.** One combined view across N entities (you, spouse, parents…) while each entity
  keeps its **own separate encrypted store** — WLC's federated-store semantics (its ADR-0008) are the
  foundation, not a limitation to work around. Every aggregated number remains attributable to the entity
  it came from.

## What it deliberately is not

- **Not a custodian.** No parsing, no ingestion logic, no schema, no store writes (the single exception:
  triggering `wealthlens import` as a subprocess, which is WLC writing to its own store).
- **Not a database.** State = the WLC stores (theirs) + `family.toml` (ours) + ephemeral UI state.
- **Not a cloud service.** Local-first, zero telemetry, nothing leaves the machine. Binding beyond
  localhost (a family member's phone on the LAN) is a designed, ADR-gated step with an auth story — not a
  default.

## Architecture (two thin layers)

```
 frontend/   the SPA (setup + reports)          — talks only to the bridge
 bridge/     read-only Python API over lens.py  — per-entity store access, aggregation, family.toml
             └─ one write-ish endpoint: POST /import → runs `wealthlens import` in a subprocess
```

The stores are encrypted DuckDB files; their keys never reach a browser. The bridge opens each store
**read-only** with the same workspace resolution WLC itself uses.

## Governance

Same model as WLC: governed behavior lands as an [OpenSpec change](openspec/project.md) first;
architecturally significant choices are [ADRs](openspec/decisions/). Same license (MIT). Start with
[ARCHITECTURE.md](ARCHITECTURE.md).

## Status

**Definition stage — specs and design settled, implementation next.** The [use cases](openspec/USE-CASES.md),
[UX first pass](openspec/UX.md) (information architecture, screens, the four critical flows), six
[ADRs](openspec/decisions/) and four capability specs define what gets built. The stack is React + Vite +
TypeScript over a Python bridge ([ADR-0003](openspec/decisions/0003-frontend-stack.md)).

**First reviewers wanted.** [UX.md](openspec/UX.md) ends with open questions — nav shape, where the as-of
date belongs, how much of the machinery a non-technical household member should ever see. Opinions from
people who actually keep a household's books are worth more here than more design from us.
