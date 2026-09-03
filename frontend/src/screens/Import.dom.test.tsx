import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatter } from "../i18n";
import { Import } from "./Import";

// An import job whose one file WLC could not recognize — the on-ramp's trigger.
const JOB = {
  id: "j1", verb: "import", entity_id: "self", state: "finished", outcome: "attention",
  gate: null, message: null, changed_something: false, exit_code: 0,
  result: { imported: 0, attention: 1, files: [{ file: "mystery.pdf", status: "unrecognized", // pii-ok
    message: "opened, but this bank's layout isn't recognized yet." }] },
};

const BUNDLE = {
  filename: "mystery.pdf", fingerprint: "abc123", pages: 2, needs_ocr: false, scanned: 0,
  report: "WealthLens statement diagnostic — SAFE TO SHARE\nlayout fingerprint : abc123", // pii-ok
};

const clipboardWrite = vi.fn(() => Promise.resolve());

function stub() {
  clipboardWrite.mockClear();
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    const body =
      url === "/api/jobs" ? JOB
      : url.startsWith("/api/jobs/") ? JOB
      : url.endsWith("/diagnose") ? BUNDLE
      : {};
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
  }));
  Object.assign(navigator, { clipboard: { writeText: clipboardWrite } });
}

afterEach(() => vi.unstubAllGlobals());

const entities = [{ id: "self", label: "Me", available: true }];

describe("the import verdict collapses the re-walk", () => {
  it("shows the file that changed and folds the unchanged re-walk into a count", async () => {
    const job = {
      id: "j2", verb: "import", entity_id: "self", state: "finished", outcome: "imported",
      gate: null, message: null, changed_something: true, exit_code: 0,
      result: { imported: 1, attention: 0, files: [
        { file: "new-statement.pdf", status: "imported", loaded: 5 },  // pii-ok — the one file that changed
        { file: "old-a.pdf", status: "skipped", loaded: 0 },           // pii-ok — re-walked, unchanged
        { file: "old-b.pdf", status: "skipped", loaded: 0 },           // pii-ok
        { file: "old-c.pdf", status: "imported", loaded: 0 },          // pii-ok — re-parsed, no new rows
      ] },
    };
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      const body = url.startsWith("/api/jobs") ? job : {};
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
    }));
    render(<Import entities={entities} format={formatter()} />);
    fireEvent.click(screen.getByText("Import now"));
    // the file that actually changed is shown up front …
    await waitFor(() => expect(screen.getByText("new-statement.pdf")).toBeTruthy());
    // … and the three unchanged re-walk files are folded into a count, not three "0" lines
    expect(screen.getByText("Already up to date (3)")).toBeTruthy();
  });
});

describe("adding multiple files", () => {
  it("uploads every file dropped onto the dropzone, as one accumulating batch", async () => {
    const uploaded: string[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, opts?: RequestInit) => {
      if (url === "/api/upload") {
        const name = ((opts?.body as FormData).get("file") as File).name;
        uploaded.push(name);
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ filename: name }) } as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
    }));
    render(<Import entities={entities} format={formatter()} />);
    const zone = document.querySelector(".dropzone")!;
    const files = [new File(["a"], "canara-jan.pdf"), new File(["b"], "canara-feb.pdf")]; // pii-ok — placeholders
    fireEvent.drop(zone, { dataTransfer: { files } });
    // each dropped file is uploaded to the inbox, in order, and reported as landed
    await waitFor(() => expect(uploaded).toEqual(["canara-jan.pdf", "canara-feb.pdf"]));
    expect(screen.getByText("canara-jan.pdf is in the inbox.")).toBeTruthy();
    expect(screen.getByText("canara-feb.pdf is in the inbox.")).toBeTruthy();
  });
});

describe("the staged inbox", () => {
  it("shows what is staged on load and removes a file so it can be re-filed", async () => {
    // a stateful inbox: two files, until one is deleted
    let files = [
      { name: "monthly-stmt.pdf", size: 147967, modified: 0 },       // pii-ok — placeholder statement names
      { name: "monthly-stmt (2).pdf", size: 147841, modified: 0 },   // pii-ok — the auto-renamed clash
    ];
    const deleted: string[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, opts?: RequestInit) => {
      if (url.startsWith("/api/inbox/") && (opts?.method ?? "GET") === "DELETE") {
        const name = decodeURIComponent(new URL(url, "http://x").searchParams.get("name") ?? "");
        deleted.push(name);
        files = files.filter((f) => f.name !== name);
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ removed: name }) } as Response);
      }
      if (url.startsWith("/api/inbox/")) {
        return Promise.resolve({
          ok: true, json: () => Promise.resolve({ entity_id: "self", inbox: "statements", files }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
    }));
    render(<Import entities={entities} format={formatter()} />);
    // both staged files are visible on load — the screen never opens blank when files are waiting
    await waitFor(() => expect(screen.getByText("monthly-stmt.pdf")).toBeTruthy());
    expect(screen.getByText("monthly-stmt (2).pdf")).toBeTruthy();
    // remove the auto-renamed duplicate; the DELETE carries the exact name, and the list refreshes without it
    fireEvent.click(screen.getByLabelText("Remove monthly-stmt (2).pdf"));
    await waitFor(() => expect(deleted).toEqual(["monthly-stmt (2).pdf"]));
    await waitFor(() => expect(screen.queryByText("monthly-stmt (2).pdf")).toBeNull());
    expect(screen.getByText("monthly-stmt.pdf")).toBeTruthy();       // the other file is untouched
  });
});

describe("the unrecognized-statement on-ramp", () => {
  it("turns an unrecognized file into a 1→2→3 add-your-bank panel, not a dead end", async () => {
    stub();
    render(<Import entities={entities} format={formatter()} />);
    fireEvent.click(screen.getByText("Import now"));
    // the on-ramp appears, framed as an invitation
    await waitFor(() => expect(screen.getByText("Add mystery.pdf to WealthLens")).toBeTruthy());
    expect(screen.getByText(/that's not a bug, just a format we haven't met/)).toBeTruthy();
  });

  it("diagnoses on demand and offers the two destinations (agent copy + guide), showing the safe bundle", async () => {
    stub();
    render(<Import entities={entities} format={formatter()} />);
    fireEvent.click(screen.getByText("Import now"));
    const diagnose = await screen.findByText("Diagnose this statement");
    fireEvent.click(diagnose);
    // the safe, value-free report renders, plus the two chosen destinations
    await waitFor(() => expect(screen.getByText(/layout fingerprint : abc123/)).toBeTruthy());
    expect(screen.getByText("Copy for my AI assistant")).toBeTruthy();
    expect(screen.getByText("Open the “Add your bank” guide")).toBeTruthy();

    fireEvent.click(screen.getByText("Copy for my AI assistant"));
    await waitFor(() => expect(screen.getByText("Copied ✓")).toBeTruthy());
    expect(clipboardWrite).toHaveBeenCalled();
  });
});
