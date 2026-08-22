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
export type Version = components["schemas"]["Version"];
export type Job = components["schemas"]["Job"];
export type Deposit = components["schemas"]["Deposit"];
export type EntityTotal = components["schemas"]["EntityTotal"];
export type Provenance = components["schemas"]["Provenance"];
export type Money = components["schemas"]["Money"];

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
  positions: (on?: string) => request<Positions>(`/api/positions${query({ on })}`),
  transactions: (since?: string, until?: string) =>
    request<Transactions>(`/api/transactions${query({ since, until })}`),
  job: (id: string) => request<Job>(`/api/jobs/${id}`),
  startJob: (verb: string, entity: string) =>
    request<Job>("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ verb, entity }),
    }),
};
