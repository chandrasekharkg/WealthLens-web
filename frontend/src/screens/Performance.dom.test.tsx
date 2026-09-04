import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatter } from "../i18n";
import { Performance } from "./Performance";

const money = (a: string) => ({ amount: a, currency: "INR" });
// The shape the BRIDGE returns: every figure the charts show is pre-computed (share, stack base/top, total,
// axis ticks). The bridge's arithmetic is tested in pytest; this stubs its output to test the RENDERING.
// Synthetic round numbers, not a real portfolio. Real estate is absent from the series (the bridge excludes
// it from the growth stack) but present, positive, in the breakup — and reported in `omitted`.
const PERF = {
  reporting_currency: "INR",
  as_of: "2026-08-31",
  is_partial: false,
  excluded: [],
  total: money("120.00"),
  breakup: [
    { asset_class: "mutual_fund", value: money("60.00"), share: 50 },
    { asset_class: "savings", value: money("30.00"), share: 25 },
    { asset_class: "real_estate", value: money("30.00"), share: 25 },
    { asset_class: "credit_card", value: money("-10.00"), share: 0 },   // a liability — excluded from the donut
  ],
  series: [
    { date: "2026-07-31", asset_class: "mutual_fund", value: money("55.00"), base: money("0.00"), top: money("55.00") },
    { date: "2026-07-31", asset_class: "savings", value: money("30.00"), base: money("55.00"), top: money("85.00") },
    { date: "2026-08-31", asset_class: "mutual_fund", value: money("60.00"), base: money("0.00"), top: money("60.00") },
    { date: "2026-08-31", asset_class: "savings", value: money("30.00"), base: money("60.00"), top: money("90.00") },
  ],
  axis_max: money("90.00"),
  axis_ticks: [money("0.00"), money("45.00"), money("90.00")],
  omitted: [{ asset_class: "real_estate", reason: "a lumpy purchase mark, not a monthly market value", value: money("30.00") }],
  classes: [
    { asset_class: "savings", label: "Savings", group: "cash", category: "asset", order: 0 },
    { asset_class: "mutual_fund", label: "Mutual fund", group: "funds", category: "asset", order: 1 },
    { asset_class: "real_estate", label: "Real estate", group: "real_estate", category: "asset", order: 2 },
  ],
  provenance: { title: "Portfolio", scope: "T", as_of: "2026-08-31", reporting_currency: "INR",
    stores: [], filters: [], warnings: [], row_count: null },
};

afterEach(() => vi.unstubAllGlobals());

describe("Performance", () => {
  it("draws the value breakup and the growth chart", async () => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(PERF) } as Response)));
    const { container } = render(<Performance format={formatter()} />);
    await waitFor(() => expect(screen.getByText("What the portfolio is made of")).toBeTruthy());
    // the donut names its buckets; the liability is not among them
    expect(screen.getAllByText("Mutual funds").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cash").length).toBeGreaterThan(0);
    // real estate is a positive asset, so it IS in the donut breakup
    expect(screen.getAllByText("Real estate").length).toBeGreaterThan(0);
    // the growth chart draws stacked-area polygons, and real estate is excluded from ITS legend
    expect(container.querySelectorAll(".chart-area polygon").length).toBeGreaterThanOrEqual(2);
    const growthLegend = container.querySelector(".chart-legend-row");
    expect(growthLegend?.textContent).not.toContain("Real estate");
    // B1: the excluded class is named as a caveat, with its value — so the top-line reconciles honestly
    const note = container.querySelector(".chart-note");
    expect(note?.textContent).toContain("Growth excludes");
    expect(note?.textContent).toContain("Real estate");
  });

  it("says so when a store could not be included (B2)", async () => {
    const partial = { ...PERF, is_partial: true,
      excluded: [{ entity_id: "dad", label: "Dad", reason: "the store is missing", owner_warning: null }] };
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(partial) } as Response)));
    render(<Performance format={formatter()} />);
    await waitFor(() => expect(screen.getByText(/these charts are partial/)).toBeTruthy());
    expect(screen.getByText(/Dad/)).toBeTruthy();
  });

  it("shows an empty-state when nothing is valued", async () => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ ...PERF, breakup: [], series: [], omitted: [] }) } as Response)));
    render(<Performance format={formatter()} />);
    await waitFor(() => expect(screen.getByText("Not enough valued holdings yet to chart.")).toBeTruthy());
  });
});
