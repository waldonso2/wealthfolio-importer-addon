import type { ActivityDetails, ActivityImport, SymbolSearchResult } from "@wealthfolio/addon-sdk";
import { describe, expect, it, vi } from "vitest";
import {
  activityStatus,
  applySecurityMappings,
  buildPayload,
  errorMessage,
  failedAsCsv,
  firstError,
  groupIdsByLine,
  importButtonLabel,
  keepExternal,
  matchExisting,
  accountsToMatch,
  findExistingMatches,
  runImport,
  selectCandidates,
  type ActivitiesApi,
} from "./importer";
import type { ActivityImportEx, SecurityMapping } from "./types";
import contract from "../contract/dedup/cases.json";

function act(overrides: Partial<ActivityImportEx>): ActivityImportEx {
  return {
    accountId: "portfolio",
    activityType: "BUY",
    date: "2024-01-01T10:00:00.000Z",
    symbol: "IE0001",
    symbolName: "Fund",
    quantity: "2",
    unitPrice: "100",
    amount: "201",
    fee: "1",
    currency: "EUR",
    comment: "c",
    isValid: true,
    isDraft: false,
    ...overrides,
  } as ActivityImportEx;
}

function fakeApi(fail: (payload: { comment?: string | null }) => unknown = () => undefined) {
  const create = vi.fn(async (p: { comment?: string | null }) => {
    const err = fail(p);
    if (err) throw err;
    return {};
  });
  const update = vi.fn(async (p: { comment?: string | null }) => {
    const err = fail(p);
    if (err) throw err;
    return {};
  });
  return { api: { create, update } as unknown as ActivitiesApi, create, update };
}

describe("activityStatus / firstError", () => {
  it("duplicate only when it exists in the DB; errors from isValid or errors", () => {
    expect(activityStatus(act({ duplicateOfId: "x" }) as ActivityImport)).toBe("duplicate");
    expect(activityStatus(act({ duplicateOfLineNumber: 3 }) as ActivityImport)).toBe("valid");
    expect(activityStatus(act({ isValid: false }) as ActivityImport)).toBe("error");
    const withError = act({ errors: { symbol: ["Could not find 'X' in market data"] } }) as ActivityImport;
    expect(activityStatus(withError)).toBe("error");
    expect(firstError(withError)).toBe("Could not find 'X' in market data");
  });
});

describe("applySecurityMappings", () => {
  const ticker = {
    symbol: "VWRL",
    canonicalSymbol: "VWRL.AS",
    shortName: "Vanguard FTSE All-World",
    exchangeMic: "XAMS",
    currency: "EUR",
    quoteType: "ETF",
    providerId: "YAHOO",
    providerSymbol: "VWRL.AS",
    existingAssetId: "asset-1",
  } as unknown as SymbolSearchResult;

  it("replaces the ISIN with the chosen ticker; cash rows untouched", () => {
    const [mapped, cashRow] = applySecurityMappings(
      [act({ instrumentType: "FUND" }), act({ symbol: "$CASH-EUR", activityType: "DEPOSIT" })],
      new Map<string, SecurityMapping>([["IE0001", ticker]]),
    );
    expect(mapped).toMatchObject({ symbol: "VWRL.AS", exchangeMic: "XAMS", instrumentType: "FUND", assetId: "asset-1" });
    expect(cashRow.symbol).toBe("$CASH-EUR");
  });

  it("custom equities become manually quoted - per ISIN, so dividends too; custom funds stay as they are", () => {
    const out = applySecurityMappings(
      [
        act({ symbol: "DE0001", instrumentType: "EQUITY" }),
        act({ symbol: "DE0001", activityType: "DIVIDEND", instrumentType: undefined }),
        act({ symbol: "IE0001", instrumentType: "FUND" }),
      ],
      new Map<string, SecurityMapping>([
        ["DE0001", "custom"],
        ["IE0001", "custom"],
      ]),
    );
    expect(out.map((a) => a.quoteMode)).toEqual(["MANUAL", "MANUAL", undefined]);
  });
});

describe("selectCandidates / groupIdsByLine", () => {
  it("drops errors and user-excluded duplicates, keeps other duplicates", () => {
    const checked = [
      act({ lineNumber: 1 }),
      act({ lineNumber: 2, duplicateOfId: "d2" }),
      act({ lineNumber: 3, duplicateOfId: "d3" }),
      act({ lineNumber: 4, isValid: false }),
    ] as ActivityImport[];
    const { candidates, userSkipped } = selectCandidates(checked, new Set([3]));
    expect(candidates.map((a) => a.lineNumber)).toEqual([1, 2]);
    expect(userSkipped).toBe(1);
    // Excluded new activities (already in Wealthfolio from another source) count as skipped too.
    expect(selectCandidates(checked, new Set([1, 3])).userSkipped).toBe(2);
  });

  it("maps lineNumber to transferGroupId from the transformer output", () => {
    const map = groupIdsByLine([
      act({ lineNumber: 1, transferGroupId: "buy-1" }),
      act({ lineNumber: 2, transferGroupId: "buy-1" }),
      act({ lineNumber: 3 }),
    ]);
    expect([...map]).toEqual([
      [1, "buy-1"],
      [2, "buy-1"],
    ]);
  });
});

