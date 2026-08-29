import type { DiaryLine } from "../api/client";
import type { Formatter } from "../i18n";

/**
 * Plain-language explainer for one detailed-holding-diary line — the "what does this actually mean?" a
 * non-expert wants when they see a row like "Booked elsewhere · By Bonus Issue Issuer Instruction".
 *
 * Two layers, both anchored to the NSDL/CDSL vocabulary catalogued in WealthLens-core
 * `openspec/changes/reconcile-off-market-transfers/reason-codes.md`:
 *   1. STATUS — what this row's classification (its WLC `verdict`/`role`) means for the holding, and whether
 *      money or units actually moved. Driven by the authoritative verdict, so it is never a guess.
 *   2. EVENT — what the transaction TYPE is, read from the statement's own description words (bonus, split,
 *      merger, pledge, …). Best-effort keyword recognition: a miss simply omits this line, never a wrong
 *      claim — the status layer still stands on the verdict.
 *
 * This is EDUCATIONAL, not advice: it defines what a kind of transaction is, never what to do about it.
 * The English copy lives in the i18n catalog under `diary.mean.*`; keep it in step with reason-codes.md.
 */

export type DiaryMeaning = {
  /** Definition of the transaction TYPE, when the description names a known one. */
  readonly event: string | null;
  /** What this row's classification means for the holding — always present. */
  readonly status: string;
};

// Description words → an event key (i18n `diary.mean.event.<key>`). Order matters: the more specific /
// less ambiguous phrase wins, so a "merger" that also says "demerger" is read as a demerger first.
const EVENT_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/demerg/i, "demerger"],
  [/bonus/i, "bonus"],
  [/split|sub[-\s]?division|sub[-\s]?divide/i, "split"],
  [/amalgamat|\bmerg/i, "merger"],
  [/transmiss/i, "transmission"],
  [/\bgift/i, "gift"],
  [/extinguish|ep-dr/i, "extinguishment"],
  [/redempt|redeem/i, "redemption"],
  [/margin|pledge|\bmp\b|\bmrp\b|ctrbo/i, "pledge"],
  [/edis/i, "edis"],
  [/off[-\s]?market|of-dr|of-cr/i, "offmarket"],
  [/allot|\bipo\b|public issue|rights issue/i, "allotment"],
];

function eventKey(description: string | null | undefined): string | null {
  const d = description ?? "";
  for (const [re, key] of EVENT_RULES) if (re.test(d)) return key;
  return null;
}

// The row's classification → a status key (i18n `diary.mean.status.<key>`). Leans on the WLC verdict/role,
// which is the authoritative read; the description is only used to pick the event line above.
function statusKey(line: DiaryLine): string {
  if (line.needs_review) return "review";
  const v = line.verdict;
  if (v === "superseded") return "superseded";
  if (v === "custody" || v === "pledge" || v === "settlement_leg") return "custody";
  if (v === "dividend") return "dividend";
  if (line.line_kind === "balance" || v === "balance") return "balance";
  if (line.role === "disclosure") return "disclosure";
  if (line.role === "unmapped" || line.role === "unchained") return "review";
  const IN = new Set(["buy", "transfer_in", "transmission_in", "bonus", "merge_in", "demerge_in", "split", "conversion"]);
  const OUT = new Set(["sell", "transfer_out", "transmission_out", "merge_out", "writeoff", "forfeit"]);
  if (v && IN.has(v)) return "in";
  if (v && OUT.has(v)) return "out";
  return "unknown";
}

/** Compose the plain-language meaning of a diary line. `t` resolves the catalog copy. */
export function diaryMeaning(line: DiaryLine, t: Formatter["t"]): DiaryMeaning {
  const sk = statusKey(line);
  // Only a real TRANSACTION line gets an event line. On a balance/confirmation or disclosure line the
  // description is the security's own NAME or fee metadata — and a post-split holding is literally named
  // "… AFTER SUB-DIVISION SHARES", a merged one "… AFTER AMALGAMATION". Reading that name as an EVENT would
  // put "Stock split" on a row whose status is "nothing moved" — a contradiction. So suppress it there.
  const ek = sk === "balance" || sk === "disclosure" ? null : eventKey(line.description);
  return {
    event: ek ? t(`diary.mean.event.${ek}` as "diary.mean.event.bonus") : null,
    status: t(`diary.mean.status.${sk}` as "diary.mean.status.in"),
  };
}

/** One-string form (event + status) — for a screen-reader label where the two-line card can't render. */
export function diaryMeaningText(line: DiaryLine, t: Formatter["t"]): string {
  const m = diaryMeaning(line, t);
  return m.event ? `${m.event} ${m.status}` : m.status;
}
