import { useEffect, useMemo, useState } from "react";

import { api, type Performance as PerformanceData } from "../api/client";
import { DonutChart, StackedAreaChart } from "../components/charts";
import { type Band, PALETTE, type Slice } from "../lib/chart";
import type { Formatter, MessageKey } from "../i18n";

/**
 * Portfolio performance — two charts, no numbers computed here.
 *
 * The breakup (a donut) is the current value by asset class, straight from net worth; the growth chart (a
 * stacked area) is the same valuation walked back month by month. Both arrive decided from the bridge; this
 * buckets them into friendly names, assigns each type a stable colour, and draws.
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
  const { t } = format;
  const [perf, setPerf] = useState<Load<PerformanceData>>({ state: "loading" });

  useEffect(() => {
    void api
      .performance()
      .then((data) => setPerf({ state: "ready", data }))
      .catch(() => setPerf({ state: "error" }));
  }, []);

  const label = (key: string) => t(`class.${key}` as MessageKey);

  // The breakup: positive asset buckets only (a donut of what's owned, not net of liabilities).
  const slices = useMemo<Slice[]>(() => {
    if (perf.state !== "ready") return [];
    return perf.data.breakup
      .map((b) => ({ key: b.asset_class, value: Number(b.value.amount) }))
      .filter((b) => b.value > 0)
      .map((b) => ({ label: label(b.key), value: b.value, color: colorFor(b.key) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perf, t]);

  // The growth chart: value per type over time, real estate excluded, stacked in BUCKETS order.
  const { dates, bands, months } = useMemo(() => {
    if (perf.state !== "ready") return { dates: [] as string[], bands: [] as Band[], months: 0 };
    const ds = [...new Set(perf.data.series.map((p) => p.date).filter((d): d is string => !!d))].sort();
    const at = new Map<string, number>();
    for (const p of perf.data.series) if (p.date) at.set(`${p.asset_class}|${p.date}`, Number(p.value.amount));
    const present = BUCKETS.filter(
      (k) => k !== "real_estate" && perf.data.series.some((p) => p.asset_class === k),
    );
    const built: Band[] = present.map((k) => ({
      label: label(k),
      color: colorFor(k),
      values: ds.map((d) => at.get(`${k}|${d}`) ?? 0),
    }));
    return { dates: ds, bands: built, months: ds.length };
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
        <DonutChart slices={slices} centerLabel={t("perf.total")} />
      </section>

      {bands.length > 0 ? (
        <section className="perf-card">
          <h2>{t("perf.growthTitle")}</h2>
          <p className="cards-subtitle">{t("perf.growthCaption", { months })}</p>
          <StackedAreaChart dates={dates} bands={bands} formatDate={monthLabel} />
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