describe("buildPayload", () => {
  it("create with every field incl. tax, quote mode and sourceGroupId", () => {
    const p = buildPayload(
      act({ activityType: "SELL", tax: "25.5", quoteMode: "MANUAL", subtype: undefined }) as ActivityImport,
      "sell-1",
    );
    expect(p.kind).toBe("create");
    expect(p.payload).toMatchObject({
      accountId: "portfolio",
      activityType: "SELL",
      activityDate: "2024-01-01T10:00:00.000Z",
      quantity: "2",
      unitPrice: "100",
      amount: "201",
      fee: "1",
      tax: "25.5",
      comment: "c",
      sourceGroupId: "sell-1",
      asset: { symbol: "IE0001", name: "Fund", quoteMode: "MANUAL" },
    });
  });

  it("update for an existing duplicate", () => {
    const p = buildPayload(act({ duplicateOfId: "dup-9" }) as ActivityImport, undefined);
    expect(p.kind).toBe("update");
    expect(p.payload).toMatchObject({ id: "dup-9", amount: "201" });
  });

  it("an external leg carries the flow flag, others no metadata", () => {
    const ext = buildPayload(act({ activityType: "TRANSFER_OUT", isExternal: true }) as ActivityImport, undefined);
    expect(ext.payload.metadata).toEqual({ flow: { is_external: true } });
    expect(buildPayload(act({ duplicateOfId: "d", isExternal: true }) as ActivityImport, undefined).payload.metadata).toEqual({
      flow: { is_external: true },
    });
    expect(buildPayload(act({}) as ActivityImport, undefined).payload).not.toHaveProperty("metadata");
  });

  it("keepExternal restores the flag checkImport dropped, by line", () => {
    const original = [act({ lineNumber: 1, isExternal: true }), act({ lineNumber: 2 })] as ActivityImport[];
    const checked = [act({ lineNumber: 2 }), act({ lineNumber: 1 })] as ActivityImport[];
    expect(keepExternal(checked, original).map((a) => [a.lineNumber, a.isExternal])).toEqual([
      [2, undefined],
      [1, true],
    ]);
  });

  it("no asset for rows without symbol", () => {
    const p = buildPayload(act({ symbol: "", activityType: "DEPOSIT" }) as ActivityImport, undefined);
    expect(p.payload.asset).toBeUndefined();
  });
});

describe("runImport", () => {
  const pair = [
    act({ lineNumber: 1, accountId: "cash", symbol: "$CASH-EUR", activityType: "TRANSFER_OUT", comment: "out" }),
    act({ lineNumber: 2, symbol: "$CASH-EUR", activityType: "TRANSFER_IN", comment: "in" }),
    act({ lineNumber: 3, comment: "buy", duplicateOfId: "existing" }),
  ] as ActivityImport[];
  const groups = new Map([
    [1, "buy-1"],
    [2, "buy-1"],
  ]);

  it("creates new, updates duplicates, passes sourceGroupId and reports progress", async () => {
    const { api, create, update } = fakeApi();
    const progress = vi.fn();
    const run = await runImport(api, pair, groups, progress);
    expect(run).toEqual({ imported: 3, updated: 1, failed: [] });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls.map((c) => (c[0] as { sourceGroupId?: string }).sourceGroupId)).toEqual(["buy-1", "buy-1"]);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: "existing" }));
    expect(progress).toHaveBeenLastCalledWith(3, 3);
  });

  it("collects failures with Wealthfolio's message and keeps going", async () => {
    const { api } = fakeApi((p) => (p.comment === "in" ? new Error("Account not found") : undefined));
    const run = await runImport(api, pair, groups);
    expect(run.imported).toBe(2);
    expect(run.failed).toEqual([{ activity: pair[1], error: "Account not found" }]);
  });

  it("a retry sends only the failed activities, with their sourceGroupId", async () => {
    let broken = true;
    const { api, create } = fakeApi((p) => (broken && p.comment === "in" ? "boom" : undefined));
    const first = await runImport(api, pair, groups);
    expect(first.failed.map((f) => f.error)).toEqual(["boom"]);

    broken = false;
    create.mockClear();
    const retry = await runImport(api, first.failed.map((f) => f.activity), groups);
    expect(retry).toEqual({ imported: 1, updated: 0, failed: [] });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ comment: "in", sourceGroupId: "buy-1" });
  });
});

