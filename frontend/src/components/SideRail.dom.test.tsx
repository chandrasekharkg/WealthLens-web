import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SideRail, type RailItem } from "./SideRail";

const labels = { collapse: "Hide the list", expand: "Show the list" };

const items = (current = "accounts", onPick = () => undefined): RailItem[] =>
  [
    { id: "accounts", label: "Accounts" },
    { id: "market", label: "Market instruments" },
    { id: "everything", label: "Everything" },
  ].map((entry) => ({ ...entry, current: entry.id === current, onPick }));

function show(over: Partial<React.ComponentProps<typeof SideRail>> = {}) {
  const props = {
    heading: "Reports",
    items: items(),
    open: true,
    onToggle: () => undefined,
    labels,
    ...over,
  };
  render(<SideRail {...props} />);
  return props;
}

describe("the rail", () => {
  it("offers every choice within the tab", () => {
    show();
    const nav = screen.getByRole("navigation", { name: "Reports" });
    for (const name of ["Accounts", "Market instruments", "Everything"]) {
      expect(within(nav).getByRole("button", { name })).toBeTruthy();
    }
  });

  it("marks which one is being read", () => {
    show({ items: items("market") });
    const nav = screen.getByRole("navigation", { name: "Reports" });
    expect(within(nav).getByRole("button", { name: "Market instruments" }).getAttribute("aria-current"))
      .toBe("true");
    expect(within(nav).getByRole("button", { name: "Accounts" }).getAttribute("aria-current")).toBe(
      "false",
    );
  });

  it("picks the one that was clicked", () => {
    const onPick = vi.fn();
    show({ items: items("accounts", onPick) });
    fireEvent.click(screen.getByRole("button", { name: "Everything" }));
    expect(onPick).toHaveBeenCalled();
  });

  it("collapses to give the width back to the data", () => {
    const onToggle = vi.fn();
    show({ onToggle });
    fireEvent.click(screen.getByRole("button", { name: labels.collapse }));
    expect(onToggle).toHaveBeenCalled();
  });

  it("hides the choices when collapsed, and offers the way back", () => {
    show({ open: false });
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByRole("button", { name: labels.expand })).toBeTruthy();
  });

  it("renders nothing at all when the tab has no choices", () => {
    // An empty 214px column is real estate spent on decoration. The tables want it.
    const { container } = render(
      <SideRail heading="Overview" items={[]} open onToggle={() => undefined} labels={labels} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
