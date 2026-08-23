import { useEffect, useMemo, useState } from "react";

import { api, type Performance as PerformanceData } from "../api/client";
import { DonutChart, StackedAreaChart } from "../components/charts";
import { type Band, compactINR, PALETTE, type Slice, type Tick } from "../lib/chart";
import type { Formatter, MessageKey } from "../i18n";

/**
 * Portfolio performance — two charts, no money computed here.
 *
 * The breakup (a donut) is the current value by asset class, straight from net worth; the growth chart (a
 * stacked area) is the same valuation walked back month by month. Every figure — the total, each share, the
 * axis labels and the stack edges — arrives decided from the bridge (core/aggregate.performance). This maps
 * those to render shapes (a share to an arc, a Money to a fraction of the axis) and assigns each type a
 * stable colour; it never sums or converts money.
 */

type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error" };

// The known asset types, in a fixed order — this order is both the legend order and the colour assignment
// (a type keeps its colour across both charts). Real estate is last; the growth chart drops it.
const BUCKETS = [
  "mutual_fund", "listed_equity", "fixed_deposit", "savings", "bond", "unlisted_equity", "real_estate",
] as const;

const colorFor = (key: string): string => {
  const i = BUCKETS.indexOf(key as (typeof BUCKETS)[number]);
  return PALETTE[(i < 0 ? 0 : i) % PALETTE.length] ?? PALETTE[0];
};

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

  const label = (key: string) => t(`class.${key}` as MessageKey);

  // The breakup: positive asset buckets only (a donut of what's owned, not net of liabilities). Value and
  // share come from the bridge; this only names, colours, and formats.
  const slices = useMemo<Slice[]>(() => {
    if (perf.state !== "ready") return [];
    return perf.data.breakup
      .filter((b) => b.share > 0)
      .map((b) => ({ label: label(b.asset_class), color: colorFor(b.asset_class),
                     share: b.share, valueText: money(b.value) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perf, t]);

  const centerValue = perf.state === "ready" && perf.data.total ? money(perf.data.total) : "—";

  // The growth chart: the bridge pre-summed the stack (each point carries its base/top), so this only maps
  // those Money edges to fractions of the axis maximum. No values are added here.
  const { bands, dateLabels, ticks, months } = useMemo(() => {
    const empty = { bands: [] as Band[], dateLabels: [] as string[], ticks: [] as Tick[], months: 0 };
    if (perf.state !== "ready" || !perf.data.axis_max) return empty;
    const max = Number(perf.data.axis_max.amount) || 1;
    const series = perf.data.series;
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
    const built_ticks: Tick[] = perf.data.axis_ticks.map((m) => ({
      frac: Number(m.amount) / max,
      label: compactINR(Number(m.amount)),
    }));
    return { bands: built, dateLabels: dates.map(monthLabel), ticks: built_ticks, months: dates.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perf, t]);

  if (perf.state === "loading") return <p role="status">…</p>;
  if (perf.state === "error") return <p role="alert">{t("error.load")}</p>;
  if (slices.length === 0) return <p>{t("perf.none")}</p>;

  return (
    <main className="performance">
      <h1>{t("perf.pageTitle")}</h1>

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
        </section>
      ) : null}
    </main>
  );
}
