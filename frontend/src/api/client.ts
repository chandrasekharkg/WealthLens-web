/**
 * Talking to the bridge.
 *
 * Types come from `types.ts`, which is generated from the bridge's own OpenAPI document — so a contract
 * change the UI has not adopted fails the build rather than rendering `undefined` in a dashboard.
 *
 * The session token is read from a meta tag the bridge puts in the page it serves. That is what makes it
 * unreadable to a script on another origin: the same-origin policy protects the document, so a foreign
 * page cannot fetch it, and without it no state-changing request is accepted.
 */
import type { components } from "./types";

export type NetWorth = components["schemas"]["NetWorth"];
export type Positions = components["schemas"]["Positions"];
export type Transactions = components["schemas"]["Transactions"];
export type TransactionRow = components["schemas"]["TransactionRow"];
export type Cards = components["schemas"]["Cards"];
export type CardRow = components["schemas"]["CardRow"];
export type CardStatements = components["schemas"]["CardStatements"];
export type CardStatement = components["schemas"]["CardStatement"];
export type CardStatementLine = components["schemas"]["CardStatementLine"];
export type CardBillPayments = components["schemas"]["CardBillPayments"];
export type CardBillPaymentRow = components["schemas"]["CardBillPaymentRow"];
export type HoldingDiary = components["schemas"]["HoldingDiary"];
export type DiaryLine = components["schemas"]["DiaryLine"];
export type Performance = components["schemas"]["Performance"];
export type Family = components["schemas"]["Family"];
export type FamilyMemberRow = components["schemas"]["FamilyMemberRow"];
export type FamilyTransfers = components["schemas"]["FamilyTransfers"];
export type TransferRow = components["schemas"]["TransferRow"];
export type Version = components["schemas"]["Version"];
export type Job = components["schemas"]["Job"];
export type Deposit = components["schemas"]["Deposit"];
export type EntityTotal = components["schemas"]["EntityTotal"];
export type Provenance = components["schemas"]["Provenance"];
export type Money = components["schemas"]["Money"];
export type WorkspaceDetail = components["schemas"]["WorkspaceDetail"];
export type DiagnoseBundle = components["schemas"]["DiagnoseBundle"];
export type Opened = components["schemas"]["Opened"];
export type SettingsInfo = components["schemas"]["SettingsInfo"];
export type Revealed = components["schemas"]["Revealed"];
export type SourceDetail = components["schemas"]["SourceDetail"];
export type DocumentInfo = components["schemas"]["DocumentInfo"];
export type SourceTableCount = components["schemas"]["SourceTableCount"];
export type Report = components["schemas"]["Report"];
export type ReportSummary = components["schemas"]["ReportSummary"];
export type ReportSection = components["schemas"]["ReportSection"];

/** How a collateral file was delivered: opened on the server's own desktop, or streamed to this browser
 * (the LAN case — the caller shows or saves `blob`). See `api.openDocument`. */
export type OpenResult =
  | { delivery: "opened"; path: string }
  | { delivery: "streamed"; blob: Blob; filename: string };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

// The token the bridge stamps into the served page. It is regenerated on every server process start, so a
// tab left open across a restart carries a DEAD token: reads still work (they need none), but the
// state-changing POSTs 403 with `reason: "token"`. `sessionToken` is an in-memory override that a mid-session
// refresh (below) fills in with the live token, so the app recovers those POSTs without a full page reload.
let sessionToken: string | null = null;

function metaToken(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="wlw-token"]')?.content ?? "";
}

function token(): string {
  return sessionToken ?? metaToken();
}

/** The bridge's "your token is stale" refusal — the one 403 that a reload (or the refresh below) fixes. Its
 * body is the middleware's `{error, reason}`, with `reason` at the top level (not FastAPI's nested shape). */
export function isSessionExpired(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    (error.detail as { reason?: unknown } | undefined)?.reason === "token"
  );
}

/** A short human reason from a failed call: the bridge's `detail.reason` when it sent one — at the top level
 * (the middleware's refusals) or nested (FastAPI's `HTTPException`) — else the bare error message. */
export function apiReason(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.detail as { reason?: unknown; detail?: { reason?: unknown } } | undefined;
    const reason = body?.reason ?? body?.detail?.reason;
    if (typeof reason === "string" && reason) return reason;
  }
  return error instanceof Error ? error.message : "";
}

/** Re-read the live token from the served page. The bridge stamps a NEW one per process, so after a restart
 * this is how a still-open tab learns the current token — without the household reloading. Returns the fresh
 * token, or null if it could not be read or has not changed (so a caller does not retry pointlessly). */
async function refreshToken(previous: string): Promise<string | null> {
  try {
    const response = await fetch("/", { headers: { "cache-control": "no-cache" } });
    if (!response.ok) return null;
    const html = await response.text();
    const fresh =
      new DOMParser()
        .parseFromString(html, "text/html")
        .querySelector<HTMLMetaElement>('meta[name="wlw-token"]')?.content ?? "";
    return fresh && fresh !== previous ? fresh : null;
  } catch {
    return null;
  }
}

/** The filename the bridge put in Content-Disposition — the RFC 5987 `filename*` first, then the quoted
 * ASCII fallback — so a streamed document keeps its real name when the browser saves it. */
function filenameFrom(response: Response): string | null {
  const cd = response.headers.get("content-disposition") ?? "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* a malformed encoding falls through to the plain form */
    }
  }
  return /filename="?([^";]+)"?/i.exec(cd)?.[1] ?? null;
}

