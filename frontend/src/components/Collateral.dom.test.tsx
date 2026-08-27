import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Collateral } from "./Collateral";
import { formatter } from "../i18n";
import type { WorkspaceDetail } from "../api/client";

type Doc = WorkspaceDetail["documents"][number];

const doc = (over: Partial<Doc> & Pick<Doc, "source_id">): Doc => ({
  source_id: over.source_id,
  kind: "file",
  provider: over.provider ?? null,
  filename: over.filename ?? null,
  payload_ref: over.payload_ref ?? null,
  rows: over.rows ?? null,
  captured_at: null,
  period_start: over.period_start ?? null,
  period_end: over.period_end ?? null,
  password: over.password ?? { kind: "none", name: null },
});

describe("collateral as expanded folders", () => {
  it("groups documents by folder, each expanded", () => {
    render(
      <Collateral
        entity="me"
        format={formatter("en-IN")}
        onOpen={() => {}}
        documents={[
          doc({ source_id: "a", provider: "nsdl", filename: "cas.pdf" }),
          doc({ source_id: "b", provider: "religare", filename: "cn.pdf" }),
        ]}
      />,
    );
    // one <details open> per folder, named for the folder
    expect(screen.getByText("nsdl")).toBeTruthy();
    expect(screen.getByText("religare")).toBeTruthy();
    const groups = document.querySelectorAll("details.folder[open]");
    expect(groups.length).toBe(2);
  });

  it("makes a filename a control that asks to open the file, with its provider", () => {
    const onOpen = vi.fn();
    render(
      <Collateral
        entity="me"
        format={formatter("en-IN")}
        onOpen={onOpen}
        documents={[doc({ source_id: "a", provider: "nsdl", filename: "cas.pdf" })]}
      />,
    );
    screen.getByRole("button", { name: /Open the file: cas.pdf/ }).click();
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ provider: "nsdl", filename: "cas.pdf" }));
  });

  it("filters to one folder and caps a large folder with a show-all", () => {
    // one big folder (well past the cap) + several others → the list must stay navigable
    const many = Array.from({ length: 25 }, (_, i) =>
      doc({ source_id: `r${i}`, provider: "religare", filename: `cn-${i}.pdf` }));
    render(
      <Collateral
        entity="me"
        format={formatter("en-IN")}
        onOpen={() => {}}
        documents={[
          ...many,
          doc({ source_id: "k", provider: "kotak", filename: "kotak.pdf" }),
          doc({ source_id: "n", provider: "nsdl", filename: "cas.pdf" }),
        ]}
      />,
    );
    // capped: only the first 10 religare rows render until "show all"
    expect(screen.getByText("cn-0.pdf")).toBeTruthy();
    expect(screen.queryByText("cn-20.pdf")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show all 25/ }));
    expect(screen.getByText("cn-20.pdf")).toBeTruthy();

    // filter narrows to one folder: kotak/nsdl drop out when religare is chosen
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "religare" } });
    expect(screen.queryByText("kotak.pdf")).toBeNull();
    expect(screen.queryByText("cas.pdf")).toBeNull();
  });

  it("orders a folder newest 'to' first — a lone date counts as the 'to'", () => {
    render(
      <Collateral
        entity="me"
        format={formatter("en-IN")}
        onOpen={() => {}}
        documents={[
          doc({ source_id: "y2018", provider: "equateplus", filename: "y2018.pdf", period_end: "2018-01-01" }),
          doc({ source_id: "y2026", provider: "equateplus", filename: "y2026.pdf", period_end: "2026-07-28" }),
          // a single date, recorded as period_start only — must sort as if it were the 'to'
          doc({ source_id: "y2020", provider: "equateplus", filename: "y2020.pdf", period_start: "2020-01-01" }),
        ]}
      />,
    );
    const names = [...document.querySelectorAll("tbody tr td:first-child")].map((td) => td.textContent);
    expect(names).toEqual(["y2026.pdf", "y2020.pdf", "y2018.pdf"]);
  });

  it("opens a document that has only a payload_ref (no parsed filename)", () => {
    const onOpen = vi.fn();
    render(
      <Collateral
        entity="me"
        format={formatter("en-IN")}
        onOpen={onOpen}
        documents={[doc({ source_id: "a", provider: "nsdl", filename: null, payload_ref: "statements/cas-2026.pdf" })]}
      />,
    );
    // the payload_ref is the label AND the control — opening resolves it on the bridge
    screen.getByRole("button", { name: /Open the file: statements\/cas-2026.pdf/ }).click();
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ payload_ref: "statements/cas-2026.pdf" }));
  });

  it("offers a Copy control only where a named password opened the document", () => {
    render(
      <Collateral
        entity="me"
        format={formatter("en-IN")}
        onOpen={() => {}}
        documents={[
          doc({ source_id: "a", provider: "nsdl", filename: "cas.pdf",
                password: { kind: "named", name: "cas" } }),
          doc({ source_id: "b", provider: "sbi", filename: "stmt.pdf",
                password: { kind: "none", name: null } }),
        ]}
      />,
    );
    // the named one has a Copy button; the none one says so, no button
    const named = screen.getByRole("row", { name: /cas.pdf/ });
    expect(within(named).getByRole("button", { name: /Copy/ })).toBeTruthy();
    const none = screen.getByRole("row", { name: /stmt.pdf/ });
    expect(within(none).queryByRole("button", { name: /Copy/ })).toBeNull();
  });
});
