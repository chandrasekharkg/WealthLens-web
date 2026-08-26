import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceDetail } from "../api/client";
import { formatter } from "../i18n";
import { Activity } from "./Activity";
import { Workspace } from "./Workspace";

// Note what a password reference does NOT carry: there is no `value` field in the contract, because a
// value must never cross the API. The type refuses to let a test invent one.
const detail = (over: Partial<WorkspaceDetail> = {}): WorkspaceDetail => ({
  entity_id: "alpha",
  path: "/home/me/alpha-WealthLens-data",
  workspace: {
    label: "alpha-WealthLens-data",
    availability: "ok",
    detail: null,
    schema_version: "3.10",
    holder: null,
  },
  settings: {
    holder_names: ["Kolluri"],
    pan_set: false,
    organize: true,
    secret_names: ["hdfc"],
    config_path: "/home/me/alpha-WealthLens-data/config.toml",
  },
  documents: [
    {
      source_id: "src:1",
      kind: "file",
      provider: "hdfc",
      filename: "hdfc-jul.pdf",
      payload_ref: "statements/hdfc-jul.pdf",
      rows: 218,
      captured_at: "2026-07-31 10:00:00",
      password: { kind: "named", name: "hdfc.pass" },
    },
  ],
  ...over,
});

function stub(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response)),
  );
}

afterEach(() => vi.unstubAllGlobals());

const show = async (over: Partial<WorkspaceDetail> = {}) => {
  stub(detail(over));
  render(
    <Workspace entities={[{ id: "alpha", label: "Alpha" }]} format={formatter("en-IN")} />,
  );
  await screen.findByText("/home/me/alpha-WealthLens-data");
};

describe("the custodian is visible", () => {
  it("shows where the store physically lives, and its schema", async () => {
    await show();
    expect(screen.getByText("/home/me/alpha-WealthLens-data")).toBeTruthy();
    expect(screen.getByText(/Schema 3\.10/)).toBeTruthy();
  });

  it("lists each document with what it contributed", async () => {
    await show();
    // The collateral doc table is the first table; the password ring is a second one below it.
    const table = screen.getAllByRole("table")[0]!;
    expect(within(table).getByText("hdfc-jul.pdf")).toBeTruthy();
    expect(within(table).getByText("218")).toBeTruthy();
  });

  it("offers a source control per document, and renders the password ring as a table", async () => {
    await show({
      settings: { holder_names: ["K"], pan_set: false, organize: true,
        secret_names: ["hdfc.pass"], config_path: "/x" },
    });
    // every document row has a source control (opens the provenance popup)
    expect(screen.getByRole("button", { name: /Where this came from/ })).toBeTruthy();
    // the ring is a table listing each configured password with a Copy control
    const ring = document.querySelector(".password-ring") as HTMLElement;
    expect(within(ring).getByText("hdfc.pass")).toBeTruthy();
    expect(within(ring).getByRole("button", { name: /Copy/ })).toBeTruthy();
  });
});

describe("the password ring has three states, not two", () => {
  it("offers a Copy control for a named password (it is copyable, not shown as text)", async () => {
    await show();
    // the named password is now a clipboard control, labelled by its name — never rendered as text
    expect(screen.getByRole("button", { name: /Copy hdfc\.pass/ })).toBeTruthy();
  });

  it("says 'an unnamed password' rather than claiming nothing opened it", async () => {
    // The common case: interactively-remembered passwords and the PAN pool both record only a
    // fingerprint. Calling that "nothing has opened it" would be false.
    await show({
      documents: [
        { ...detail().documents[0]!, password: { kind: "unnamed", name: null } },
      ],
    });
    expect(screen.getByText("an unnamed password")).toBeTruthy();
  });

  it("says so when nothing has opened a document", async () => {
    await show({
      documents: [{ ...detail().documents[0]!, password: { kind: "none", name: null } }],
    });
    expect(screen.getByText("no password")).toBeTruthy();
  });
});

describe("identity", () => {
  it("shows the PAN as set-or-unset and never as text", async () => {
    await show({ settings: { ...detail().settings, pan_set: true } });
    expect(screen.getByText(/stored in its own file, never shown here/)).toBeTruthy();
  });

  it("says what a PAN is for when there isn't one", async () => {
    await show();
    expect(screen.getByText(/unlocks CAS and many statements/)).toBeTruthy();
  });

  it("names the file it writes to, so a text editor is never locked out", async () => {
    await show();
    expect(screen.getByText(/config\.toml/)).toBeTruthy();
  });
});

describe("activity", () => {
  it("says the list is forgotten on restart, and that stores are unaffected", async () => {
    // An empty log that looked like a complete history would be a lie about what happened.
    stub([]);
    render(<Activity format={formatter("en-IN")} />);
    await waitFor(() => expect(screen.getByText(/only while the app is running/)).toBeTruthy());
    expect(screen.getByText(/stores are unaffected/)).toBeTruthy();
  });

  it("shows a refusal with the gate that caused it", async () => {
    stub([
      {
        id: "j1", verb: "promote", entity_id: "alpha", state: "finished", outcome: "refused",
        gate: "stale-candidate", message: null, changed_something: false, result: {}, exit_code: 3,
      },
    ]);
    render(<Activity format={formatter("en-IN")} />);
    await waitFor(() => expect(screen.getByText(/refused — stale-candidate/)).toBeTruthy());
  });
});