describe("matchExisting", () => {
  const existing = (o: Partial<ActivityDetails>): ActivityDetails =>
    ({
      id: "e1",
      activityType: "BUY",
      date: new Date("2024-01-01T08:30:00.000Z"),
      quantity: "2",
      unitPrice: "100",
      amount: "201",
      fee: "1",
      currency: "EUR",
      accountId: "portfolio",
      assetId: "asset-1",
      assetSymbol: "IE0001",
      comment: "Fund [12:00:00.000]",
      ...o,
    }) as ActivityDetails;
  // A PDF buy: funding pair (lines 1, 2) and the BUY (line 3), one group.
  const pdfBuy = [
    act({ lineNumber: 1, accountId: "cash", symbol: "$CASH-EUR", activityType: "TRANSFER_OUT", date: "2024-01-01T09:59:58.000Z" }),
    act({ lineNumber: 2, symbol: "$CASH-EUR", activityType: "TRANSFER_IN", date: "2024-01-01T09:59:59.000Z" }),
    act({ lineNumber: 3, comment: "Kauf Fund [PDF a-1]" }),
  ] as ActivityImport[];
  // As produced: only the transfer legs carry the group id.
  const groups = new Map([
    [1, "pdf-tr-a-1"],
    [2, "pdf-tr-a-1"],
  ]);

  it("a trade already imported from the CSV matches with its transfer legs", () => {
    const m = matchExisting(pdfBuy, [existing({})], groups);
    expect([...m.keys()].sort()).toEqual([1, 2, 3]);
    expect(m.get(1)).toEqual([1, 2, 3]);
    expect(accountsToMatch(pdfBuy)).toEqual(["portfolio"]);
  });

  it("no match for another day, other shares, another amount or account", () => {
    for (const o of [
      { date: new Date("2024-01-03T10:00:00.000Z") },
      { quantity: "3" },
      { amount: "250" },
      { accountId: "other" },
    ]) {
      expect(matchExisting(pdfBuy, [existing(o)], groups).size).toBe(0);
    }
  });

  it("matches by asset id when the symbol differs (mapped ticker)", () => {
    const mapped = pdfBuy.map((a) => (a.lineNumber === 3 ? { ...a, symbol: "VWRL.AS", assetId: "asset-1" } : a));
    expect(matchExisting(mapped, [existing({})], groups).size).toBe(3);
  });

  it("dividends match on amount whatever the quantity; one existing activity matches once", () => {
    const divs = [
      act({ lineNumber: 1, activityType: "DIVIDEND", quantity: "16", amount: "19.14", date: "2024-03-01T11:00:00.000Z" }),
      act({ lineNumber: 2, activityType: "DIVIDEND", quantity: "16", amount: "19.14", date: "2024-03-01T11:00:00.000Z" }),
    ] as ActivityImport[];
    const m = matchExisting(
      divs,
      [existing({ activityType: "DIVIDEND", quantity: "1", amount: "19.14", date: new Date("2024-03-01T07:00:00.000Z") })],
      new Map(),
    );
    expect([...m.keys()]).toEqual([1]);
  });

  it("a trade under another symbol matches (the sync books under the ISIN, an import under the ticker)", () => {
    expect(matchExisting(pdfBuy, [existing({ assetSymbol: "IE0002", assetId: "asset-2" })], groups).size).toBe(3);
  });

  it("cash activities booked by the sync service are recognised (#65)", () => {
    const csv = [
      act({ lineNumber: 1, accountId: "cash", symbol: "$CASH-EUR", activityType: "DEPOSIT", amount: "500", date: "2024-02-01T09:00:00.000Z" }),
      act({ lineNumber: 2, accountId: "cash", symbol: "$CASH-EUR", activityType: "WITHDRAWAL", amount: "12.9", date: "2024-02-02T12:00:00.000Z" }),
      act({ lineNumber: 3, accountId: "cash", symbol: "$CASH-EUR", activityType: "WITHDRAWAL", amount: "12.9", date: "2024-02-02T18:00:00.000Z" }),
      act({ lineNumber: 4, accountId: "cash", symbol: "$CASH-EUR", activityType: "INTEREST", amount: "3.21", date: "2024-02-03T00:00:00.000Z" }),
    ] as ActivityImport[];
    const synced = [
      existing({ id: "s1", accountId: "cash", activityType: "DEPOSIT", amount: "500", quantity: "1", unitPrice: "1", assetId: "", assetSymbol: "", date: new Date("2024-02-01T08:00:00.000Z"), comment: "Einzahlung [SYNC tr:a]" }),
      existing({ id: "s2", accountId: "cash", activityType: "WITHDRAWAL", amount: "12.9", quantity: "1", unitPrice: "1", assetId: "", assetSymbol: "", date: new Date("2024-02-02T12:00:00.000Z"), comment: "Karte [SYNC tr:b]" }),
      existing({ id: "s3", accountId: "cash", activityType: "INTEREST", amount: "3.21", quantity: "1", unitPrice: "1", assetId: "", assetSymbol: "", date: new Date("2024-02-02T22:00:00.000Z"), comment: "Zinsen [SYNC tr:c]" }),
    ];
    const m = matchExisting(csv, synced, new Map());
    // The second card payment of 12.90 is new: only one is in Wealthfolio.
    expect([...m.keys()].sort()).toEqual([1, 2, 4]);
    expect(m.get(2)).toEqual([2]);
    expect(accountsToMatch(csv)).toEqual(["cash"]);
  });

  it("leaves checkImport duplicates and the activity they point to alone", () => {
    const again = pdfBuy.map((a) => (a.lineNumber === 3 ? { ...a, duplicateOfId: "e1" } : a));
    expect(matchExisting(again, [existing({})], groups).size).toBe(0);
  });
});

