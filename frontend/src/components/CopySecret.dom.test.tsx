import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatter } from "../i18n";
import { CopySecret } from "./CopySecret";

/**
 * The narrow reveal (ADR-0019): fetched only when clicked, never rendered, never held in the page.
 */

function stubFetch(payload: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(payload) } as Response)),
  );
}

function stubClipboard() {
  const writeText = vi.fn(() => Promise.resolve());
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  return writeText;
}

afterEach(() => vi.unstubAllGlobals());

const show = () =>
  render(
    <CopySecret entity="alpha" what="hdfc" label="hdfc" format={formatter("en-IN")} />,
  );

describe("copying a secret", () => {
  it("does not fetch anything until the user asks", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    show();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("puts the value on the clipboard and never on the screen", async () => {
    stubFetch({ what: "hdfc", value: "a-statement-password" });
    const writeText = stubClipboard();
    show();
    screen.getByRole("button", { name: /Copy hdfc/ }).click();

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("a-statement-password"));
    expect(await screen.findByRole("status")).toBeTruthy();
    // The user ends up holding it; the page does not.
    expect(document.body.textContent).not.toContain("a-statement-password");
  });

  it("says so when the clipboard refuses, rather than doing nothing visible", async () => {
    // Clipboard access is permission-gated in several browsers, so this is ordinary rather than exotic.
    stubFetch({ what: "hdfc", value: "x" });
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn(() => Promise.reject(new Error("denied"))) },
    });
    show();
    screen.getByRole("button", { name: /Copy hdfc/ }).click();
    expect((await screen.findByRole("status")).textContent).toContain("denied");
  });

  it("reports a refusal from the bridge instead of copying an error", async () => {
    stubFetch({ detail: { reason: "nothing is stored under that name yet." } }, false);
    const writeText = stubClipboard();
    show();
    screen.getByRole("button", { name: /Copy hdfc/ }).click();
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(writeText).not.toHaveBeenCalled();
  });
});
