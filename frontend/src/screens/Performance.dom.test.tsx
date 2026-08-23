import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatter } from "../i18n";
import { Performance } from "./Performance";

const money = (a: string) => ({ amount: a, currency: "INR" });
const PERF = {
  reporting_currency: "INR",
  breakup: [
    { asset_class: "mutual_fund", value: money("46588992.06") },
    { asset_class: "savings", value: money("26336903.11") },
    { asset_class: "real_estate", value: money("22800000.00") },
    { asset_class: "credit_card", value: money("-313192.89") },   // a liability — excluded from the donut
  ],
  series: [
    { date: "2026-07-31", asset_class: "mutual_fund", value: money("45499069.22") },
    { date: "2026-08-31", asset_class: "mutual_fund", value: money("46588992.06") },
    { date: "2026-07-31", asset_class: "savings", value: money("26336903.11") },
    { date: "2026-08-31", asset_class: "savings", value: money("26336903.11") },
    { date: "2026-08-31", asset_class: "real_estate", value: money("22800000.00") },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("Performance", () => {
  it("draws the value breakup and the growth chart", async () => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(PERF) } as Response)));
    const { container } = render(<Performance format={formatter()} />);
    await waitFor(() => expect(screen.getByText("What the portfolio is made of")).toBeTruthy());
    // the donut names its buckets; the liability is not among them
    expect(screen.getAllByText("Mutual funds & ETFs").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cash").length).toBeGreaterThan(0);
    // real estate is a positive asset, so it IS in the donut breakup
    expect(screen.getByText("Real estate")).toBeTruthy();
    // the growth chart draws stacked-area polygons, and real estate is excluded from ITS legend
    expect(container.querySelectorAll(".chart-area polygon").length).toBeGreaterThanOrEqual(2);
    const growthLegend = container.querySelector(".chart-legend-row");
    expect(growthLegend?.textContent).not.toContain("Real estate");
  });

  it("shows an empty-state when nothing is valued", async () => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ ...PERF, breakup: [], series: [] }) } as Response)));
    render(<Performance format={formatter()} />);
    await waitFor(() => expect(screen.getByText("Not enough valued holdings yet to chart.")).toBeTruthy());
  });
});
