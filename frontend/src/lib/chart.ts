/** Shared chart constants & helpers, kept out of the component file so fast-refresh stays happy. */

/** The bucket palette — distinct, theme-neutral hues. A bucket's colour is its index here. */
export const PALETTE = [
  "#0f6b62", "#c9822b", "#3d6ea5", "#8a5a9c", "#4f9d69", "#b0453a", "#5c6a68", "#c2a83e",
] as const;

/**
 * A money value compacted for an axis or a slice label. INR keeps the lakh/crore idiom (₹4.66Cr / ₹3.20L);
 * any other currency uses the locale's own compact notation (`$1.2M`, `€3.4K`). The currency is passed in —
 * this formats a value the bridge already decided the currency of, it does not assume rupees.
 */
export function compact(value: number, currency = "INR"): string {
  if (currency === "INR") {
    const a = Math.abs(value);
    if (a >= 1e7) return `₹${(value / 1e7).toFixed(2)}Cr`;
    if (a >= 1e5) return `₹${(value / 1e5).toFixed(2)}L`;
    return `₹${Math.round(value).toLocaleString("en-IN")}`;
  }
  return new Intl.NumberFormat(undefined, {
    style: "currency", currency, notation: "compact", maximumFractionDigits: 2,
  }).format(value);
}

// The charts are pure renderers: every money figure they show (the total, each share, the axis labels, the
// stack edges) is decided by the bridge and arrives here already summed and formatted. These shapes carry
// only what a shape needs to be DRAWN — a fraction to position, a ready string to print — never a Money to
// add. See core/aggregate.performance and the "compute in core/" rule (AGENTS.md).

/** One donut slice: its share drives the arc, its ready-formatted value drives the legend. */
export type Slice = { label: string; color: string; share: number; valueText: string };

/** One stacked band: per date, the floor and ceiling as fractions (0–1) of the axis maximum. */
export type Band = { label: string; color: string; edges: readonly { base: number; top: number }[] };

/** One Y-axis gridline: where to draw it (0–1) and the money label to print (already formatted). */
export type Tick = { frac: number; label: string };
