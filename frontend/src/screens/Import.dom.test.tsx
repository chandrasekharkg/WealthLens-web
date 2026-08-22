import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Job } from "../api/client";
import { formatter } from "../i18n";
import { Import } from "./Import";

const ENTITIES = [
  { id: "me", label: "Me" },
  { id: "dad", label: "Dad" },
];

const job = (over: Partial<Job> = {}): Job => ({
  id: "j1",
  verb: "import",
  entity_id: "me",
  state: "finished",
  outcome: "attention",
  gate: null,
  message: null,
  changed_something: true,
  exit_code: 2,
  result: {
    imported: 2,
    attention: 1,
    files: [
      { file: "hdfc.pdf", status: "imported", loaded: 218, warnings: [] },
      { file: "sbi.pdf", status: "locked", warnings: [], message: "password-protected" },
      { file: "cas.pdf", status: "imported", loaded: 1043, warnings: ["units_incomplete", "footing_break"] },
    ],
  },
  ...over,
});

function mockFetch(responses: Record<string, unknown>) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const key = Object.keys(responses).find((candidate) => url.includes(candidate));
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(key ? responses[key] : {}),
    } as Response);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const show = () => render(<Import entities={ENTITIES} format={formatter("en-IN")} />);

describe("the verdict is the engine's, verbatim", () => {
  it("renders every file with its outcome, rows and warnings", async () => {
    vi.stubGlobal("fetch", mockFetch({ "/api/jobs": job() }));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Import now" }));

    const table = await screen.findByRole("table");
    expect(within(table).getByText("hdfc.pdf")).toBeTruthy();
    expect(within(table).getByText("218")).toBeTruthy();
    // No file's warning may be dropped, however many it has.
    expect(within(table).getByText("units_incomplete, footing_break")).toBeTruthy();
  });

  it("translates each status rather than showing the engine's raw token", async () => {
    vi.stubGlobal("fetch", mockFetch({ "/api/jobs": job() }));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Import now" }));
    expect(await screen.findByText("Password needed")).toBeTruthy();
  });

  it("shows an em dash where a file loaded nothing, not a zero", async () => {
    vi.stubGlobal("fetch", mockFetch({ "/api/jobs": job() }));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Import now" }));
    const table = await screen.findByRole("table");
    expect(within(table).getAllByText("—").length).toBeGreaterThan(0);
  });
});

describe("a refusal is not a failure", () => {
  it("says plainly that nothing changed, and which gate refused", async () => {
    // The job contract distinguishes these, so the UI does not have to read prose to know which happened.
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "/api/jobs": job({ outcome: "refused", gate: "locked", changed_something: false, result: {} }),
      }),
    );
    show();
    fireEvent.click(screen.getByRole("button", { name: "Import now" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Nothing was changed");
    expect(alert.textContent).toContain("locked");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("reports a real failure differently from a refusal", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "/api/jobs": job({ outcome: "failed", message: "the engine is not installed", result: {} }),
      }),
    );
    show();
    fireEvent.click(screen.getByRole("button", { name: "Import now" }));
    expect((await screen.findByRole("alert")).textContent).toContain("the engine is not installed");
  });
});

describe("upload", () => {
  it("says when a colliding name was kept under a different one", async () => {
    // Otherwise the user finds "s (2).pdf" later and has to guess why.
    vi.stubGlobal(
      "fetch",
      mockFetch({ "/api/upload": { filename: "s (2).pdf", renamed_from: "s.pdf" } }),
    );
    show();
    const input = screen.getByLabelText("Choose statement files");
    // `input.files` is read-only, so RTL's target shortcut does not reach the handler; define it.
    Object.defineProperty(input, "files", {
      value: [new File(["x"], "s.pdf", { type: "application/pdf" })],
    });
    fireEvent.change(input);
    await waitFor(() =>
      expect(screen.getByText(/s\.pdf was already there, so this one was kept as s \(2\)\.pdf/)).toBeTruthy(),
    );
  });
});

describe("where statements come from", () => {
  it("is on the screen, because that is where onboarding actually stalls", () => {
    show();
    expect(screen.getByText("Where do these come from?")).toBeTruthy();
    expect(screen.getByText(/never signs in to anything on your behalf/)).toBeTruthy();
  });
});

describe("choosing a member", () => {
  it("will not offer to deposit into a store that cannot be read", () => {
    // Found by clicking through the running app: an unreadable member was selectable, and depositing
    // there would have built a folder tree where no workspace exists.
    render(
      <Import
        entities={[
          { id: "me", label: "Me", available: true },
          { id: "sister", label: "Sister", available: false },
        ]}
        format={formatter("en-IN")}
      />,
    );
    expect(screen.getByRole("option", { name: /Sister/ }).hasAttribute("disabled")).toBe(true);
  });

  it("defaults to a member who can actually receive a file", () => {
    render(
      <Import
        entities={[
          { id: "sister", label: "Sister", available: false },
          { id: "me", label: "Me", available: true },
        ]}
        format={formatter("en-IN")}
      />,
    );
    expect(screen.getByLabelText("For").getAttribute("value") ?? screen.getByLabelText<HTMLSelectElement>("For").value).toBe("me");
  });
});
