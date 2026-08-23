/**
 * Small, dependency-free SVG charts. The app ships no charting library — these are hand-rolled so a chart is
 * a few tens of lines of SVG, themeable through the same CSS variables as everything else, and printable.
 * Colours come from a fixed palette indexed by slot, so a bucket keeps its colour across both charts.
 */
import { type Band, compactINR, type Slice } from "../lib/chart";

/** A donut of value by bucket, with the total in the middle and a legend beside it. */
export function DonutChart({ slices, centerLabel }: { slices: readonly Slice[]; centerLabel: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const r = 70;
  const c = 2 * Math.PI * r;
  // cumulative offset per slice, computed without mutation (n is a handful of buckets)
  const segs = slices.map((s, i) => ({
    ...s,
    len: (s.value / total) * c,
    offset: slices.slice(0, i).reduce((a, x) => a + (x.value / total) * c, 0),
  }));
  return (
    <div className="chart-donut">
      <svg viewBox="0 0 180 180" role="img" aria-label={centerLabel} width="180" height="180">
        <g transform="translate(90,90) rotate(-90)">
          {segs.map((s) => (
            <circle
              key={s.label}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth="26"
              strokeDasharray={`${s.len} ${c - s.len}`}
              strokeDashoffset={-s.offset}
            />
          ))}
        </g>
        <text x="90" y="86" textAnchor="middle" className="chart-donut-total">
          {compactINR(total)}
        </text>
        <text x="90" y="102" textAnchor="middle" className="chart-donut-caption">
          {centerLabel}
        </text>
      </svg>
      <ul className="chart-legend">
        {slices.map((s) => (
          <li key={s.label}>
            <span className="chart-swatch" style={{ background: s.color }} />
            <span className="chart-legend-label">{s.label}</span>
            <span className="chart-legend-value">
              {compactINR(s.value)} · {Math.round((100 * s.value) / total)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A stacked-area chart of value over time — each band a bucket, the stack the portfolio. */
export function StackedAreaChart({
  dates,
  bands,
  formatDate,
}: {
  readonly dates: readonly string[];
  readonly bands: readonly Band[];
  readonly formatDate: (iso: string) => string;
}) {
  const W = 720;
  const H = 260;
  const padL = 8;
  const padR = 8;
  const padT = 12;
  const padB = 22;
  const n = dates.length;
  // running totals per date (top of the stack) to scale Y
  const tops = dates.map((_, i) => bands.reduce((s, b) => s + (b.values[i] ?? 0), 0));
  const maxY = Math.max(1, ...tops);
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
  const y = (v: number) => padT + (1 - v / maxY) * (H - padT - padB);

  // Build each band's polygon from its lower edge (sum of the bands below it) up and back along its top —
  // computed without mutation (a handful of bands over a few dozen months).
  const polys = bands.map((b, bi) => {
    const lower = dates.map((_, i) => bands.slice(0, bi).reduce((a, bb) => a + (bb.values[i] ?? 0), 0));
    const upper = dates.map((_, i) => (lower[i] ?? 0) + (b.values[i] ?? 0));
    const top = dates.map((_, i) => `${x(i)},${y(upper[i] ?? 0)}`).join(" ");
    const bottom = dates.map((_, i) => `${x(n - 1 - i)},${y(lower[n - 1 - i] ?? 0)}`).join(" ");
    return { label: b.label, color: b.color, points: `${top} ${bottom}` };
  });

  const ticks = [0, 0.5, 1].map((f) => f * maxY);
  const xLabels = n <= 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];

  return (
    <div className="chart-area">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Value over time" preserveAspectRatio="none">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} y1={y(t)} x2={W - padR} y2={y(t)} className="chart-grid" />
            <text x={padL + 2} y={y(t) - 3} className="chart-tick">
              {compactINR(t)}
            </text>
          </g>
        ))}
        {polys.map((p) => (
          <polygon key={p.label} points={p.points} fill={p.color} fillOpacity="0.85" />
        ))}
        {xLabels.map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className="chart-tick">
            {formatDate(dates[i]!)}
          </text>
        ))}
      </svg>
    </div>
  );
}
