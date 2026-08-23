import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatter } from "../i18n";
import { Family } from "./Family";

// All figures below are synthetic and round — this is a UI test, not real data.
const money = (a: string) => ({ amount: a, currency: "INR" });
const FAMILY = {
  provenance: { title: "Family", scope: "Me", reporting_currency: "INR" },
  granularity: "family", reporting_currency: "INR", is_partial: false, excluded: [],
  rows: [
    { member_id: "avi", name: "Avi Kolluri", relationship: "son", transfers: 2, total: money("8000.00"), // pii-ok
      first_transfer: "2023-05-21", last_transfer: "2026-06-21", holdings: 0, entity_id: "self", entity_label: "Me" },
    { member_id: "kyra", name: "Kyra Kolluri", relationship: "daughter", transfers: 1, total: money("1200.00"), // pii-ok
      first_transfer: "2023-10-24", last_transfer: "2026-01-27", holdings: 0, entity_id: "self", entity_label: "Me" },
  ],
};
const AVI = {
  entity_id: "self", person: "avi",
  transfers: [
    { date: "2026-06-21", bank: "kotak", narration: "UPI/Avi Kolluri/1/UPI", amount: money("5000.00") }, // pii-ok
    { date: "2023-05-21", bank: "icici", narration: "AVI KOLLURI SCHOOL FEE", amount: money("3000.00") }, // pii-ok
  ],
  provenance: { title: "Transfers to avi", scope: "Me", reporting_currency: "INR", row_count: 2 },
};

function stub() {
  vi.stubGlobal("fetch", vi.fn((url: string) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(url.includes("/transfers") ? AVI : FAMILY) } as Response)));
}
afterEach(() => vi.unstubAllGlobals());

describe("Family", () => {
  it("lists members with relationship and money sent", async () => {
    stub();
    render(<Family format={formatter()} />);
    await waitFor(() => expect(screen.getByText("Avi Kolluri")).toBeTruthy());
    expect(screen.getByText("son")).toBeTruthy();
    expect(screen.getByText("daughter")).toBeTruthy();
    expect(screen.getByText("₹8,000.00")).toBeTruthy(); // pii-ok
  });

  it("drills a member into their transfers", async () => {
    stub();
    render(<Family format={formatter()} />);
    fireEvent.click(await screen.findByText("Avi Kolluri"));
    await waitFor(() => expect(screen.getByText("Transfers to Avi Kolluri")).toBeTruthy());
    expect(screen.getByText("AVI KOLLURI SCHOOL FEE")).toBeTruthy();
  });
});
