import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Report, ReportSummary } from "../api/client";
import { formatter } from "../i18n";
import { Reports } from "./Reports";

const catalogue: ReportSummary[] = [
  { id: "accounts", title: "Accounts", subtitle: "With a bank.", sections: [] },
  { id: "market", title: "Market instruments", subtitle: "Priced by somebody else.", sections: [] },
];

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
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const payload = url.match(/\/api\/reports$/) ? catalogue : reportBody;
      return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response);
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

const show = async (body?: Report) => {
  stub(body);
  render(<Reports format={formatter("en-IN")} />);
  // The report title is an h1; section provenance blocks carry their own headings too.
  await screen.findByRole("heading", { level: 1, name: "Market instruments" });
};

describe("a list of reports", () => {
  it("offers every report the bridge declares", async () => {
    await show();
    const nav = screen.getByRole("navigation", { name: "Reports" });
    expect(within(nav).getByRole("button", { name: "Accounts" })).toBeTruthy();
    expect(within(nav).getByRole("button", { name: "Market instruments" })).toBeTruthy();
  });

  it("marks which report is being read", async () => {
    await show();
    const nav = screen.getByRole("navigation", { name: "Reports" });
    fireEvent.click(within(nav).getByRole("button", { name: "Accounts" }));
    await waitFor(() =>
      expect(
        within(nav).getByRole("button", { name: "Accounts" }).getAttribute("aria-current"),
      ).toBe("true"),
    );
  });
});

describe("sections", () => {
  it("shows each section with its icon, count and total", async () => {
    await show();
    const equities = screen.getByRole("region", { name: "Equities" });
    expect(within(equities).getByText(/1 · ₹1,000.00/)).toBeTruthy();
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
