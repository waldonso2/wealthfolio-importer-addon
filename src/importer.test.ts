import type { ActivityImport, SymbolSearchResult } from "@wealthfolio/addon-sdk";
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
  runImport,
  selectCandidates,
  type ActivitiesApi,
} from "./importer";
import type { ActivityImportEx, SecurityMapping } from "./types";

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
