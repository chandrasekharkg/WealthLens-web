import { describe, expect, it } from "vitest";

import type { DiaryLine } from "../api/client";
import { formatter } from "../i18n";
import { diaryMeaning, diaryMeaningText } from "./diaryMeaning";

const { t } = formatter();
const line = (over: Partial<DiaryLine>): DiaryLine => ({
  line_kind: "transaction", booked: false, needs_review: false, ...over,
});

describe("diaryMeaning", () => {
  it("reads the screenshot case — a bonus booked elsewhere — in plain language", () => {
    const m = diaryMeaning(line({ verdict: "superseded", description: "By Bonus Issue Issuer Instruction" }), t);
    expect(m.event).toMatch(/Bonus issue/);
    expect(m.event).toMatch(/no cost/);
    expect(m.status).toMatch(/already records it/); // the 'booked elsewhere' meaning
  });

  it("names the event from the description vocabulary, not the verdict", () => {
    expect(diaryMeaning(line({ description: "Sub-Division / Split of shares" }), t).event).toMatch(/Stock split/);
    expect(diaryMeaning(line({ description: "By Scheme of Amalgamation" }), t).event).toMatch(/Merger/);
    expect(diaryMeaning(line({ description: "Demerger of ABC Ltd" }), t).event).toMatch(/Demerger/);
    expect(diaryMeaning(line({ description: "Transmission on demise" }), t).event).toMatch(/Transmission/);
    expect(diaryMeaning(line({ role: "custody", description: "MP Accept CTRBO" }), t).event).toMatch(/Margin pledge/);
  });

  it("falls back cleanly — no event line when the description names nothing known", () => {
    expect(diaryMeaning(line({ verdict: "buy", description: "Some opaque code XYZ" }), t).event).toBeNull();
    expect(diaryMeaning(line({ verdict: "buy", description: "Some opaque code XYZ" }), t).status).toMatch(/came IN/);
  });

  it("explains status from the verdict/role, and joins to one string for a screen reader", () => {
    expect(diaryMeaning(line({ verdict: "custody", description: "Pledge" }), t).status).toMatch(/still belong to you/);
    expect(diaryMeaning(line({ line_kind: "balance" }), t).status).toMatch(/nothing moved/);
    expect(diaryMeaning(line({ needs_review: true }), t).status).toMatch(/couldn't fully classify/);
    const txt = diaryMeaningText(line({ verdict: "superseded", description: "By Bonus Issue" }), t);
    expect(txt).toMatch(/Bonus issue.*already records it/s);
  });
});