describe("importButtonLabel", () => {
  it("counts updated duplicates separately from new activities", () => {
    expect(importButtonLabel(5, 0)).toBe("Import 5 activities");
    expect(importButtonLabel(1, 0)).toBe("Import 1 activity");
    expect(importButtonLabel(0, 6)).toBe("Update 6 existing");
    expect(importButtonLabel(3, 6)).toBe("Import 3 new · update 6 existing");
  });
});

describe("errorMessage / failedAsCsv", () => {
  it("turns any thrown value into text", () => {
    expect(errorMessage(new Error("x"))).toBe("x");
    expect(errorMessage("y")).toBe("y");
    expect(errorMessage({ code: 1 })).toBe('{"code":1}');
  });

  it("CSV with header and quoted fields", () => {
    const csv = failedAsCsv(
      [{ activity: act({ comment: 'Fund, "Acc"', accountId: "portfolio" }) as ActivityImport, error: "bad" }],
      (id) => (id === "portfolio" ? "TR Portfolio" : id),
    );
    expect(csv.split("\n")).toEqual([
      "date,account,type,symbol,quantity,amount,currency,comment,error",
      '2024-01-01T10:00:00,TR Portfolio,BUY,IE0001,2,201,EUR,"Fund, ""Acc""",bad',
    ]);
  });
});

// The cases shared with the Wealthfolio Broker Sync service (its dedup.ExistingIndex): both must recognise the
// same activities as already in Wealthfolio. The service's copy of contract/dedup/cases.json is the leading one.
describe("shared duplicate-detection cases", () => {
  for (const c of contract.cases) {
    it(c.name, () => {
      const incoming = c.incoming.map((a) => ({ ...a, key: a.line }));
      const found = findExistingMatches(incoming, c.existing);
      const got = Object.fromEntries(c.incoming.map((a) => [String(a.line), found.get(a.line) ?? null]));
      expect(got).toEqual(c.expect);
    });
  }
});

describe("findExistingMatches looks only at the time window", () => {
  const dep = (id: string, date: string, amount: string) => ({
    id,
    accountId: "c",
    activityType: "DEPOSIT",
    date,
    amount,
    currency: "EUR",
  });
  const inc = (key: number, date: string, amount: string) => ({
    key,
    accountId: "c",
    activityType: "DEPOSIT",
    date,
    amount,
    currency: "EUR",
  });

  it("keeps the 36-hour edge, the list order for ties, and undated activities", () => {
    const existing = [
      dep("late", "2026-05-02T12:00:00Z", "20"), // exactly 36 h after
      dep("tie-1", "2026-06-01T01:00:00Z", "30"),
      dep("tie-2", "2026-05-31T23:00:00Z", "30"), // as near, earlier in time, later in the list
      dep("undated", "not a date", "40"),
      dep("too-late", "2026-07-02T12:00:01Z", "50"),
    ];
    const found = findExistingMatches(
      [
        inc(1, "2026-05-01T00:00:00Z", "20"),
        inc(2, "2026-06-01T00:00:00Z", "30"),
        inc(3, "2026-08-01T00:00:00Z", "40"),
        inc(4, "2026-07-01T00:00:00Z", "50"),
      ],
      existing,
    );
    expect([...found]).toEqual([
      [1, "late"],
      [2, "tie-1"],
      [3, "undated"],
    ]);
  });
});
