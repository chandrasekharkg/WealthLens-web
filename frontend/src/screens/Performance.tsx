import { useEffect, useMemo, useState } from "react";

import { api, type Performance as PerformanceData } from "../api/client";
import { DonutChart, StackedAreaChart } from "../components/charts";
import { type Band, compact, PALETTE, type Slice, type Tick } from "../lib/chart";
import type { Formatter, MessageKey } from "../i18n";

/**
 * Portfolio performance — two charts, no money computed here.
 *
 * The breakup (a donut) is the current value by asset class, straight from net worth; the growth chart (a
 * stacked area) is the same valuation walked back month by month. Every figure — the total, each share, the
 * axis labels and the stack edges — arrives decided from the bridge (core/aggregate.performance). This maps
 * those to render shapes (a share to an arc, a Money to a fraction of the axis) and assigns each type a
 * stable colour; it never sums or converts money.
 *
 * The asset-class vocabulary — the labels, and the ORDER a colour is assigned by — is the engine's, published
 * on the payload (`classes`), so this screen keeps no list of its own (finding B3: the list was triplicated,
 * and an engine that added a class silently fell out of the chart). The growth chart's `omitted` classes and
 * any excluded store arrive named, so the top-line reconciles with the donut and nothing vanishes silently.
 */

type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error" };

/** "2026-08-31" → "Aug '26". */
function monthLabel(iso: string): string {
  const [y, m] = iso.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(m) - 1] ?? m} '${(y ?? "").slice(2)}`;
}

export type PerformanceProps = {
  readonly format: Formatter;
};

export function Performance({ format }: PerformanceProps) {
  const { t, money } = format;
  const [perf, setPerf] = useState<Load<PerformanceData>>({ state: "loading" });

  useEffect(() => {
    void api
      .performance()
      .then((data) => setPerf({ state: "ready", data }))
      .catch(() => setPerf({ state: "error" }));
  }, []);

  const data = perf.state === "ready" ? perf.data : null;

  // The engine's vocabulary drives both colour and label. A class's colour is its published `order` (so a
  // type keeps its colour across both charts and across the app); a class outside the published list still
  // gets a stable, distinct-ish colour (hashed into the palette) rather than sharing the first.
  const classInfo = useMemo(() => {
    const byKey = new Map((data?.classes ?? []).map((c) => [c.asset_class, c]));
    const colorFor = (key: string): string => {
      const order = byKey.get(key)?.order;
      if (order != null) return PALETTE[order % PALETTE.length] ?? PALETTE[0];
      let h = 0;
      for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      return PALETTE[h % PALETTE.length] ?? PALETTE[0];
    };
    // i18n label first (curated / translatable); fall back to the engine's own label, then the raw code.
    const label = (key: string): string => {
      const k = `class.${key}` as MessageKey;
      const translated = t(k);
      if (translated !== k) return translated;
      return byKey.get(key)?.label ?? key;
    };
    return { colorFor, label };
  }, [data, t]);
  const { colorFor, label } = classInfo;

  // The breakup: positive asset buckets only (a donut of what's owned, not net of liabilities). Value and
  // share come from the bridge; this only names, colours, and formats.
  const slices = useMemo<Slice[]>(() => {
    if (!data) return [];
    return data.breakup
      .filter((b) => b.share > 0)
      .map((b) => ({ label: label(b.asset_class), color: colorFor(b.asset_class),
                     share: b.share, valueText: money(b.value) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perf, t]);

  const centerValue = data && data.total ? money(data.total) : "—";

  // The growth chart: the bridge pre-summed the stack (each point carries its base/top), so this only maps
  // those Money edges to fractions of the axis maximum. No values are added here.
  const { bands, dateLabels, ticks, months } = useMemo(() => {
    const empty = { bands: [] as Band[], dateLabels: [] as string[], ticks: [] as Tick[], months: 0 };
    if (!data || !data.axis_max) return empty;
    const max = Number(data.axis_max.amount) || 1;
    const series = data.series;
    const dates = [...new Set(series.map((p) => p.date).filter((d): d is string => !!d))].sort();
    // Class order = first appearance in the series, which the bridge emits in stack order.
    const classes = [...new Set(series.map((p) => p.asset_class))];
    const at = new Map(series.filter((p) => p.date).map((p) => [`${p.asset_class}|${p.date}`, p]));
    const built: Band[] = classes.map((k) => ({
      label: label(k),
      color: colorFor(k),
      edges: dates.map((d) => {
        const p = at.get(`${k}|${d}`);
        return { base: p?.base ? Number(p.base.amount) / max : 0, top: p?.top ? Number(p.top.amount) / max : 0 };
      }),
    }));
    const built_ticks: Tick[] = data.axis_ticks.map((m) => ({
      frac: Number(m.amount) / max,
      label: compact(Number(m.amount), data.reporting_currency),
    }));
    return { bands: built, dateLabels: dates.map(monthLabel), ticks: built_ticks, months: dates.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perf, t]);

  if (perf.state === "loading") return <p role="status">…</p>;
  if (perf.state === "error") return <p role="alert">{t("error.load")}</p>;
  if (!data || slices.length === 0) return <p>{t("perf.none")}</p>;

  const excluded = data.excluded ?? [];

  return (
    <main className="performance">
      <h1>{t("perf.pageTitle")}</h1>

      {data.is_partial ? (
        // B2: a store that could not be read is NAMED — the charts say they are partial rather than being
        // silently smaller. The same honesty the total and every row set carry.
        <p className="perf-partial" data-tone="warning" role="status">
          {t("perf.partial")}
          {excluded.length > 0 ? ` ${excluded.map((e) => e.label).join(", ")}.` : ""}
        </p>
      ) : null}

      <section className="perf-card">
        <h2>{t("perf.breakupTitle")}</h2>
        <p className="cards-subtitle">{t("perf.breakupCaption")}</p>
        <DonutChart slices={slices} centerValue={centerValue} centerLabel={t("perf.total")} />
      </section>

      {bands.length > 0 ? (
        <section className="perf-card">
          <h2>{t("perf.growthTitle")}</h2>
          <p className="cards-subtitle">{t("perf.growthCaption", { months })}</p>
          <StackedAreaChart dateLabels={dateLabels} bands={bands} ticks={ticks} />
          <ul className="chart-legend chart-legend-row">
            {bands.map((b) => (
              <li key={b.label}>
                <span className="chart-swatch" style={{ background: b.color }} />
                <span className="chart-legend-label">{b.label}</span>
              </li>
            ))}
          </ul>
          {data.omitted.length > 0 ? (
            // B1: the growth top-line leaves these classes out (real estate &c.) — say so, with each value,
            // so the reader can see it still reconciles with the donut rather than silently disagreeing.
            <p className="chart-note" role="note">
              {t("perf.growthExcludes")}{" "}
              {data.omitted
                .map((o) => `${label(o.asset_class)} (${money(o.value)})`)
                .join(", ")}
              .
            </p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
