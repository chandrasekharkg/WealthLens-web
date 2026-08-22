import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Report } from "../api/client";
import { formatter } from "../i18n";
import { Reports } from "./Reports";

const row = (name: string, cls: string, amount: string) => ({
  entity_id: "me",
  entity_label: "Me",
  name,
  asset_class: cls,
  account_id: "demat:x",
  quantity: 10,
  value: { amount, currency: "INR" },
  identifier: { kind: "isin" as const, value: "INF000000000" }, // pii-ok — a shaped placeholder
  as_of: "2026-07-31",
  basis: "statement",
});

const report = (over: Partial<Report> = {}): Report => ({
  id: "market",
  title: "Market instruments",
  subtitle: "Priced by somebody else.",
  as_of: "2026-07-31",
  reporting_currency: "INR",
  is_partial: false,
  excluded: [],
  provenance: {
    title: "Positions", scope: "Me", as_of: "2026-07-31", reporting_currency: "INR",
    stores: [], filters: [], warnings: [], row_count: 2,
  },
  sections: [
    { id: "equities", title: "Equities", icon: "📈", note: null, count: 1,
      total: { amount: "1000.00", currency: "INR" }, rows: [row("A Share", "listed_equity", "1000.00")] },
    { id: "bonds", title: "Bonds", icon: "🧾", note: null, count: 0, total: null, rows: [] },
  ],
  ...over,
});

function stub(reportBody: Report = report()) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(reportBody) } as Response)),
  );
}

afterEach(() => vi.unstubAllGlobals());

const show = async (body?: Report) => {
  stub(body);
  render(<Reports reportId="market" format={formatter("en-IN")} />);
  await screen.findByRole("heading", { level: 1, name: "Market instruments" });
};

describe("sections", () => {
  it("shows each section with its icon, count and total", async () => {
    await show();
    const equities = screen.getByRole("region", { name: "Equities" });
    // Count beside the name, total on its own — the two used to be run together in one line of dot-
    // separated fragments that read as a sentence and scanned as none.
    expect(within(equities).getByRole("heading", { level: 2 }).textContent).toContain("(1)");
    // By class rather than by text: with one row in the section, the row's own value cell reads the same,
    // and a query that cannot tell the total from a cell would pass whichever one it found.
    expect(equities.querySelector(".section-total")?.textContent).toBe("₹1,000.00");
  });

  it("states the scope, date and currency ONCE for the report, not once per table", async () => {
    // Four sections repeating "Me · as of … · in INR" said nothing new four times and pushed the data
    // down the page. It has to remain present exactly once, because on paper it is the only context.
    await show();
    expect(screen.getAllByRole("region", { name: "About these figures" })).toHaveLength(1);
  });

  it("says a group is empty rather than rendering a headerless table", async () => {
    await show();
    const bonds = screen.getByRole("region", { name: "Bonds" });
    expect(within(bonds).getByRole("status").textContent).toBe("Nothing in this group.");
  });

  it("gives each section its own export, named for that section", async () => {
    // A reader exporting "Equities" should get equities, not the whole report.
    await show();
    const equities = screen.getByRole("region", { name: "Equities" });
    expect(within(equities).getByRole("button", { name: "Export CSV" })).toBeTruthy();
  });
});

describe("honesty survives the regrouping", () => {
  it("names an excluded member above the sections", async () => {
    await show(
      report({
        is_partial: true,
        excluded: [{ entity_id: "dad", label: "Dad", reason: "the store is missing", owner_warning: null }],
      }),
    );
    expect(screen.getByRole("alert").textContent).toContain("Dad: the store is missing");
  });
});
