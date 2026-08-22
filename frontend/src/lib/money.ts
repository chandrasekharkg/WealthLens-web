/**
 * Money, per the data-conventions spec: an amount NEVER travels without its currency, and amounts of
 * differing currencies are never added. Both rules live here as types and functions so that no component
 * is ever in a position to break them — a bare number simply cannot be passed where Money is expected.
 */

export type Money = {
  readonly amount: number;
  readonly currency: string; // ISO 4217, e.g. "INR", "USD"
};

/**
 * The result of summing a set. Mixed currencies are reported as unsummable rather than silently added —
 * the caller decides how to say so, but cannot accidentally get a number (data-conventions).
 */
export type SumResult =
  | { readonly kind: "sum"; readonly total: Money }
  | { readonly kind: "empty" }
  | { readonly kind: "unsummable"; readonly currencies: readonly string[] };

export function sumMoney(items: readonly Money[]): SumResult {
  if (items.length === 0) return { kind: "empty" };
  const currencies = [...new Set(items.map((m) => m.currency))].sort();
  if (currencies.length > 1) return { kind: "unsummable", currencies };
  const currency = currencies[0]!;
  return {
    kind: "sum",
    total: { amount: items.reduce((a, m) => a + m.amount, 0), currency },
  };
}

/**
 * Format for display. Grouping and decimals come from the LOCALE, never from a developer's assumption —
 * `en-IN` groups by lakh/crore, `en-US` by thousand, and neither is hardcoded here.
 */
export function formatMoney(m: Money, locale = "en-IN"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: m.currency,
    currencyDisplay: "narrowSymbol",
  }).format(m.amount);
}

/**
 * What a holding shows when it has no market identifier. A fixed deposit, a property, cash and
 * hand-recorded unlisted equity legitimately have no ISIN, and data-conventions requires that "no
 * identifier" be STATED rather than inferred from a blank — a filter must neither hide nor match it by
 * accident.
 */
export const NO_IDENTIFIER = Symbol("no-identifier");
export type Identifier = string | typeof NO_IDENTIFIER;

export function isIdentified(id: Identifier): id is string {
  return typeof id === "string" && id.length > 0;
}
