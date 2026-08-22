/**
 * Translation and locale-aware formatting.
 *
 * The formatting half matters as much as the words. Grouping, decimals and date order come from the
 * ACTIVE LOCALE, never from a developer's assumption — `en-IN` groups by lakh and crore, `en-US` by
 * thousand, and neither is written anywhere in this file.
 */
import { en, type MessageKey } from "./en";

export type { MessageKey };

export type Catalog = Record<MessageKey, string>;

export const catalogs: Record<string, Catalog> = { en };

/** A money amount as the bridge sends it: an exact decimal string, never a JSON number. */
export type MoneyValue = { readonly amount: string; readonly currency: string };

export type Formatter = {
  readonly locale: string;
  readonly t: (key: MessageKey, params?: Record<string, string | number>) => string;
  readonly money: (value: MoneyValue) => string;
  readonly date: (iso: string | null | undefined) => string;
  readonly number: (value: number) => string;
};

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in params ? String(params[key]) : whole,
  );
}

export function formatter(locale = "en-IN", catalog: Catalog = en): Formatter {
  return {
    locale,
    t: (key, params) => interpolate(catalog[key] ?? en[key] ?? key, params),

    /**
     * The amount is formatted from its STRING, which `Intl` accepts. Converting to a number first would
     * put a household's net worth through an IEEE double and undo the exact decimal the store keeps and
     * the bridge deliberately sends as text.
     */
    money: ({ amount, currency }) =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        currencyDisplay: "narrowSymbol",
      }).format(amount as unknown as number),

    date: (iso) => {
      if (!iso) return "—";
      const parsed = new Date(`${iso}T00:00:00Z`);
      return Number.isNaN(parsed.getTime())
        ? iso
        : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(parsed);
    },

    number: (value) => new Intl.NumberFormat(locale).format(value),
  };
}

export const defaultFormatter = formatter();
