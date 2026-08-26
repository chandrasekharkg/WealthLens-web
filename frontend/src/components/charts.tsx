/**
 * Small, dependency-free SVG charts. The app ships no charting library — these are hand-rolled so a chart is
 * a few tens of lines of SVG, themeable through the same CSS variables as everything else, and printable.
 *
 * They are PURE RENDERERS. Every money figure they show — the donut total, each slice's share, the axis
 * labels, the stack edges — is computed by the bridge (core/aggregate.performance) and arrives already
 * summed and formatted. Nothing here adds, divides, or scales money; a share positions an arc, a fraction
 * positions a band, a ready string is printed. See the "compute in core/" rule (AGENTS.md).
 */
import type { Band, Slice, Tick } from "../lib/chart";

/** A donut of value by bucket, with the (bridge-computed) total in the middle and a legend beside it. */
export function DonutChart({
  slices,
  centerValue,
  centerLabel,
}: {
  readonly slices: readonly Slice[];
  readonly centerValue: string;
  readonly centerLabel: string;
}) {
  const r = 70;
  const c = 2 * Math.PI * r;
  // Each arc is sized and offset by its SHARE (a ratio the bridge already computed) — no money is summed.
  const segs = slices.map((s, i) => ({
    ...s,
    len: (s.share / 100) * c,
    offset: slices.slice(0, i).reduce((a, x) => a + (x.share / 100) * c, 0),
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
          {centerValue}
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
              {s.valueText} · {Math.round(s.share)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A stacked-area chart of value over time — each band a bucket, the stack the portfolio. The bands' floors
 * and ceilings arrive as fractions (0–1) of the axis maximum (the bridge pre-summed the stack), and the
 * ticks carry both a position and a ready money label — so this only maps fractions to pixels.
 */
export function StackedAreaChart({
  dateLabels,
  bands,
  ticks,
}: {
  readonly dateLabels: readonly string[];
  readonly bands: readonly Band[];
  readonly ticks: readonly Tick[];
}) {
  const W = 720;
  const H = 260;
  const padL = 8;
  const padR = 8;
  const padT = 12;
  const padB = 22;
  const n = dateLabels.length;
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
  const y = (frac: number) => padT + (1 - frac) * (H - padT - padB);

  const polys = bands.map((b) => {
    const top = b.edges.map((e, i) => `${x(i)},${y(e.top)}`).join(" ");
    const bottom = b.edges.map((_e, i) => `${x(n - 1 - i)},${y(b.edges[n - 1 - i]?.base ?? 0)}`).join(" ");
    return { label: b.label, color: b.color, points: `${top} ${bottom}` };
  });

  const xLabels = n <= 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];
  // Position labels as PERCENTAGES of the box, so they ride an HTML overlay at real CSS pixel sizes rather
  // than SVG text stretched by preserveAspectRatio="none" — the axis stays crisp and the same size as the
  // donut's, at any width. Only the polygons and gridlines live in the (stretched) SVG.
  const pctX = (i: number) => `${(x(i) / W) * 100}%`;
  const pctY = (frac: number) => `${(y(frac) / H) * 100}%`;

  return (
    <div className="chart-area">
      <div className="chart-area-inner" style={{ aspectRatio: `${W} / ${H}` }}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Value over time" preserveAspectRatio="none">
          {ticks.map((t) => (
            <line key={t.label} x1={padL} y1={y(t.frac)} x2={W - padR} y2={y(t.frac)} className="chart-grid" />
          ))}
          {polys.map((p) => (
            <polygon key={p.label} points={p.points} fill={p.color} fillOpacity="0.85" />
          ))}
        </svg>
        {ticks.map((t) => (
          <span key={t.label} className="chart-tick chart-tick-y" style={{ top: pctY(t.frac), left: pctX(0) }}>
            {t.label}
          </span>
        ))}
        {xLabels.map((i) => (
          <span
            key={i}
            className="chart-tick chart-tick-x"
            data-align={i === 0 ? "start" : i === n - 1 ? "end" : "mid"}
            style={{ left: pctX(i) }}
          >
            {dateLabels[i]}
          </span>
        ))}
      </div>
    </div>
  );
}
