import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NetWorth } from "../api/client";
import { formatter } from "../i18n";
import { Operations } from "./Operations";

/**
 * The screen makes the guard VISIBLE. It does not constitute it — the same rule is enforced on the
 * server, because a disabled button is not a guard for something that cannot be undone.
 */

const entities: NetWorth["entities"] = [
  {
    entity_id: "alpha",
    label: "Alpha",
    owner: "self",
    total: { amount: "1000.00", currency: "INR" },
    evidence_as_of: "2026-07-31",
    contributes: true,
    status: "ok",
    excluded_reason: null,
    owner_warning: null,
    workspaces: [],
    by_class: [],
  },
];

const rebuildJob = (over = {}) => ({
  id: "rb1",
  verb: "rebuild",
  entity_id: "alpha",
  state: "finished",
  outcome: "attention",
  gate: null,
  message: null,
  changed_something: true,
  exit_code: 2,
  result: {
    tally: [
      { table: "bank_transactions", current: 9289, rebuilt: 9289, delta: 0 }, // pii-ok — invented counts
      { table: "valuations", current: 173458, rebuilt: 173873, delta: 415 }, // pii-ok — invented counts
    ],
    regressions: [],
  },
  ...over,
});

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const payload = handler(url, init);
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response);
  });
}

afterEach(() => vi.unstubAllGlobals());

const show = (onPromoted = vi.fn()) => {
  render(<Operations entities={entities} format={formatter("en-IN")} onPromoted={onPromoted} />);
  return { onPromoted };
};

describe("promotion is unreachable without a review", () => {
  it("offers no confirmation at all before a rebuild has run", () => {
    show();
    expect(screen.getByText(/Rebuild first, and read the tally/)).toBeTruthy();
    expect(screen.queryByLabelText(/Type alpha to confirm/)).toBeNull();
  });

  it("stays disabled until the typed word matches exactly", async () => {
    vi.stubGlobal("fetch", mockFetch(() => rebuildJob()));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Rebuild" }));

    const input = await screen.findByLabelText("Type alpha to confirm");
    const button = screen.getByRole("button", { name: "Promote this rebuild" });
    expect(button.hasAttribute("disabled")).toBe(true);

    fireEvent.change(input, { target: { value: "alph" } });
    expect(button.hasAttribute("disabled")).toBe(true);

    fireEvent.change(input, { target: { value: "alpha" } });
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("warns that the act cannot be undone, before offering it", async () => {
    vi.stubGlobal("fetch", mockFetch(() => rebuildJob()));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Rebuild" }));
    const alert = await screen.findByText(/cannot be undone/);
    expect(alert.textContent).toContain("Alpha");
  });
});

describe("the tally is what there is to review", () => {
  it("shows only the tables that actually differ", async () => {
    vi.stubGlobal("fetch", mockFetch(() => rebuildJob()));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Rebuild" }));

    await screen.findByText("valuations");
    // A row that did not move is noise in a review; the ones that moved are the decision.
    expect(screen.queryByText("bank_transactions")).toBeNull();
  });

  it("says plainly when a rebuild would change nothing", async () => {
    vi.stubGlobal("fetch", mockFetch(() => rebuildJob({ result: { tally: [], regressions: [] } })));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Rebuild" }));
    expect(await screen.findByText(/No differences/)).toBeTruthy();
  });

  it("flags a coverage regression as the parser gap it probably is", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        rebuildJob({ result: { tally: [], regressions: [{ table: "bank_transactions" }] } }),
      ),
    );
    show();
    fireEvent.click(screen.getByRole("button", { name: "Rebuild" }));
    expect(await screen.findByText(/reproduced FEWER rows/)).toBeTruthy();
  });
});

