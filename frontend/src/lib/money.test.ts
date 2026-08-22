import { describe, expect, it } from "vitest";

import { formatMoney, isIdentified, NO_IDENTIFIER, sumMoney } from "./money";

describe("sumMoney", () => {
  it("adds within one currency", () => {
    const got = sumMoney([
      { amount: 100, currency: "INR" },
      { amount: 250.5, currency: "INR" },
    ]);
    expect(got).toEqual({ kind: "sum", total: { amount: 350.5, currency: "INR" } });
  });

  it("refuses to add across currencies instead of silently producing a number", () => {
    const got = sumMoney([
      { amount: 100, currency: "INR" },
      { amount: 100, currency: "USD" },
    ]);
    expect(got.kind).toBe("unsummable");
    expect(got).toMatchObject({ currencies: ["INR", "USD"] });
  });

  it("distinguishes an empty set from a zero total", () => {
    // "nothing to add" and "adds to zero" are different facts, and a view must be able to say which.
    expect(sumMoney([])).toEqual({ kind: "empty" });
    expect(sumMoney([{ amount: 0, currency: "INR" }])).toEqual({
      kind: "sum",
      total: { amount: 0, currency: "INR" },
    });
  });
});

describe("formatMoney", () => {
  it("groups by the locale, not by a developer's assumption", () => {
    const inLakhs = formatMoney({ amount: 100000, currency: "INR" }, "en-IN");
    const inThousands = formatMoney({ amount: 100000, currency: "INR" }, "en-US");
    expect(inLakhs).toContain("1,00,000");
    expect(inThousands).toContain("100,000");
  });

  it("keeps the currency attached to the amount", () => {
    expect(formatMoney({ amount: 5, currency: "USD" }, "en-US")).toContain("$");
    expect(formatMoney({ amount: 5, currency: "GBP" }, "en-GB")).toContain("£");
  });
});

describe("identifiers", () => {
  it("states 'no identifier' rather than leaving it blank", () => {
    expect(isIdentified(NO_IDENTIFIER)).toBe(false);
    expect(isIdentified("")).toBe(false);
    expect(isIdentified("INE000000000")).toBe(true);
  });
});