async function rawRequest(path: string, init?: RequestInit): Promise<Response> {
  const attempt = (tok: string) =>
    fetch(path, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        // Only state-changing requests need it, but sending it always costs nothing and removes a class of
        // "why did that one fail" that a contributor would otherwise have to learn.
        "x-wlw-token": tok,
      },
    });

  let response = await attempt(token());
  // A stale token (the server restarted since this tab loaded) fails only the state-changing calls, with a
  // 403 whose reason is "token". Re-read the live token from the served page and retry once; only if that
  // cannot recover does the caller see the error.
  if (response.status === 403) {
    const body: unknown = await response.clone().json().catch(() => undefined);
    if ((body as { reason?: unknown } | undefined)?.reason === "token") {
      const fresh = await refreshToken(token());
      if (fresh) {
        sessionToken = fresh;
        response = await attempt(fresh);
      }
    }
  }
  return response;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await rawRequest(path, init);
  if (!response.ok) {
    const detail: unknown = await response.json().catch(() => undefined);
    throw new ApiError(`${init?.method ?? "GET"} ${path} failed`, response.status, detail);
  }
  return (await response.json()) as T;
}

const query = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams(
    Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])),
  ).toString();
  return search ? `?${search}` : "";
};

export const api = {
  version: () => request<Version>("/api/version"),
  netWorth: (on?: string) => request<NetWorth>(`/api/networth${query({ on })}`),
  reports: () => request<ReportSummary[]>("/api/reports"),
  report: (id: string, on?: string) => request<Report>(`/api/reports/${id}${query({ on })}`),
  positions: (on?: string) => request<Positions>(`/api/positions${query({ on })}`),
  transactions: (since?: string, until?: string) =>
    request<Transactions>(`/api/transactions${query({ since, until })}`),
  cards: () => request<Cards>("/api/cards"),
  cardBillPayments: () => request<CardBillPayments>("/api/card-bill-payments"),
  cardStatements: (entity: string, issuer: string) =>
    request<CardStatements>(`/api/cards/${entity}/${issuer}/statements`),
  cardStatement: (entity: string, issuer: string, period?: string) =>
    request<CardStatement>(`/api/cards/${entity}/${issuer}/statement${query({ period })}`),
  holdingDiary: (entity: string, instrument: string) =>
    request<HoldingDiary>(`/api/holdings/${entity}/${instrument}/diary`),
  /** The provenance behind one fact row's source_id — what the source popup shows (Primitive B). */
  source: (entity: string, sourceId: string) =>
    request<SourceDetail>(`/api/source/${entity}/${encodeURIComponent(sourceId)}`),
  performance: () => request<Performance>("/api/performance"),
  family: () => request<Family>("/api/family"),
  familyTransfers: (entity: string, person: string) =>
    request<FamilyTransfers>(`/api/family/${entity}/${person}/transfers`),
  job: (id: string) => request<Job>(`/api/jobs/${id}`),
  jobs: () => request<Job[]>("/api/jobs"),
  workspace: (entity: string) => request<WorkspaceDetail>(`/api/workspace/${entity}`),
  diagnose: (entity: string, filename: string) =>
    request<DiagnoseBundle>(`/api/workspace/${entity}/diagnose`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename }),
    }),
  /**
   * Open ONE collateral file — but WHERE the file ends up depends on where this browser is (the bridge
   * decides by the request's peer address, ADR-0001 carve-out):
   *
   * - on the SAME machine as the bridge, it asks the desktop OS to open the file and answers with JSON
   *   (`delivery: "opened"`) — nothing for the browser to do;
   * - across the LAN, it STREAMS the file back, because opening it on the server is not where the person
   *   is; the caller then hands `blob` to the browser to show or save (`delivery: "streamed"`).
   */
  openDocument: async (
    entity: string,
    doc: { payload_ref?: string | null; provider?: string | null; filename?: string | null },
  ): Promise<OpenResult> => {
    const response = await rawRequest(`/api/workspace/${entity}/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        payload_ref: doc.payload_ref ?? null,
        provider: doc.provider ?? null,
        filename: doc.filename ?? null,
      }),
    });
    if (!response.ok) {
      const detail: unknown = await response.json().catch(() => undefined);
      throw new ApiError(`POST /api/workspace/${entity}/open failed`, response.status, detail);
    }
    if ((response.headers.get("content-type") ?? "").includes("application/json")) {
      const opened = (await response.json()) as Opened;
      return { delivery: "opened", path: opened.path };
    }
    return {
      delivery: "streamed",
      blob: await response.blob(),
      filename: filenameFrom(response) ?? doc.filename ?? "document",
    };
  },
  /**
   * ONE re-obtainable secret, by name (ADR-0019). Its own call on purpose: a value must never be
   * reachable by asking for a list, and the store key has no equivalent at all.
   */
  reveal: (entity: string, what: string) =>
    request<Revealed>(`/api/workspace/${entity}/reveal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ what }),
    }),
  changeSettings: (entity: string, body: Record<string, unknown>) =>
    request<SettingsInfo>(`/api/workspace/${entity}/settings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  /** Promotion carries its review: which rebuild's tally was read, and the typed confirmation. */
  promote: (entity: string, review: { confirm: string; after?: string }) =>
    request<Job>("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ verb: "promote", entity, ...review }),
    }),
  startJob: (verb: string, entity: string) =>
    request<Job>("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ verb, entity }),
    }),
};
