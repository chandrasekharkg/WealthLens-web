import { useCallback, useEffect, useState } from "react";

import { api, ApiError, type NetWorth, type ReportSummary, type Version } from "./api/client";
import { SideRail } from "./components/SideRail";
import { defaultFormatter, type MessageKey } from "./i18n";
import { Import } from "./screens/Import";
import { Activity } from "./screens/Activity";
import { Operations } from "./screens/Operations";
import { Overview } from "./screens/Overview";
import { Reports } from "./screens/Reports";
import { Cards } from "./screens/Cards";
import { Payments } from "./screens/Payments";
import { Performance } from "./screens/Performance";
import { Family } from "./screens/Family";
import { Transactions } from "./screens/Transactions";
import { Workspace } from "./screens/Workspace";
import { RawParse } from "./screens/RawParse";

/**
 * The shell.
 *
 * Its only real job is the one the cold-start spec insists on: **a missing or unusable engine is a state
 * this app renders, not a blank page**. That check comes before anything tries to read a store, because
 * every other screen assumes there is an engine to read with.
 */

type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error"; error: unknown };

type Screen = "overview" | "reports" | "cards" | "payments" | "performance" | "family" | "transactions" | "import" | "operations" | "workspace" | "activity" | "rawparse";

// The tab strip as data. The MONEY tabs are the top strip; the operator/plumbing screens live under one
// "Operation Detail" group tab that reveals its own sub-strip — so the top nav is the money, not the machinery.
type Tab = { readonly id: Screen; readonly key: MessageKey };
const MONEY_TABS: readonly Tab[] = [
  { id: "overview", key: "nav.overview" },
  { id: "reports", key: "nav.reports" },
  { id: "cards", key: "nav.cards" },
  { id: "payments", key: "nav.payments" },
  { id: "performance", key: "nav.performance" },
  { id: "family", key: "nav.family" },
  { id: "transactions", key: "nav.transactions" },
  { id: "workspace", key: "nav.workspace" },
];
const OPS_TABS: readonly Tab[] = [
  { id: "rawparse", key: "nav.rawparse" },
  { id: "import", key: "nav.import" },
  { id: "operations", key: "nav.operations" },
  { id: "activity", key: "nav.activity" },
];
const OPS_IDS = new Set<Screen>(OPS_TABS.map((tab) => tab.id));
const OPS_DEFAULT: Screen = "rawparse"; // where "Operation Detail" lands when entered from a money tab
const ALL_TABS: readonly Tab[] = [...MONEY_TABS, ...OPS_TABS];

