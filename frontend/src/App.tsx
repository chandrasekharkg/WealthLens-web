import { useCallback, useEffect, useState } from "react";

import { api, ApiError, type NetWorth, type Version } from "./api/client";
import { defaultFormatter } from "./i18n";
import { Import } from "./screens/Import";
import { Activity } from "./screens/Activity";
import { Operations } from "./screens/Operations";
import { Overview } from "./screens/Overview";
import { Reports } from "./screens/Reports";
import { Workspace } from "./screens/Workspace";

/**
 * The shell.
 *
 * Its only real job is the one the cold-start spec insists on: **a missing or unusable engine is a state
 * this app renders, not a blank page**. That check comes before anything tries to read a store, because
 * every other screen assumes there is an engine to read with.
 */

type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error"; error: unknown };

export function App() {
  const { t } = defaultFormatter;
  const [version, setVersion] = useState<Load<Version>>({ state: "loading" });
  const [netWorth, setNetWorth] = useState<Load<NetWorth>>({ state: "loading" });
  const [screen, setScreen] = useState<"overview" | "reports" | "import" | "operations" | "workspace" | "activity">("overview");

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

  return (
    <>
      <nav aria-label={t("app.name")} data-print="hide">
        <button type="button" onClick={() => setScreen("overview")} aria-current={screen === "overview"}>
          {t("nav.overview")}
        </button>
        <button type="button" onClick={() => setScreen("reports")} aria-current={screen === "reports"}>
          {t("nav.reports")}
        </button>
        <button type="button" onClick={() => setScreen("import")} aria-current={screen === "import"}>
          {t("nav.import")}
        </button>
        <button
          type="button"
          onClick={() => setScreen("operations")}
          aria-current={screen === "operations"}
        >
          {t("nav.operations")}
        </button>
        <button
          type="button"
          onClick={() => setScreen("workspace")}
          aria-current={screen === "workspace"}
        >
          {t("nav.workspace")}
        </button>
        <button
          type="button"
          onClick={() => setScreen("activity")}
          aria-current={screen === "activity"}
        >
          {t("nav.activity")}
        </button>
      </nav>

      {screen === "overview" && <Overview data={netWorth.data} format={defaultFormatter} />}
      {screen === "reports" && <Reports format={defaultFormatter} />}
      {screen === "import" && (
        <Import entities={entities} format={defaultFormatter} onImported={refresh} />
      )}
      {screen === "workspace" && <Workspace entities={entities} format={defaultFormatter} />}
      {screen === "activity" && <Activity format={defaultFormatter} />}
      {screen === "operations" && (
        <Operations
          entities={netWorth.data.entities}
          format={defaultFormatter}
          onPromoted={refresh}
        />
      )}
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
