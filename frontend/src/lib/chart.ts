/** Shared chart constants & helpers, kept out of the component file so fast-refresh stays happy. */

/** The bucket palette — distinct, theme-neutral hues. A bucket's colour is its index here. */
export const PALETTE = [
  "#0f6b62", "#c9822b", "#3d6ea5", "#8a5a9c", "#4f9d69", "#b0453a", "#5c6a68", "#c2a83e",
] as const;

/** ₹ compacted for an axis or a slice label: 4.66Cr / 3.20L / 900. */
export function compactINR(value: number): string {
  const a = Math.abs(value);
  if (a >= 1e7) return `₹${(value / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `₹${(value / 1e5).toFixed(2)}L`;
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

export type Slice = { label: string; value: number; color: string };
export type Band = { label: string; color: string; values: readonly number[] };
