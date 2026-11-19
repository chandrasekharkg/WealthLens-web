# WealthLens-web

**The family's window onto WealthLens** — an interactive, local-first web UI for setup, reports, and a
single view across every family member's holdings. *(Working name: WLW.)*

WealthLens-core (WLC) is deliberately minimal: a provable, oracle-gated **data custodian** with an
encrypted store per person and a CLI. This repo is everything WLC deliberately is not: **the visualizer and
aggregator** — guided configuration instead of editing TOML, dashboards instead of notebooks, and one
family view over stores that remain strictly separate underneath.

> **Division of duties, in one line:** WLC owns the truth; WLW shows it.
> WLW never parses a statement and never writes a WLC store, and holds **no database** of its own — it is a
> thin presenter over [`lens.py`](https://github.com/chandrasekharkg/WealthLens-core) whose only side effects
> are a small, **closed set of hand-offs to WLC** (running WLC verbs, depositing an upload, writing a
> config/secret value by WLC's own convention — see [`bridge-api`](openspec/specs/bridge-api/spec.md)), plus
> one durable artifact of its own: the **family manifest** (`family.toml` — which workspaces exist, whose they
> are, and how to present them).

## Working on this repo

**Read [AGENTS.md](AGENTS.md) first** — it is the developer and agent guide: the testability rule, the
regression rule, the boundary rules, and how the local gates work.

### Setup

**Just want to run it?** Don't set this repo up on its own — the blessed path installs the engine and this
app into **one shared venv** from WealthLens-core. From scratch, one line into a dedicated `~/WealthLens`:

```bash
curl -fsSL https://raw.githubusercontent.com/chandrasekharkg/WealthLens-core/main/install.sh | bash
```

Already have WealthLens-core? From that checkout: `python bootstrap.py --with-web` (clones this repo beside
it, installs it into the same venv, builds the frontend, seeds a demo). Then `./wealthlens-serve` serves it.

### Launching

`./wealthlens-serve` (in your WealthLens folder, e.g. `~/WealthLens`) runs the app in the foreground and prints the
one address to open. Ctrl-C stops it, and any verb it is running stops cleanly too. The launcher reads these
settings from the environment; every one is optional:

| Setting | Default | What it does |
|---|---|---|
| `WLW_MANIFEST` | your `family.toml` | the family manifest: which stores, which entities |
| `WLW_HOST` / `WLW_PORT` | `127.0.0.1` / `8765` | the address the app binds |
| `WLW_PUBLIC_ORIGIN` | `http://<host>:<port>` | the address the browser uses, when a TLS front serves the app ([ADR-0022](openspec/decisions/0022-public-origin-behind-a-tls-front.md)) |
| `WLW_STOP_GRACE` | `15` | seconds a stopping app gives a running verb before killing it |
| `WLW_LOG_FORMAT` | `text` | `json` for one JSON object per line on stderr ([ADR-0023](openspec/decisions/0023-logs-carry-shape-not-values.md)) |

A bad value refuses to start and says why, rather than serving with a guess.

**Keeping it running.** To start the app at login and restart it after a crash, hand the launcher to your
system's supervisor. It writes its log to stderr, and the supervisor decides where that goes.

macOS, as a launchd agent at `~/Library/LaunchAgents/org.wealthlens.serve.plist` (replace `YOU` with your
user name):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>org.wealthlens.serve</string>
  <key>ProgramArguments</key><array><string>/Users/YOU/WealthLens/wealthlens-serve</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ExitTimeOut</key><integer>30</integer>
  <key>StandardOutPath</key><string>/Users/YOU/Library/Logs/wealthlens-serve.log</string>
  <key>StandardErrorPath</key><string>/Users/YOU/Library/Logs/wealthlens-serve.log</string>
</dict></plist>
```

```bash
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/org.wealthlens.serve.plist   # load and start, once
```

```bash
launchctl kickstart -k gui/$UID/org.wealthlens.serve                              # restart
```

Linux, as a systemd user unit at `~/.config/systemd/user/wealthlens.service`:

```ini
[Unit]
Description=WealthLens web

[Service]
ExecStart=%h/WealthLens/wealthlens-serve
Restart=on-failure
TimeoutStopSec=30

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now wealthlens        # start now and at login
```

```bash
systemctl --user restart wealthlens             # restart; the log is in journalctl --user -u wealthlens
```

Keep the supervisor's stop timeout (`ExitTimeOut`, `TimeoutStopSec`) above `WLW_STOP_GRACE`. Under a
supervisor, **restart through it, not by running `./wealthlens-serve` by hand**. A second copy either fails to
bind the port, or, if your launcher frees the port first, stops the supervised copy. A supervisor doesn't
restart a copy that exited cleanly.

**After an update.** A change to the bridge (Python) needs a restart; a change to the frontend needs
`npm run build` in `frontend/`, then a reload in the browser.

**Contributing to the bridge or frontend?** The per-repo dev setup (its own venv; WLC gets installed into it
by the unified installer, or `pip install -e ../WealthLens-core` yourself):

```bash
python -m venv .venv && .venv/bin/pip install -e "bridge[dev]"   # bridge: fastapi, pytest, ruff
cd frontend && npm install                                        # frontend: vite, vitest, eslint
git config core.hooksPath .githooks                               # enable the local gates
```

Two gates run locally, and CI runs the same checks:

- **pre-commit** — a personal-data scan of the staged lines. This repo is public, and the realistic leak is
  a real value pasted into an *example* (a docstring, a spec, a fixture), not a committed statement. It
  reports `file:line` and which pattern matched, never the matched text. Deliberately synthetic data:
  put `pii-ok` on the line.
- **pre-push** — the same scan over the pushed range, then `ruff`, `eslint`, `tsc` and both unit suites.
  Each step skips loudly if its toolchain is absent, so a frontend-only contributor is not blocked by a
  missing Python venv.

The three end-to-end browser tests are **not** in the hooks — too slow for every push. Run them on demand:

```bash
cd frontend && npm run e2e:install   # once
npm run e2e
```

**GitHub CI runs the PII/secret scan on every PR** (a contributor's PR can't run the local hooks), and the
heavier build/test/E2E jobs **once a day** and on demand from the Actions tab. The local hooks are the real
gate for build/test; the scheduled run adds what a hook cannot afford — the E2E flows and a clean-machine
install.

## What it does

- **Setup, guided.** First-run flows for creating/connecting a WLC workspace, passwords/config seeding,
  and adding family members' workspaces — the ease-of-use layer WLC's CLI doesn't try to be.
- **Reports.** Net worth, holdings, spending, point-in-time views — everything `lens.py` can answer,
  rendered interactively, per person or for the whole family. Reports are sectioned by asset class, share
  one Columns picker, and every holding drills down into its **event diary**.
- **Transactions, cards, and bills.** A bank-transactions ledger, credit-card statements, and card
  bill-payment history — the everyday money movement, not just the portfolio snapshot.
- **Performance.** Invested vs. current, returns and shares, with data-freshness surfaced — the numbers
  computed in the bridge so the UI stays a thin presenter.
- **Family aggregation.** One combined view across N entities (you, spouse, parents…) while each entity
  keeps its **own separate encrypted store** — WLC's federated-store semantics (its ADR-0008) are the
  foundation, not a limitation to work around. Every aggregated number remains attributable to the entity
  it came from.

## What it deliberately is not

- **Not a custodian.** No parsing, no ingestion logic, no schema, no WLC-store writes. The side-effecting
  surface is a **closed, enumerated set** of hand-offs to WLC — running WLC verbs as subprocesses
  (`import`/`rebuild`/`verify`/`diagnose`/…), depositing an upload into a workspace inbox, deleting a staged
  inbox file, and writing a config/secret value by WLC's own convention — plus writing WLW's own manifest.
  Each is WLC (or WLW's manifest) acting; none writes a WLC store from the bridge. See
  [`bridge-api`](openspec/specs/bridge-api/spec.md).
- **Not a database.** State = the WLC stores (theirs) + `family.toml` (ours) + ephemeral UI state.
- **Not a cloud service.** Local-first, zero telemetry, nothing leaves the machine. It binds `127.0.0.1` by
  default; **LAN serving** (a family member's phone on the home network) is a supported, **off-by-default**
  capability via `WLW_HOST` — but only under a **trusted-LAN** assumption, with **no per-user authentication**
  yet ([ADR-0020](openspec/decisions/0020-lan-serving-and-write-surface.md)). It can sit behind a TLS front on the
  same machine: set `WLW_PUBLIC_ORIGIN` to the address the browser uses (e.g. `https://aipc.local:8444`) and bind
  loopback ([ADR-0022](openspec/decisions/0022-public-origin-behind-a-tls-front.md)).
- **Stops cleanly.** On SIGTERM the app stops the verbs it started: SIGTERM first, then a kill after
  `WLW_STOP_GRACE` seconds (default 15). Under a supervisor, set its stop timeout above that, e.g.
  `TimeoutStopSec=30` in a systemd unit. A verb stopped mid-write leaves no half-written backup or candidate
  (WLC `shutdown-safe-writes`).
- **Logs what happened, never whose money.** One line per request (route template, status, duration) and one per
  finished job (verb, outcome, gate, exit code, duration), on standard error. Readable text by default;
  `WLW_LOG_FORMAT=json` gives one JSON object per line for a log tool. No line ever holds a query string, a raw
  path, an entity id, a verb's message or narration, or an error's text
  ([ADR-0023](openspec/decisions/0023-logs-carry-shape-not-values.md)). The app opens no log file and sends
  nothing anywhere: redirect the stream where you want it.

## Architecture (two thin layers)

```
 frontend/   the SPA (setup, reports, cards,     — talks only to the bridge
             transactions, performance, family)
 bridge/     Python API over lens.py            — per-entity store reads, aggregation, family.toml
             └─ + a closed set of side-effecting hand-offs to WLC (verb runs, upload, config writes)
```

The stores are encrypted DuckDB files; their keys never reach a browser. The bridge opens each store
**read-only** (no endpoint writes a store) with the same workspace resolution WLC itself uses; the
side-effecting endpoints hand off to WLC verbs or write WLW's own manifest — see
[`bridge-api`](openspec/specs/bridge-api/spec.md).

## Governance

Same model as WLC: governed behavior lands as an [OpenSpec change](openspec/project.md) first;
architecturally significant choices are [ADRs](openspec/decisions/). Same license (MIT). Start with
[ARCHITECTURE.md](ARCHITECTURE.md).

## Status

> **Parked TODOs (2026-09-05), pending Krishnu's feedback on the latest build:** the web half of the adoption
> review — a per-PR test gate with hooks and branch protection, daily-CI failure alerting, an add-a-member
> flow, a `gaps` summary on Operations, and a one-command update for household boxes. The list with detail
> lives in WealthLens-core's `openspec/ROADMAP.md` → "Loose TODOs" → "Parked until Krishnu…".

**Runs natively** — `python bootstrap.py` (Python 3.11/3.12), no Docker required. A container for the
always-on family-aggregator deployment is designed but deliberately deferred until real usage says what
belongs in it ([ADR-0009](openspec/decisions/0009-distribution-and-deployment.md)).

**The SPA has shipped.** A running React + Vite + TypeScript app
([ADR-0003](openspec/decisions/0003-frontend-stack.md)) over a Python bridge, with eleven tabs —
Overview, Reports, Cards, Bill payments, Performance, Family, Transactions, Import, Operations,
Workspace and Activity — served by two-dozen-plus read-only bridge routes. Reports are **sectioned** by
asset class with a shared **Columns picker** (the household's column choice is saved once and applies to
every report); each holding drills down into its **event diary**; the Transactions tab renders the bank
ledger; and Performance totals, shares and freshness are computed in the bridge. Cards and Bill payments
expose the card statements and bill-payment history.

**First reviewers wanted.** [UX.md](openspec/UX.md) still carries open questions — where the as-of date
belongs, how much of the machinery a non-technical household member should ever see. Opinions from people
who actually keep a household's books are worth more here than more design from us.
