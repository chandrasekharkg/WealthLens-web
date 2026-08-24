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
