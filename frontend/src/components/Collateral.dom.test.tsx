import { render, screen, within } from "@testing-library/react";
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
