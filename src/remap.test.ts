import type { ActivityDetails, SymbolSearchResult } from "@wealthfolio/addon-sdk";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./settings";
import {
  activitiesOnMapping,
  likelyOfSecurity,
  mappingAsset,
  mappingWarning,
  remapActivities,
  remapPayload,
  rememberNames,
} from "./remap";

// Fabricated products: a 3x ETP booked onto the asset of a 2x one by mistake (#41).
const ISIN_3X = "IE00TEST3X01";
const ISIN_2X = "JE00TEST2X02";
const NAME_3X = "TEST Crude Oil 3x Daily Leveraged";

function ticker(overrides: Partial<SymbolSearchResult>): SymbolSearchResult {
  return {
    exchange: "XETRA",
    shortName: "TEST Crude Oil 2x Daily Leveraged",
    longName: "TEST Crude Oil 2x Daily Leveraged",
    quoteType: "ETF",
    symbol: ISIN_2X,
    index: "",
    score: 1,
    typeDisplay: "ETF",
    ...overrides,
  } as SymbolSearchResult;
}

function activity(overrides: Partial<ActivityDetails>): ActivityDetails {
  return {
    id: "a",
    activityType: "BUY",
    date: new Date("2026-03-02T10:00:00Z"),
    quantity: "101",
    unitPrice: "10",
    amount: "1011",
    fee: "1",
    tax: null,
    currency: "EUR",
    needsReview: false,
    comment: `${NAME_3X} [10:00:00.000]`,
    createdAt: new Date(),
    updatedAt: new Date(),
    assetId: "asset-2x",
    accountId: "tr-depot",
    accountName: "TR Depot",
    accountCurrency: "EUR",
    assetSymbol: ISIN_2X,
    ...overrides,
  } as ActivityDetails;
}

describe("mappingWarning", () => {
  it("warns about another ISIN, another leverage or direction", () => {
    expect(mappingWarning(ISIN_3X, NAME_3X, ticker({}))).toBe(`mapped to another ISIN (${ISIN_2X})`);
    const other = ticker({ symbol: "OIL2", existingAssetId: "asset-2x" });
    expect(mappingWarning(ISIN_3X, NAME_3X, other)).toBe("leverage differs (3x here, 2x at OIL2)");
    const short = ticker({ symbol: "OIL3S", shortName: "TEST Crude Oil 3x Short", longName: "" });
    expect(mappingWarning(ISIN_3X, NAME_3X, short)).toBe("long/short differs from TEST Crude Oil 3x Short");
  });

  it("is quiet for a plausible mapping, custom, or no name", () => {
    const right = ticker({ symbol: "OIL3", shortName: "TEST Crude Oil 3x Daily Leveraged", longName: "" });
    expect(mappingWarning(ISIN_3X, NAME_3X, right)).toBeNull();
    expect(mappingWarning(ISIN_3X, NAME_3X, "custom")).toBeNull();
    expect(mappingWarning(ISIN_3X, NAME_3X, undefined)).toBeNull();
    expect(mappingWarning("IE00B4L5Y983", "", ticker({ symbol: "EUNL", shortName: "iShares Core MSCI World" }))).toBeNull();
    // The same ISIN as symbol is the custom-like mapping of the security itself.
    expect(mappingWarning(ISIN_2X, "", ticker({}))).toBeNull();
  });
});

describe("activities on a mapping", () => {
  const wrong = ticker({ existingAssetId: "asset-2x" });
  const activities = [
    activity({ id: "buy-3x" }),
    activity({ id: "sell-3x", activityType: "SELL", date: new Date("2026-03-09T10:00:00Z") }),
    activity({ id: "old-2x", date: new Date("2021-05-01T10:00:00Z"), comment: "TEST Crude Oil 2x [..]" }),
    activity({ id: "cash-leg", activityType: "TRANSFER_IN", assetId: "", assetSymbol: "" }),
    activity({ id: "other-account", accountId: "elsewhere" }),
    activity({ id: "other-asset", assetId: "asset-x", assetSymbol: "XYZ" }),
  ];

  it("finds the activities on the mapped asset in the securities accounts, oldest first", () => {
    const found = activitiesOnMapping(activities, ISIN_3X, wrong, ["tr-depot"]);
    expect(found.map((a) => a.id)).toEqual(["old-2x", "buy-3x", "sell-3x"]);
    // Preselected: the ones whose comment names the security of this ISIN.
    expect(found.filter((a) => likelyOfSecurity(a, NAME_3X)).map((a) => a.id)).toEqual(["buy-3x", "sell-3x"]);
    expect(found.filter((a) => likelyOfSecurity(a, "")).length).toBe(0);
  });

  it("finds a custom mapping by the ISIN as symbol", () => {
    const custom = [activity({ id: "c", assetId: "x1", assetSymbol: ISIN_3X })];
    expect(activitiesOnMapping(custom, ISIN_3X, "custom", ["tr-depot"]).map((a) => a.id)).toEqual(["c"]);
  });
});

describe("moving activities", () => {
  const right = ticker({ symbol: "OIL3", shortName: "TEST Crude Oil 3x", existingAssetId: "asset-3x" });

  it("keeps everything but the asset", () => {
    const p = remapPayload(activity({ id: "buy-3x" }), mappingAsset(ISIN_3X, NAME_3X, right));
    expect(p).toMatchObject({
      id: "buy-3x",
      accountId: "tr-depot",
      activityType: "BUY",
      activityDate: "2026-03-02T10:00:00.000Z",
      quantity: "101",
      amount: "1011",
      fee: "1",
      comment: `${NAME_3X} [10:00:00.000]`,
      asset: { id: "asset-3x", symbol: "OIL3", name: "TEST Crude Oil 3x" },
    });
    expect(mappingAsset(ISIN_3X, NAME_3X, "custom")).toEqual({ symbol: ISIN_3X, name: NAME_3X });
  });

  it("moves one at a time and collects failures", async () => {
    const update = vi.fn(async (p: { id: string }) => {
      if (p.id === "bad") throw new Error("Record not found");
      return {};
    });
    const progress = vi.fn();
    const run = await remapActivities(
      { update } as never,
      [activity({ id: "ok" }), activity({ id: "bad" })],
      mappingAsset(ISIN_3X, NAME_3X, right),
      progress,
    );
    expect(run.moved).toBe(1);
    expect(run.failed.map((f) => [f.activity.id, f.error])).toEqual([["bad", "Record not found"]]);
    expect(progress).toHaveBeenLastCalledWith(2, 2);
  });
});

describe("rememberNames", () => {
  it("adds the file's names and keeps the others", () => {
    const settings = { ...DEFAULT_SETTINGS, securityNames: { OLD: "Old name" } };
    expect(rememberNames(settings, [{ isin: ISIN_3X, name: NAME_3X }, { isin: "NONAME", name: "" }])).toEqual({
      OLD: "Old name",
      [ISIN_3X]: NAME_3X,
    });
  });
});
