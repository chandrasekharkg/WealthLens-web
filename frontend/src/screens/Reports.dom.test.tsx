import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Positions } from "../api/client";
import { formatter } from "../i18n";
import { Reports } from "./Reports";

const row = (over: Partial<Positions["rows"][number]> = {}): Positions["rows"][number] => ({
  entity_id: "me",
  entity_label: "Me",
  name: "An Equity Fund",
  asset_class: "mutual_fund",
  account_id: "demat:x",
  quantity: 120.5,
  value: { amount: "425000.00", currency: "INR" },
  identifier: { kind: "isin", value: "INF000000000" }, // pii-ok — a shaped placeholder
  as_of: "2026-07-31",
  basis: "statement",
  ...over,
});

const data = (over: Partial<Positions> = {}): Positions => ({
  granularity: "positions",
  as_of: "2026-07-31",
  reporting_currency: "INR",
  is_partial: false,
  excluded: [],
  rows: [row()],
  provenance: {
    title: "Positions",
    scope: "Me",
    as_of: "2026-07-31",
    reporting_currency: "INR",
    stores: [],
    filters: [],
    warnings: [],
    row_count: 1,
  },
  ...over,
});

const show = (over: Partial<Positions> = {}, onDateChange = vi.fn()) => {
  render(<Reports data={data(over)} format={formatter("en-IN")} onDateChange={onDateChange} />);
  return { onDateChange };
};

describe("holdings", () => {
  it("shows the value formatted for the locale and the basis it was valued by", () => {
    show();
    const table = screen.getByRole("table");
    expect(within(table).getByText("₹4,25,000.00")).toBeTruthy(); // pii-ok — a formatting fixture
    expect(within(table).getByText("statement")).toBeTruthy();
  });

  it("states 'not applicable' for a holding with no market identifier", () => {
    // A blank would be both hidden and matched by an ISIN filter — the thing data-conventions forbids.
    show({ rows: [row({ identifier: { kind: "none", value: null }, name: "A Deposit" })] });
    expect(screen.getByText("not applicable")).toBeTruthy();
  });

  it("shows an em dash for an absent quantity rather than a zero", () => {
    // Cash, a deposit and a property genuinely have no unit count. Zero would assert the holding is empty.
    show({ rows: [row({ quantity: null, name: "A Deposit" })] });
    const table = screen.getByRole("table");
    expect(within(table).getByText("—")).toBeTruthy();
  });
});

describe("the date is the basis of computation", () => {
  it("asks for a new date when one is applied", () => {
    const { onDateChange } = show();
    const input = screen.getByLabelText("Show figures as of");
    input.setAttribute("value", "2026-03-31");
    screen.getByRole("button", { name: "Apply" }).click();
    expect(onDateChange).toHaveBeenCalled();
  });

  it("names the date the figures were computed at", () => {
    show();
    // The provenance block has its own h2, so select by name rather than by level.
    expect(screen.getByRole("heading", { name: /Holdings — 31 Jul 2026/ })).toBeTruthy();
  });
});

describe("the three kinds of empty", () => {
  it("says 'nothing imported yet' when a reachable store simply has no rows", () => {
    show({ rows: [], provenance: { ...data().provenance, row_count: 0 } });
    expect(screen.getByRole("status").textContent).toBe("Nothing has been imported for this member yet.");
  });

  it("says why, when the emptiness is because a store could not be read", () => {
    // The dangerous one: an unreachable store rendered as an empty table is indistinguishable from
    // genuinely owning nothing.
    show({
      rows: [],
      is_partial: true,
      excluded: [{ entity_id: "dad", label: "Dad", reason: "the store is in use", owner_warning: null }],
    });
    const alerts = screen.getAllByRole("alert").map((n) => n.textContent ?? "");
    expect(alerts.some((text) => text.includes("the store is in use"))).toBe(true);
  });
});

describe("excluded members", () => {
  it("names each one with its reason, above the table", () => {
    show({
      is_partial: true,
      excluded: [
        { entity_id: "dad", label: "Dad", reason: "the store was built by a different engine", owner_warning: null },
      ],
    });
    expect(screen.getByText(/Dad: the store was built by a different engine/)).toBeTruthy();
  });
});
