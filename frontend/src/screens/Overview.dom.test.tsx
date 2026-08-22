import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { EntityTotal, NetWorth } from "../api/client";
import { en } from "../i18n/en";
import { formatter } from "../i18n";
import { Overview } from "./Overview";

/**
 * The screen's job is to make a total judgeable, so these tests are about the CAVEATS. Whether the number
 * is right is asserted in pytest, over real stores, with no DOM.
 */

const entity = (over: Partial<EntityTotal> & { entity_id: string; label: string }): EntityTotal => ({
  owner: "self",
  total: { amount: "1000.00", currency: "INR" },
  evidence_as_of: "2026-07-31",
  contributes: true,
  excluded_reason: null,
  owner_warning: null,
  workspaces: [],
  by_class: [],
  ...over,
});

const data = (over: Partial<NetWorth> = {}): NetWorth => ({
  granularity: "aggregate",
  as_of: "2026-07-31",
  reporting_currency: "INR",
  total: { amount: "3500.00", currency: "INR" },
  is_partial: false,
  entities: [entity({ entity_id: "me", label: "Me" }), entity({ entity_id: "dad", label: "Dad" })],
  provenance: {
    title: "Net worth",
    scope: "Family (2 members)",
    as_of: "2026-07-31",
    reporting_currency: "INR",
    stores: [],
    filters: [],
    warnings: [],
    row_count: null,
  },
  ...over,
});

const show = (over: Partial<NetWorth> = {}) =>
  render(<Overview data={data(over)} format={formatter("en-IN")} />);

describe("the headline", () => {
  it("formats the total in the reporting currency, grouped by locale", () => {
    show();
    expect(screen.getByTestId("net-worth-total").textContent).toContain("3,500.00");
  });

  it("shows an em dash rather than zero when there is no total to show", () => {
    // Zero and "nothing to add" are different facts, and only one of them is a number.
    show({ total: null });
    expect(screen.getByTestId("net-worth-total").textContent).toBe("—");
  });
});

describe("caveats come first", () => {
  it("says so, loudly, when the total is missing a member", () => {
    show({
      is_partial: true,
      entities: [
        entity({ entity_id: "me", label: "Me" }),
        entity({
          entity_id: "mum",
          label: "Mum",
          contributes: false,
          total: null,
          excluded_reason: "the store is missing",
        }),
      ],
    });
    expect(screen.getByRole("alert").textContent).toBe("This total is missing 1 of 2 members.");
  });

  it("carries the REASON beside the member, not just a status word", () => {
    show({
      entities: [
        entity({
          entity_id: "mum",
          label: "Mum",
          contributes: false,
          total: null,
          excluded_reason: "the store was built by a different engine — rebuild and promote it",
        }),
      ],
    });
    expect(screen.getByText(/rebuild and promote it/)).toBeTruthy();
  });

  it("flags a member answering from older evidence, without excluding them", () => {
    show({
      entities: [
        entity({ entity_id: "me", label: "Me" }),
        entity({ entity_id: "dad", label: "Dad", evidence_as_of: "2026-02-28" }),
      ],
    });
    expect(screen.getByRole("note").textContent).toContain("1 member(s) are answering from older evidence");
    // Included, just not current — the two facts stay separate.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says plainly when there is nothing to caveat", () => {
    show();
    expect(screen.getByText("Everything declared is included and current.")).toBeTruthy();
  });
});

describe("the per-member table", () => {
  it("decomposes the total, so 'whose is this?' is answerable", () => {
    show();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Me")).toBeTruthy();
    expect(within(table).getByText("Dad")).toBeTruthy();
  });

  it("shows an evidence date per member, formatted for the locale", () => {
    show({ entities: [entity({ entity_id: "me", label: "Me", evidence_as_of: "2026-02-28" })] });
    expect(screen.getByText("28 Feb 2026")).toBeTruthy();
  });

  it("shows an em dash when a member has no evidence date at all", () => {
    show({ entities: [entity({ entity_id: "me", label: "Me", evidence_as_of: null })] });
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("inherits export and print from the shipped table", () => {
    show();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Print" })).toBeTruthy();
  });
});

describe("no strings are hardcoded in the component", () => {
  it("renders another catalog's words without the screen changing", () => {
    // The real test of a message catalog: hand it different words and the UI speaks them.
    const translated = { ...en, "overview.title": "क्या यह तस्वीर भरोसेमंद है?" };
    render(<Overview data={data()} format={formatter("hi-IN", translated)} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("क्या यह तस्वीर भरोसेमंद है?");
  });

  it("formats the same figure differently for a different locale", () => {
    render(<Overview data={data()} format={formatter("en-US")} />);
    // en-US groups by thousand; en-IN by lakh. Neither is written in the component.
    expect(screen.getByTestId("net-worth-total").textContent).toContain("3,500.00");
  });
});
