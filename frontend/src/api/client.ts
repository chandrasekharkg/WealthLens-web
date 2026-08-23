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
export type Cards = components["schemas"]["Cards"];
export type CardRow = components["schemas"]["CardRow"];
export type CardStatements = components["schemas"]["CardStatements"];
export type CardStatement = components["schemas"]["CardStatement"];
export type CardStatementLine = components["schemas"]["CardStatementLine"];
export type Version = components["schemas"]["Version"];
export type Job = components["schemas"]["Job"];
export type Deposit = components["schemas"]["Deposit"];
export type EntityTotal = components["schemas"]["EntityTotal"];
export type Provenance = components["schemas"]["Provenance"];
export type Money = components["schemas"]["Money"];
export type WorkspaceDetail = components["schemas"]["WorkspaceDetail"];
export type Opened = components["schemas"]["Opened"];
export type SettingsInfo = components["schemas"]["SettingsInfo"];
export type Revealed = components["schemas"]["Revealed"];
export type Report = components["schemas"]["Report"];
export type ReportSummary = components["schemas"]["ReportSummary"];
export type ReportSection = components["schemas"]["ReportSection"];

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

function token(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="wlw-token"]')?.content ?? "";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      // Only state-changing requests need it, but sending it always costs nothing and removes a class of
      // "why did that one fail" that a contributor would otherwise have to learn.
      "x-wlw-token": token(),
    },
  });
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
  cardStatements: (entity: string, issuer: string) =>
    request<CardStatements>(`/api/cards/${entity}/${issuer}/statements`),
  cardStatement: (entity: string, issuer: string, period?: string) =>
    request<CardStatement>(`/api/cards/${entity}/${issuer}/statement${query({ period })}`),
  job: (id: string) => request<Job>(`/api/jobs/${id}`),
  jobs: () => request<Job[]>("/api/jobs"),
  workspace: (entity: string) => request<WorkspaceDetail>(`/api/workspace/${entity}`),
  openDocument: (
    entity: string,
    doc: { payload_ref?: string | null; provider?: string | null; filename?: string | null },
  ) =>
    request<Opened>(`/api/workspace/${entity}/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        payload_ref: doc.payload_ref ?? null,
        provider: doc.provider ?? null,
        filename: doc.filename ?? null,
      }),
    }),
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
