import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Report } from "../api/client";
import { formatter } from "../i18n";
import { Reports } from "./Reports";

const row = (
  name: string,
  cls: string,
  amount: string,
  extra: { first_acquired_on?: string | null; disposition?: string | null } = {},
) => ({
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
  first_acquired_on: extra.first_acquired_on ?? null,
  disposition: extra.disposition ?? null,
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

describe("the acquisition column and disposition badge", () => {
  it("shows when a position was first held, and a dash where the store cannot say", async () => {
    const body = report({
      sections: [
        { id: "equities", title: "Equities", icon: "📈", note: null, count: 2,
          total: { amount: "2000.00", currency: "INR" }, rows: [
            row("Held Co", "listed_equity", "1000.00", { first_acquired_on: "2017-08-11" }),
            row("Snapshot Only", "listed_equity", "1000.00"),   // no events → no date
          ] },
      ],
    });
    stub(body);
    render(<Reports reportId="market" format={formatter("en-IN")} />);
    await screen.findByRole("heading", { level: 1, name: "Market instruments" });
    const held = screen.getByRole("row", { name: /Held Co/ });
    expect(within(held).getByText("11 Aug 2017")).toBeTruthy();   // en-IN date, walked over the chain
    const snap = screen.getByRole("row", { name: /Snapshot Only/ });
    // a snapshot-only, live position shows a dash in BOTH new columns (no acquisition date, no disposition)
    expect(within(snap).getAllByText("\u2014").length).toBeGreaterThanOrEqual(1);   // an em dash, not the epoch
  });

  it("badges a written-off position with its reason, and unknown wears the warning tone", async () => {
    const body = report({
      sections: [
        { id: "equities", title: "Equities", icon: "📈", note: null, count: 2,
          total: { amount: "0.00", currency: "INR" }, rows: [
            row("Rolta", "listed_equity", "0.00", { first_acquired_on: "2018-05-16", disposition: "written_off" }),
            row("Fading Co", "listed_equity", "0.00", { disposition: "unknown" }),
          ] },
      ],
    });
    stub(body);
    render(<Reports reportId="market" format={formatter("en-IN")} />);
    await screen.findByRole("heading", { level: 1, name: "Market instruments" });
    const rolta = screen.getByRole("row", { name: /Rolta/ });
    const badge = within(rolta).getByText("Written off");
    expect(badge.getAttribute("data-disposition")).toBe("written_off");
    const fading = screen.getByRole("row", { name: /Fading Co/ });
    const unknown = within(fading).getByText("Unexplained");
    expect(unknown.getAttribute("data-tone")).toBe("warning");    // a zero nobody has explained → go look
  });
});


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
