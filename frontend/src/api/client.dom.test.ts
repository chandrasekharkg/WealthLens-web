import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two write-action fixes, at the layer they live: opening a document delivers differently depending on
 * where the browser is, and a state-changing call recovers from a token the server rotated out from under
 * a still-open tab.
 *
 * The module keeps a private `sessionToken`, so each test loads a fresh copy (`vi.resetModules` + dynamic
 * import) rather than leaking a refreshed token into the next.
 */

async function freshClient() {
  vi.resetModules();
  return import("./client");
}

beforeEach(() => {
  document.head.innerHTML = '<meta name="wlw-token" content="baked-in" />';
});
afterEach(() => vi.unstubAllGlobals());

describe("openDocument — where the file ends up", () => {
  it("on the same machine, the server opened it and answers JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ path: "/ws/June.pdf" }),
        { status: 200, headers: { "content-type": "application/json" } })),
    ));
    const { api } = await freshClient();
    const result = await api.openDocument("me", { payload_ref: "June.pdf" });
    expect(result).toEqual({ delivery: "opened", path: "/ws/June.pdf" });
  });

  it("across the LAN, the server streamed the bytes and we take the name off the header", async () => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve(new Response("%PDF-1.7 bytes", {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": "inline; filename=\"June.pdf\"; filename*=UTF-8''June%20Statement.pdf",
        },
      })),
    ));
    const { api } = await freshClient();
    const result = await api.openDocument("me", { payload_ref: "June.pdf", filename: "June.pdf" });
    expect(result.delivery).toBe("streamed");
    if (result.delivery === "streamed") {
      expect(result.filename).toBe("June Statement.pdf"); // the RFC 5987 form wins over the ASCII fallback
      expect(result.blob.size).toBe("%PDF-1.7 bytes".length); // the bytes came back to this browser
      expect(result.blob.type).toBe("application/pdf");
    }
  });

  it("surfaces a refused open as an ApiError carrying the reason", async () => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ detail: { error: "document", reason: "no such file" } }),
        { status: 404, headers: { "content-type": "application/json" } })),
    ));
    const { api, apiReason } = await freshClient();
    await expect(api.openDocument("me", { payload_ref: "gone.pdf" }))
      .rejects.toMatchObject({ status: 404 });
    await api.openDocument("me", { payload_ref: "gone.pdf" }).catch((e: unknown) =>
      expect(apiReason(e)).toBe("no such file"));
  });
});

describe("a token the server rotated out from under an open tab", () => {
  it("is recognised as session-expired, not an opaque failure", async () => {
    const { ApiError, isSessionExpired, apiReason } = await freshClient();
    const stale = new ApiError("POST /x failed", 403, { error: "refused", reason: "token" });
    expect(isSessionExpired(stale)).toBe(true);
    expect(apiReason(stale)).toBe("token");
    expect(isSessionExpired(new ApiError("x", 404, { detail: { reason: "nope" } }))).toBe(false);
    expect(isSessionExpired(new Error("plain"))).toBe(false);
  });

  it("re-reads the live token from the served page and retries the call once", async () => {
    const seen: string[] = [];
    const fetchMock = vi.fn((path: string, init?: RequestInit) => {
      if (path === "/") {
        // The re-served page carries the current token (a new process minted it).
        return Promise.resolve(new Response('<meta name="wlw-token" content="live-token" />', { status: 200 }));
      }
      const sent = new Headers(init?.headers).get("x-wlw-token") ?? "";
      seen.push(sent);
      return sent === "live-token"
        ? Promise.resolve(new Response(JSON.stringify({ path: "/ws/June.pdf" }),
            { status: 200, headers: { "content-type": "application/json" } }))
        : Promise.resolve(new Response(JSON.stringify({ error: "refused", reason: "token" }), { status: 403 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { api } = await freshClient();
    const result = await api.openDocument("me", { payload_ref: "June.pdf" });
    expect(result).toEqual({ delivery: "opened", path: "/ws/June.pdf" });
    expect(seen).toEqual(["baked-in", "live-token"]); // stale first, then the refreshed token
    expect(fetchMock).toHaveBeenCalledWith("/", expect.anything());
  });

  it("does not retry when the refreshed token is unchanged (server is genuinely refusing)", async () => {
    const fetchMock = vi.fn((path: string) =>
      path === "/"
        ? Promise.resolve(new Response('<meta name="wlw-token" content="baked-in" />', { status: 200 }))
        : Promise.resolve(new Response(JSON.stringify({ error: "refused", reason: "token" }), { status: 403 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { api, isSessionExpired } = await freshClient();
    await api.openDocument("me", { payload_ref: "June.pdf" }).catch((e: unknown) =>
      expect(isSessionExpired(e)).toBe(true));
    // one refresh attempt, and the POST is not fired a second time with the same dead token
    const posts = fetchMock.mock.calls.filter(([p]) => p !== "/");
    expect(posts).toHaveLength(1);
  });
});
