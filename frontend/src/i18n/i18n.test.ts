import { describe, expect, it } from "vitest";

import { en } from "./en";
import { type Catalog, formatter } from "./index";

describe("translation", () => {
  it("renders a new locale with no component changes", () => {
    // The point of a catalog: a translator hands us a file and nothing in the UI is touched.
    const hi: Catalog = { ...en, "overview.netWorth": "कुल संपत्ति" };
    expect(formatter("hi-IN", hi).t("overview.netWorth")).toBe("कुल संपत्ति");
  });

  it("falls back to the shipped English rather than showing a raw key", () => {
    const partial = { ...en } as Catalog;
    delete (partial as Record<string, string>)["overview.netWorth"];
    expect(formatter("xx", partial).t("overview.netWorth")).toBe(en["overview.netWorth"]);
  });

  it("interpolates named parameters", () => {
    expect(formatter().t("overview.partial", { count: 1, total: 4 })).toBe(
      "This total is missing 1 of 4 members.",
    );
  });

  it("leaves an unknown placeholder visible instead of printing undefined", () => {
    expect(formatter().t("overview.asOf", {})).toContain("{date}");
  });
});

describe("money", () => {
  it("groups by the locale, not by a developer's assumption", () => {
    const value = { amount: "14300000.55", currency: "INR" };
    expect(formatter("en-IN").money(value)).toContain("1,43,00,000.55"); // pii-ok — a formatting fixture
    expect(formatter("en-US").money(value)).toContain("14,300,000.55"); // pii-ok — same fixture
  });

  it("formats the exact decimal string without a float in the middle", () => {
    // Number() on a wider figure would already have lost precision; Intl accepts the string, so the
    // amount the store kept is the amount the reader sees.   pii-ok — the comment names a fixture
    const huge = { amount: "98765432109876.55", currency: "INR" }; // pii-ok — a digit ladder
    expect(formatter("en-IN").money(huge)).toContain("9,87,65,43,21,09,876.55"); // pii-ok — same fixture
  });

  it("shows the currency it was given, not the one we expected", () => {
    expect(formatter("en-GB").money({ amount: "10.00", currency: "GBP" })).toContain("£");
    expect(formatter("en-IN").money({ amount: "10.00", currency: "USD" })).toContain("$");
  });
});

describe("dates", () => {
  it("formats by locale", () => {
    expect(formatter("en-GB").date("2026-07-31")).toBe("31 Jul 2026");
    expect(formatter("en-US").date("2026-07-31")).toBe("Jul 31, 2026");
  });

  it("shows an em dash for an absent date rather than an empty gap", () => {
    expect(formatter().date(null)).toBe("—");
    expect(formatter().date(undefined)).toBe("—");
  });

  it("does not shift the day across a timezone", () => {
    // A date-only value is not an instant. Parsing it as local time moves it a day for half the world.
    expect(formatter("en-GB").date("2026-01-01")).toBe("1 Jan 2026");
  });
});
