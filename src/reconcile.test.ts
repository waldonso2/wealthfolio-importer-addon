import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { parseAndTransform } from "./formats";
import { cashDifference, cashEffect, reconcile } from "./reconcile";
import type { ActivityImportEx, AddonSettings } from "./types";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONFIG: AddonSettings = {
  cashAccountId: "cash",
  cashCurrency: "EUR",
  portfolioAccountId: "portfolio",
  scalableCashAccountId: "sc-cash",
  scalableCashCurrency: "EUR",
  scalablePortfolioAccountId: "sc-portfolio",
  dkbCashAccountId: "",
  dkbPortfolioAccountId: "",
  transferPatterns: [],
  securityMappings: {},
  securityNames: {},
};
const TR = { cashAccountId: "cash", portfolioAccountId: "portfolio" };

function act(overrides: Partial<ActivityImportEx>): ActivityImportEx {
  return {
    accountId: "portfolio",
    activityType: "BUY",
    date: "2024-01-01T10:00:00.000Z",
    symbol: "IE0001",
    symbolName: "Fund",
    quantity: "1",
    unitPrice: "1",
    amount: "1",
    currency: "EUR",
    isValid: true,
    isDraft: false,
    ...overrides,
  } as ActivityImportEx;
}
const cash = (accountId: string, activityType: string, amount: string, date = "2024-01-01T09:00:00.000Z") =>
  act({ accountId, activityType: activityType as ActivityImportEx["activityType"], symbol: "$CASH-EUR", amount, date });

describe("cashEffect", () => {
  it("follows Wealthfolio: amount is the cash flow, sign by type", () => {
    expect(cashEffect(act({ activityType: "SELL", amount: "293.5" }))).toBe(293.5);
    expect(cashEffect(act({ activityType: "BUY", amount: "201.5" }))).toBe(-201.5);
    expect(cashEffect(act({ activityType: "DIVIDEND", amount: "8", tax: "1" }))).toBe(8);
    expect(cashEffect(cash("cash", "TAX", "0.33"))).toBe(-0.33);
    expect(cashEffect(cash("cash", "TRANSFER_OUT", "100"))).toBe(-100);
  });

  it("security transfers, splits and dividends in kind move no cash", () => {
    expect(cashEffect(act({ activityType: "TRANSFER_IN", amount: "50" }))).toBe(0);
    expect(cashEffect(act({ activityType: "SPLIT", amount: "20" }))).toBe(0);
    expect(cashEffect(act({ activityType: "DIVIDEND", subtype: "DIVIDEND_IN_KIND", amount: "69.57" }))).toBe(0);
  });
});

describe("reconcile", () => {
  it("cash account balance, no cash left on the securities account", () => {
    const r = reconcile(
      [
        cash("cash", "DEPOSIT", "1000"),
        cash("cash", "TRANSFER_OUT", "201"),
        cash("portfolio", "TRANSFER_IN", "201"),
        act({ activityType: "BUY", quantity: "2", amount: "201" }),
      ],
      TR,
      { currency: "EUR", amount: 799 },
    );
    expect(r.cash).toEqual({ EUR: 799 });
    expect(r.portfolioCash).toEqual({});
    expect(r.holdings).toEqual([{ symbol: "IE0001", name: "Fund", quantity: 2 }]);
    expect(cashDifference(r)).toBe(0);
  });

  it("reports cash left on the securities account per currency", () => {
    const r = reconcile([act({ activityType: "DIVIDEND", amount: "10", currency: "USD" })], TR);
    expect(r.portfolioCash).toEqual({ USD: 10 });
  });

  it("reports the difference to the broker's balance", () => {
    const r = reconcile([cash("cash", "DEPOSIT", "100")], TR, { currency: "EUR", amount: 123.2 });
    expect(cashDifference(r)).toBeCloseTo(-23.2, 9);
  });

  it("holdings follow splits, dividends in kind, sells and security transfers", () => {
    const r = reconcile(
      [
        act({ activityType: "BUY", quantity: "1", date: "2024-01-01T10:00:00.000Z" }),
        act({ activityType: "SPLIT", amount: "20", quantity: undefined, date: "2024-02-01T10:00:00.000Z" }),
        act({ activityType: "DIVIDEND", subtype: "DIVIDEND_IN_KIND", quantity: "2", date: "2024-03-01T10:00:00.000Z" }),
        act({ activityType: "SELL", quantity: "-5", date: "2024-04-01T10:00:00.000Z" }),
        act({ activityType: "TRANSFER_OUT", quantity: "17", date: "2024-05-01T10:00:00.000Z" }),
        act({ activityType: "TRANSFER_IN", symbol: "IE0002", symbolName: "New Fund", quantity: "17", date: "2024-05-01T10:00:01.000Z" }),
      ],
      TR,
    );
    expect(r.holdings).toEqual([{ symbol: "IE0002", name: "New Fund", quantity: 17 }]);
    expect(r.negative).toEqual([]);
  });

  it("warns when a position goes negative, once per security", () => {
    const r = reconcile(
      [
        act({ activityType: "SELL", quantity: "3", date: "2024-01-01T10:00:00.000Z" }),
        act({ activityType: "SELL", quantity: "1", date: "2024-02-01T10:00:00.000Z" }),
      ],
      TR,
    );
    expect(r.negative).toEqual([{ symbol: "IE0001", name: "Fund", date: "2024-01-01", quantity: -3 }]);
  });
});

describe("fixtures: imported cash account vs. the broker's balance", () => {
  it("Trade Republic", () => {
    const csv = readFileSync(join(__dirname, "__fixtures__/tr-sample.csv"), "utf-8");
    const outcome = parseAndTransform(csv, CONFIG);
    if (!outcome.ok) throw new Error(outcome.error);
    const r = reconcile(outcome.result.activities, TR, outcome.brokerCash);
    expect(outcome.brokerCash?.currency).toBe("EUR");
    expect(cashDifference(r)).toBe(0);
    expect(r.portfolioCash).toEqual({});
    expect(r.negative).toEqual([]);
  });

  it("Scalable Capital", () => {
    const csv = readFileSync(join(__dirname, "__fixtures__/scalable-sample.csv"), "utf-8");
    const outcome = parseAndTransform(csv, CONFIG);
    if (!outcome.ok) throw new Error(outcome.error);
    const r = reconcile(
      outcome.result.activities,
      { cashAccountId: "sc-cash", portfolioAccountId: "sc-portfolio" },
      outcome.brokerCash,
    );
    // The fixture's unsupported row (UNKNOWN_TYPE, Wert 1) is not imported, so
    // the imported cash is exactly that 1 EUR short - which the check must show.
    expect(outcome.result.skipped.filter((x) => x.kind === "missing").map((x) => x.type)).toEqual(["UNKNOWN_TYPE"]);
    expect(cashDifference(r)).toBeCloseTo(-1, 9);
    expect(r.portfolioCash).toEqual({});
    expect(r.holdings).toEqual([{ symbol: "IE00TEST0001", name: "Test World ETF (Dist)", quantity: 10 }]);
    expect(r.negative).toEqual([]);
  });
});
