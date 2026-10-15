import { describe, expect, it } from "vitest";
import type { ActivityImport } from "@wealthfolio/addon-sdk";
import { INITIAL, securitiesOf, wizard, type Action, type ImportOutcome, type Parsed, type WizardState } from "./wizard";

const parsed = (activities: Partial<ActivityImport>[] = []): Parsed => ({
  result: { activities: activities as ActivityImport[], skipped: [] } as unknown as Parsed["result"],
  format: "trade-republic",
  brokerCash: null,
  fileName: "export.csv",
  fromPdf: false,
});
const outcome = (over: Partial<ImportOutcome> = {}): ImportOutcome => ({
  total: 2,
  imported: 1,
  updated: 0,
  userSkipped: 0,
  failed: [],
  groupIdByLine: new Map(),
  ...over,
});
const run = (...actions: Action[]): WizardState => actions.reduce(wizard, INITIAL);
const checked: Action = {
  type: "checked",
  checked: [{ lineNumber: 1 }, { lineNumber: 2 }] as ActivityImport[],
  existing: new Map([[2, [2, 3]]]),
  checkError: "",
  matchError: "boom",
};

describe("wizard", () => {
  it("reading and fileError only set their text", () => {
    expect(run({ type: "reading", text: "Reading 2 PDFs" }).reading).toBe("Reading 2 PDFs");
    expect(run({ type: "fileError", error: { text: "bad" } }).fileError).toEqual({ text: "bad" });
    expect(run({ type: "fileError", error: { text: "bad" } }, { type: "fileError", error: null }).fileError).toBeNull();
  });

  it("a new file drops the previous file's review", () => {
    const before = run(
      { type: "parsed", parsed: parsed(), securities: [], mappings: new Map() },
      checked,
      { type: "toggleDuplicatesOnly" },
      { type: "fileError", error: { text: "x" } },
    );
    const s = wizard(before, { type: "parsed", parsed: parsed(), securities: [], mappings: new Map() });
    expect(s.checked).toBeNull();
    expect(s.excluded.size).toBe(0);
    expect(s.existing.size).toBe(0);
    expect(s.duplicatesOnly).toBe(false);
    expect(s.fileError).toBeNull();
  });

  it("review, mappings and checking move through the steps", () => {
    const m = new Map([["DE000A0D9PT0", { symbol: "MTX.DE" }]]) as never;
    expect(run({ type: "review" }).step).toBe("asset-review");
    expect(run({ type: "mappings", mappings: m }).mappings).toBe(m);
    expect(run({ type: "checking" }).step).toBe("checking");
  });

  it("checked goes to confirm and skips what is already in Wealthfolio", () => {
    const s = run(checked);
    expect(s.step).toBe("confirm");
    expect([...s.excluded]).toEqual([2]);
    expect(s.matchError).toBe("boom");
  });

  it("toggleLines skips lines, and includes them all again when all are skipped", () => {
    const s = run(checked, { type: "toggleLines", lines: [2, 3] });
    expect([...s.excluded].sort()).toEqual([2, 3]);
    expect(wizard(s, { type: "toggleLines", lines: [2, 3] }).excluded.size).toBe(0);
  });

  it("toggleDuplicatesOnly flips", () => {
    expect(run({ type: "toggleDuplicatesOnly" }).duplicatesOnly).toBe(true);
    expect(run({ type: "toggleDuplicatesOnly" }, { type: "toggleDuplicatesOnly" }).duplicatesOnly).toBe(false);
  });

  it("importing, progress and imported end on done", () => {
    let s = run(checked, { type: "importing" });
    expect([s.step, s.progress]).toEqual(["importing", 0]);
    s = wizard(s, { type: "progress", value: 50 });
    expect(s.progress).toBe(50);
    const o = outcome();
    s = wizard(s, { type: "imported", outcome: o });
    expect([s.step, s.progress, s.outcome]).toEqual(["done", 100, o]);
  });

  it("a failed import returns to confirm with the error", () => {
    const s = run(checked, { type: "importing" }, { type: "importFailed", error: "offline" });
    expect([s.step, s.checkError]).toEqual(["confirm", "offline"]);
  });

  it("retry keeps the old outcome when the retry produced none", () => {
    const o = outcome({ failed: [{ activity: {} as ActivityImport, error: "x" }] as never });
    let s = run({ type: "imported", outcome: o }, { type: "retrying" });
    expect(s.retrying).toBe(true);
    s = wizard(s, { type: "retried", outcome: null });
    expect([s.retrying, s.outcome]).toEqual([false, o]);
    const next = outcome({ imported: 2 });
    expect(wizard(s, { type: "retried", outcome: next }).outcome).toBe(next);
  });

  it("back to upload keeps the file, back from review depends on securities", () => {
    const p = parsed();
    const s = run({ type: "parsed", parsed: p, securities: [], mappings: new Map() }, checked, { type: "backToUpload" });
    expect([s.step, s.parsed, s.checked]).toEqual(["upload", p, null]);
    expect(wizard(s, { type: "backFromReview" }).step).toBe("upload");
    const withSecurities = run({
      type: "parsed",
      parsed: p,
      securities: [{ isin: "US0378331005", name: "Apple", count: 1 }],
      mappings: new Map(),
    });
    expect(wizard(withSecurities, { type: "backFromReview" }).step).toBe("asset-review");
  });

  it("reset starts over", () => {
    expect(run(checked, { type: "reset" })).toBe(INITIAL);
  });
});

describe("securitiesOf", () => {
  it("counts each security, keeps the latest name and leaves out cash", () => {
    const p = parsed([
      { symbol: "US0378331005", symbolName: "Apple Old" },
      { symbol: "$CASH-EUR" },
      { symbol: "US0378331005", symbolName: "Apple" },
      { symbol: "" },
    ]);
    expect(securitiesOf(p.result)).toEqual([{ isin: "US0378331005", name: "Apple", count: 2 }]);
  });
});