/** A lens over a rising line — the app's own subject, at 24px. */
function Logo() {
  return (
    <svg viewBox="0 0 24 24" className="logo" aria-hidden="true" focusable="false">
      <rect width="24" height="24" rx="7" fill="currentColor" />
      <circle cx="10.5" cy="10.5" r="5.5" fill="none" stroke="#fff" strokeWidth="1.9" />
      <path
        d="M8 12 L10 9.4 L13 12"
        fill="none"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M14.7 14.7 L18.6 18.6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function App() {
  const { t } = defaultFormatter;
  const [version, setVersion] = useState<Load<Version>>({ state: "loading" });
  const [netWorth, setNetWorth] = useState<Load<NetWorth>>({ state: "loading" });
  // A ?holding=… deep-link lives on Reports (the diary opens there), so land there when one is present —
  // otherwise the link would open Overview and the diary would never mount. Read once, as an initializer.
  const [screen, setScreen] = useState<Screen>(() =>
    new URLSearchParams(window.location.search).get("holding") ? "reports" : "overview",
  );
  const [railOpen, setRailOpen] = useState(true);

  /**
   * The report catalogue lives HERE, not in the Reports screen, because the rail that lists it belongs to
   * the shell. A screen pushing its navigation up into its parent would be a render-loop waiting to happen;
   * owning the selection here makes Reports a plain controlled view.
   *
   * It is fetched on first visit rather than at launch: it is static and opens no store, but a household on
   * Overview should not pay a request for a tab it has not opened.
   */
  const [catalogue, setCatalogue] = useState<ReportSummary[]>([]);
  const [reportId, setReportId] = useState("accounts");
  const wantCatalogue = screen === "reports" && catalogue.length === 0;
  useEffect(() => {
    if (!wantCatalogue) return;
    void api
      .reports()
      .then(setCatalogue)
      .catch(() => setCatalogue([]));
  }, [wantCatalogue]);

  // The fetch itself sets state only from its callbacks — never synchronously in the effect body, which
  // would cascade a render on every mount for no benefit. The initial "loading" is the initial STATE.
  const fetchAll = useCallback(async () => {
    try {
      const found = await api.version();
      setVersion({ state: "ready", data: found });
      if (found.engine.present && found.engine.schema_version) {
        setNetWorth({ state: "ready", data: await api.netWorth() });
      }
    } catch (error: unknown) {
      setVersion((prev) => (prev.state === "ready" ? prev : { state: "error", error }));
      setNetWorth({ state: "error", error });
    }
  }, []);


  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  /**
   * Re-read the figures WITHOUT clearing what is on screen.
   *
   * A successful import must not unmount the screen showing its verdict — which is exactly what happened
   * when this reused the retry path: the loading state replaced the app, the Import screen remounted, and
   * the per-file verdict the user needed to read disappeared at the moment it mattered most.
   */
  const refresh = useCallback(() => {
    void api
      .netWorth()
      .then((data) => setNetWorth({ state: "ready", data }))
      .catch(() => undefined);
  }, []);

  const retry = useCallback(() => {
    setVersion({ state: "loading" });
    setNetWorth({ state: "loading" });
    void fetchAll();
  }, [fetchAll]);

  if (version.state === "loading") return <p role="status">…</p>;

  if (version.state === "error") return <Failure error={version.error} onRetry={retry} />;

  // Preflight, at every launch rather than once at install: a household can upgrade the engine on its own,
  // move a folder, or run on a machine somebody else set up (cold-start spec).
  const engine = version.data.engine;
  if (!engine.present || !engine.schema_version) {
    return (
      <main>
        <h1>{t("app.name")}</h1>
        <p role="alert">{t("engine.missing")}</p>
        {engine.detail ? <p>{t("engine.detail", { detail: engine.detail })}</p> : null}
      </main>
    );
  }

  if (netWorth.state === "error") return <Failure error={netWorth.error} onRetry={retry} />;
  if (netWorth.state === "loading") return <p role="status">…</p>;

  const entities = netWorth.data.entities.map((e) => ({
    id: e.entity_id,
    label: e.label,
    available: e.contributes,
  }));

  // Today only Reports has choices within a tab. The rail is the place the next ones go — a member picker
  // on Import and Operations, a drill-down trail under a report — rather than a second layout each time.
  const railItems =
    screen === "reports"
      ? catalogue.map((entry) => ({
          id: entry.id,
          label: entry.title,
          current: entry.id === reportId,
          onPick: () => setReportId(entry.id),
        }))
      : [];

  return (
    <>
      <header className="topbar" data-print="hide">
        <div className="brand">
          <Logo />
          <span>{t("app.name")}</span>
        </div>
        <nav className="tabs" aria-label={t("app.name")}>
          {MONEY_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setScreen(tab.id)}
              aria-current={screen === tab.id}
            >
              {t(tab.key)}
            </button>
          ))}
          <button
            type="button"
            className="tab-group"
            onClick={() => {
              if (!OPS_IDS.has(screen)) setScreen(OPS_DEFAULT);
            }}
            aria-current={OPS_IDS.has(screen)}
          >
            {t("nav.operationDetail")} ▾
          </button>
        </nav>
      </header>

      {OPS_IDS.has(screen) && (
        <nav className="subtabs" aria-label={t("nav.operationDetail")}>
          {OPS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setScreen(tab.id)}
              aria-current={screen === tab.id}
            >
              {t(tab.key)}
            </button>
          ))}
        </nav>
      )}

      <div className="shell">
        <SideRail
          heading={t(ALL_TABS.find((tab) => tab.id === screen)?.key ?? "nav.overview")}
          items={railItems}
          open={railOpen}
          onToggle={() => setRailOpen((was) => !was)}
          labels={{ collapse: t("rail.collapse"), expand: t("rail.expand") }}
        />

        {screen === "overview" && <Overview data={netWorth.data} format={defaultFormatter} />}
        {screen === "reports" && <Reports reportId={reportId} format={defaultFormatter} />}
        {screen === "cards" && <Cards format={defaultFormatter} />}
        {screen === "payments" && <Payments format={defaultFormatter} />}
        {screen === "performance" && <Performance format={defaultFormatter} />}
        {screen === "family" && <Family format={defaultFormatter} />}
        {screen === "transactions" && <Transactions format={defaultFormatter} />}
        {screen === "import" && (
          <Import entities={entities} format={defaultFormatter} onImported={refresh} />
        )}
        {screen === "workspace" && <Workspace entities={entities} format={defaultFormatter} />}
        {screen === "rawparse" && <RawParse entities={entities} />}
        {screen === "activity" && <Activity format={defaultFormatter} />}
        {screen === "operations" && (
          <Operations
            entities={netWorth.data.entities}
            format={defaultFormatter}
            onPromoted={refresh}
          />
        )}
      </div>
    </>
  );
}

function Failure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = defaultFormatter;
  // A failure names its cause where one is known. "Something went wrong" is not an error message.
  const detail =
    error instanceof ApiError && typeof error.detail === "object" && error.detail !== null
      ? String((error.detail as { detail?: { reason?: string } }).detail?.reason ?? "")
      : "";
  return (
    <main>
      <p role="alert">{t("error.load")}</p>
      {detail ? <p>{detail}</p> : null}
      <button type="button" onClick={onRetry}>
        {t("error.retry")}
      </button>
    </main>
  );
}