describe("switching member", () => {
  it("drops the tally, because it belonged to one workspace", async () => {
    // Carrying it across would offer to promote one member's rebuild into another member's store.
    vi.stubGlobal("fetch", mockFetch(() => rebuildJob()));
    render(
      <Operations
        entities={[...entities, { ...entities[0]!, entity_id: "beta", label: "Beta" }]}
        format={formatter("en-IN")}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Rebuild" }));
    await screen.findByLabelText("Type alpha to confirm");

    fireEvent.change(screen.getByLabelText("For"), { target: { value: "beta" } });
    await waitFor(() => expect(screen.getByText(/Rebuild first/)).toBeTruthy());
  });
});

describe("a store that needs promoting is the one that must be selectable", () => {
  const skewed: NetWorth["entities"][number] = {
    ...entities[0]!,
    entity_id: "old",
    label: "Old",
    contributes: false,
    total: null,
    excluded_reason: "the store was built by a different engine — rebuild and promote it",
    workspaces: [
      { label: "old-WealthLens-data", availability: "schema_skew", detail: null,
        schema_version: "3.8", holder: null },
    ],
  };

  it("keeps a schema-skewed store selectable, because promoting is how skew is fixed", () => {
    // Disabling it would lock the door from the inside: the store excluded FOR skew is the exact store
    // whose rebuild needs promoting.
    render(<Operations entities={[skewed]} format={formatter("en-IN")} />);
    expect(screen.getByRole("option", { name: "Old" }).hasAttribute("disabled")).toBe(false);
  });

  it("still refuses a store that genuinely cannot be opened", () => {
    const missing = {
      ...skewed,
      entity_id: "gone",
      label: "Gone",
      workspaces: [
        { label: "gone", availability: "missing" as const, detail: null, schema_version: null,
          holder: null },
      ],
    };
    render(<Operations entities={[missing]} format={formatter("en-IN")} />);
    expect(screen.getByRole("option", { name: "Gone" }).hasAttribute("disabled")).toBe(true);
  });
});


// ── a refusal explains itself, and only the two review gates can be waived (adoption review 2026-09-05, #3) ──

const refusedPromotion = (gate: string, result: Record<string, unknown> = {}) => ({
  id: "pr1",
  verb: "promote",
  entity_id: "alpha",
  state: "finished",
  outcome: "refused",
  gate,
  message: `the candidate reproduced FEWER rows than the live store (${gate})`,
  changed_something: false,
  exit_code: 3,
  result,
});

/** Rebuild, type the word, promote — and hand the promote poll the given job. Returns the captured fetch. */
async function promoteInto(promotionJob: unknown, rebuild = rebuildJob()) {
  const posted: unknown[] = [];
  const fetch = mockFetch((url, init) => {
    if (url === "/api/jobs" && init?.method === "POST") {
      const body = JSON.parse(init.body as string) as { verb: string };
      posted.push(body);
      return body.verb === "promote" ? { ...(promotionJob as object), state: "queued" } : { ...rebuild, state: "queued" };
    }
    if (url.startsWith("/api/jobs/pr1")) return promotionJob;
    if (url.startsWith("/api/jobs/rb1")) return rebuild;
    return {};
  });
  vi.stubGlobal("fetch", fetch);
  show();
  fireEvent.click(screen.getByText("Rebuild"));
  await waitFor(() => expect(screen.getByLabelText("Type alpha to confirm")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Type alpha to confirm"), { target: { value: "alpha" } });
  fireEvent.click(screen.getByRole("button", { name: "Promote this rebuild" }));
  await waitFor(() => expect(screen.getByRole("region", { name: "Why it was refused" })).toBeTruthy());
  return posted;
}

describe("a refused promotion says WHICH file or table, not just the gate", () => {
  it("lists the per-source rows the engine refused on, and the engine's own message", async () => {
    await promoteInto(refusedPromotion("coverage-regression", {
      regressions: [],
      source_regressions: [{ payload_ref: "/ws/statements/a.pdf", current: 2, rebuilt: 1 }],
    }));
    expect(screen.getByText(/a\.pdf: this file's own rows — 1 rebuilt vs 2 live/)).toBeTruthy();
    expect(screen.getByText(/reproduced FEWER rows/)).toBeTruthy();
  });

  it("offers a waiver for a review gate, and sends it as `allow` on the next promote", async () => {
    const posted = await promoteInto(refusedPromotion("coverage-regression", {
      source_regressions: [{ payload_ref: "/ws/statements/a.pdf", current: 2, rebuilt: 1 }],
    }));
    const box = screen.getByRole("checkbox");
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Promote this rebuild" }));
    await waitFor(() => expect(posted.length).toBe(3)); // rebuild, promote, promote-with-waiver
    expect(posted[2]).toMatchObject({ verb: "promote", confirm: "alpha", allow: ["coverage-regression"] });
    expect(posted[1]).not.toHaveProperty("allow"); // the first attempt carried none
  });

  it("offers NO waiver for a hard gate — those are final everywhere", async () => {
    await promoteInto(refusedPromotion("integrity"));
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText(/Refused at the integrity check/)).toBeTruthy();
  });
});

describe("a rebuild that set files aside says so (adoption review 2026-09-05, #2)", () => {
  it("lists each quarantined file with its reason, beside the tally", async () => {
    const job = rebuildJob({
      result: {
        tally: [],
        regressions: [],
        quarantined: [{ file: "scan.pdf", reason: "⚠️ skipped (RuntimeError: xref missing)", moved_to: "/ws/statements/_quarantine/x/scan.pdf" }],
      },
    });
    vi.stubGlobal("fetch", mockFetch((url) => (url.startsWith("/api/jobs") ? job : {})));
    show();
    fireEvent.click(screen.getByText("Rebuild"));
    await waitFor(() => expect(screen.getByText(/1 file\(s\) could not be read and were set aside/)).toBeTruthy());
    expect(screen.getByText("scan.pdf")).toBeTruthy();
    expect(screen.getByText(/xref missing/)).toBeTruthy();
  });
});
