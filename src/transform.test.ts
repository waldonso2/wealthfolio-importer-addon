import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { isCashSymbol } from "./common";
import { transform } from "./transform";
import type { AddonSettings, TrRow } from "./types";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONFIG: AddonSettings = {
  cashAccountId: "cash",
  cashCurrency: "EUR",
  portfolioAccountId: "portfolio",
  scalableCashAccountId: "",
  scalableCashCurrency: "EUR",
  scalablePortfolioAccountId: "",
  dkbCashAccountId: "",
  dkbPortfolioAccountId: "",
  transferPatterns: [],
  securityMappings: {},
};

function row(overrides: Partial<TrRow>): TrRow {
  return {
    datetime: "2024-01-15T10:00:00.000Z",
    date: "2024-01-15",
    account_type: "",
    type: "",
    category: "",
    currency: "EUR",
    amount: "0",
    fee: "",
    tax: "",
    description: "desc",
    counterparty_name: "",
    counterparty_iban: "",
    symbol: "",
    name: "",
    shares: "",
    price: "",
    asset_class: "STOCK",
    transaction_id: "txn-001",
    original_amount: "",
    original_currency: "",
    fx_rate: "",
    mcc_code: "",
    ...overrides,
  };
}

describe("BUY", () => {
  it("produces TRANSFER_OUT cash, TRANSFER_IN portfolio, BUY", () => {
    const { activities, skipped } = transform(
      [
        row({
          category: "TRADING",
          type: "BUY",
          symbol: "AAPL",
          name: "Apple",
          shares: "2",
          price: "150",
          amount: "-300",
          fee: "-1",
        }),
      ],
      CONFIG,
    );

    expect(skipped).toHaveLength(0);
    expect(activities).toHaveLength(3);

    const [transferOut, transferIn, buy] = activities;
    expect(transferOut.activityType).toBe("TRANSFER_OUT");
    expect(transferOut.accountId).toBe("cash");
    expect(transferOut.amount).toBe("301"); // 300 + 1 fee

    expect(transferIn.activityType).toBe("TRANSFER_IN");
    expect(transferIn.accountId).toBe("portfolio");

    // Both legs share a transferGroupId so Wealthfolio excludes the pair from spending.
    expect(transferOut.transferGroupId).toBeTruthy();
    expect(transferOut.transferGroupId).toBe(transferIn.transferGroupId);

    expect(buy.activityType).toBe("BUY");
    expect(buy.accountId).toBe("portfolio");
    expect(buy.symbol).toBe("AAPL");
    expect(buy.fee).toBe("1");
    // exact final cash (2 × 150 + 1), so checkImport can match re-imports
    expect(buy.amount).toBe("301");
    expect(buy.isDraft).toBe(false);
  });

  it("stockperk-funded BUY produces CREDIT + BUY without cash transfer", () => {
    const { activities, skipped } = transform(
      [
        row({
          category: "CASH",
          type: "STOCKPERK",
          symbol: "NVDA",
          amount: "-50",
          date: "2024-01-15",
          transaction_id: "stockperk-1",
        }),
        row({
          category: "TRADING",
          type: "BUY",
          symbol: "NVDA",
          name: "Nvidia",
          shares: "0.5",
          price: "100",
          amount: "-50",
          date: "2024-01-15",
          transaction_id: "buy-1",
        }),
      ],
      CONFIG,
    );

    expect(skipped).toHaveLength(0);
    expect(activities).toHaveLength(2);
    expect(activities.find((a) => a.activityType === "CREDIT")).toBeTruthy();
    expect(activities.find((a) => a.activityType === "BUY")).toBeTruthy();
    // No cash TRANSFER_OUT
    expect(activities.find((a) => a.activityType === "TRANSFER_OUT")).toBeUndefined();
  });
});

describe("SELL", () => {
  it("produces SELL, TRANSFER_OUT portfolio, TRANSFER_IN cash", () => {
    const { activities, skipped } = transform(
      [
        row({
          category: "TRADING",
          type: "SELL",
          symbol: "AAPL",
          name: "Apple",
          shares: "2",
          price: "160",
          amount: "320",
          fee: "-2",
        }),
      ],
      CONFIG,
    );

    expect(skipped).toHaveLength(0);
    expect(activities).toHaveLength(3);

    const sell = activities.find((a) => a.activityType === "SELL")!;
    expect(sell.accountId).toBe("portfolio");
    expect(sell.fee).toBe("2");
    // exact final cash (2 × 160 − 2), so checkImport can match re-imports
    expect(sell.amount).toBe("318");
    expect(sell.isDraft).toBe(false);

    const out = activities.find((a) => a.activityType === "TRANSFER_OUT")!;
    expect(out.accountId).toBe("portfolio");
    expect(out.amount).toBe("318"); // 320 - 2 fee

    const cashIn = activities.find((a) => a.activityType === "TRANSFER_IN")!;
    expect(cashIn.accountId).toBe("cash");

    expect(out.transferGroupId).toBeTruthy();
    expect(out.transferGroupId).toBe(cashIn.transferGroupId);
  });
});

describe("Fee and tax on trades", () => {
  it("SELL keeps fee and tax apart; amount is gross − fee − tax", () => {
    const { activities } = transform(
      [row({ category: "TRADING", type: "SELL", symbol: "AAPL", name: "Apple", shares: "-2", price: "160", amount: "320", fee: "-1", tax: "-25.5", transaction_id: "s1" })],
      CONFIG,
    );
    const sell = activities.find((a) => a.activityType === "SELL")!;
    expect(sell).toMatchObject({ fee: "1", tax: "25.5", amount: "293.5" });
    const out = activities.find((a) => a.activityType === "TRANSFER_OUT")!;
    expect(out.amount).toBe("293.5");
  });

  it("a SELL with a tax refund books a CREDIT/TAX_REFUND and sweeps it to cash", () => {
    const { activities } = transform(
      [row({ category: "TRADING", type: "SELL", symbol: "AAPL", name: "Apple", shares: "-2", price: "160", amount: "320", fee: "-1", tax: "12", transaction_id: "s2" })],
      CONFIG,
    );
    const sell = activities.find((a) => a.activityType === "SELL")!;
    expect(sell).toMatchObject({ fee: "1", amount: "319" });
    expect(sell.tax).toBeUndefined();
    expect(activities.find((a) => a.activityType === "CREDIT")).toMatchObject({ accountId: "portfolio", subtype: "TAX_REFUND", amount: "12" });
    expect(activities.find((a) => a.activityType === "TRANSFER_OUT")!.amount).toBe("331");
  });

  it("BUY keeps fee and tax apart; amount is gross + fee + tax", () => {
    const { activities } = transform(
      [row({ category: "TRADING", type: "BUY", symbol: "AAPL", name: "Apple", shares: "2", price: "100", amount: "-200", fee: "-1", tax: "-0.5", transaction_id: "b9" })],
      CONFIG,
    );
    const buy = activities.find((a) => a.activityType === "BUY")!;
    expect(buy).toMatchObject({ fee: "1", tax: "0.5", amount: "201.5" });
    expect(activities.find((a) => a.activityType === "TRANSFER_OUT")!.amount).toBe("201.5");
  });

  it("trades without tax are unchanged (fee and amount as before, no tax field)", () => {
    const { activities } = transform(
      [row({ category: "TRADING", type: "BUY", symbol: "AAPL", name: "Apple", shares: "2", price: "100", amount: "-200", fee: "-1", transaction_id: "b10" })],
      CONFIG,
    );
    const buy = activities.find((a) => a.activityType === "BUY")!;
    expect(buy).toMatchObject({ fee: "1", amount: "201" });
    expect(buy.tax).toBeUndefined();
  });
});

describe("DELIVERY", () => {
  it("FREE_RECEIPT produces a TRANSFER_IN to portfolio", () => {
    const { activities, skipped } = transform(
      [
        row({
          category: "DELIVERY",
          type: "FREE_RECEIPT",
          symbol: "AAPL",
          name: "Apple",
          shares: "5",
          price: "0",
        }),
      ],
      CONFIG,
    );

    expect(skipped).toHaveLength(0);
    expect(activities).toHaveLength(1);
    expect(activities[0].activityType).toBe("TRANSFER_IN");
    expect(activities[0].accountId).toBe("portfolio");
    expect(activities[0].isDraft).toBe(false);
  });

  it("MIGRATION is skipped", () => {
    const { activities, skipped } = transform(
      [row({ category: "DELIVERY", type: "MIGRATION", symbol: "OLD", name: "Old ISIN" })],
      CONFIG,
    );

    expect(activities).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].type).toBe("MIGRATION");
  });
});

describe("CASH deposits and withdrawals", () => {
  it("CUSTOMER_INBOUND → DEPOSIT", () => {
    const { activities } = transform(
      [
        row({
          category: "CASH",
          type: "CUSTOMER_INBOUND",
          amount: "500",
          counterparty_name: "Bank",
        }),
      ],
      CONFIG,
    );
    expect(activities).toHaveLength(1);
    expect(activities[0].activityType).toBe("DEPOSIT");
    expect(activities[0].amount).toBe("500");
    expect(activities[0].accountId).toBe("cash");
  });

  it("CUSTOMER_OUTBOUND_REQUEST → WITHDRAWAL", () => {
    const { activities } = transform(
      [row({ category: "CASH", type: "CUSTOMER_OUTBOUND_REQUEST", amount: "-200" })],
      CONFIG,
    );
    expect(activities).toHaveLength(1);
    expect(activities[0].activityType).toBe("WITHDRAWAL");
    expect(activities[0].amount).toBe("200");
  });

  it("CARD_TRANSACTION → WITHDRAWAL", () => {
    const { activities } = transform(
      [row({ category: "CASH", type: "CARD_TRANSACTION", amount: "-30", name: "Supermarket" })],
      CONFIG,
    );
    expect(activities).toHaveLength(1);
    expect(activities[0].activityType).toBe("WITHDRAWAL");
    expect(activities[0].amount).toBe("30");
  });

  it("CARD_TRANSACTION with positive amount → DEPOSIT (refund)", () => {
    const { activities } = transform(
      [row({ category: "CASH", type: "CARD_TRANSACTION", amount: "15", name: "Refund" })],
      CONFIG,
    );
    expect(activities[0].activityType).toBe("DEPOSIT");
  });
});

describe("DIVIDEND", () => {
  it("EUR dividend produces one DIVIDEND (net amount, tax field) + TRANSFER_OUT portfolio + TRANSFER_IN cash", () => {
    const { activities } = transform(
      [
        row({
          category: "CASH",
          type: "DIVIDEND",
          symbol: "AAPL",
          name: "Apple",
          shares: "10",
          amount: "9",
          tax: "-1",
          currency: "EUR",
        }),
      ],
      CONFIG,
    );

    expect(activities).toHaveLength(3);

    const div = activities.find((a) => a.activityType === "DIVIDEND")!;
    expect(div.accountId).toBe("portfolio");
    expect(div.comment).toContain("Dividend Apple");
    // Wealthfolio: amount = cash received, income = amount + tax
    expect(div.amount).toBe("8");
    expect(div.tax).toBe("1");
    expect(activities.find((a) => a.activityType === "TAX")).toBeUndefined();

    const out = activities.find((a) => a.activityType === "TRANSFER_OUT")!;
    expect(out.accountId).toBe("portfolio");
    expect(out.amount).toBe("8"); // netEur = absAmt(9) + taxAmt(-1)

    const cashIn = activities.find((a) => a.activityType === "TRANSFER_IN")!;
    expect(cashIn.accountId).toBe("cash");

    expect(out.transferGroupId).toBeTruthy();
    expect(out.transferGroupId).toBe(cashIn.transferGroupId);
  });

  it("foreign-currency dividend is booked in the payout currency, original amount in the comment", () => {
    const { activities } = transform(
      [
        row({
          category: "CASH",
          type: "DIVIDEND",
          symbol: "AAPL",
          name: "Apple",
          shares: "10",
          amount: "9", // EUR received
          tax: "-1", // EUR withheld
          currency: "EUR",
          original_amount: "10",
          original_currency: "USD",
          fx_rate: "0.9", // TR rate: 1 USD = 0.9 EUR → wf rate = 1/0.9
        }),
      ],
      CONFIG,
    );

    const div = activities.find((a) => a.activityType === "DIVIDEND")!;
    expect(div.currency).toBe("EUR");
    expect(div.amount).toBe("8");
    expect(div.tax).toBe("1");
    expect(div.fxRate).toBeUndefined();
    expect(div.comment).toContain("Dividend Apple (10 USD)");
  });

  it("leaves no cash on the portfolio account, in any currency", () => {
    const { activities } = transform(
      [
        row({
          category: "CASH",
          type: "DIVIDEND",
          symbol: "AAPL",
          name: "Apple",
          shares: "10",
          amount: "9",
          tax: "-1.35",
          original_amount: "10.50",
          original_currency: "USD",
          fx_rate: "0.857143",
        }),
      ],
      CONFIG,
    );
    const balance = new Map<string, number>();
    for (const a of activities.filter((x) => x.accountId === "portfolio")) {
      const sign = a.activityType === "DIVIDEND" || a.activityType === "TRANSFER_IN" ? 1 : -1;
      balance.set(a.currency!, (balance.get(a.currency!) ?? 0) + sign * Number(a.amount));
    }
    expect([...balance.keys()]).toEqual(["EUR"]);
    expect(balance.get("EUR")).toBeCloseTo(0, 9);
  });
});

describe("Dividend-like CASH types", () => {
  it("DISTRIBUTION is booked like a dividend (DIVIDEND + TAX + grouped transfer to cash)", () => {
    const { activities, skipped } = transform(
      [
        row({
          category: "CASH",
          type: "DISTRIBUTION",
          symbol: "IE00B3F81R35",
          name: "Example Bond (Dist)",
          shares: "10",
          amount: "2",
          tax: "-0.5",
          original_amount: "2.20",
          original_currency: "USD",
          fx_rate: "1.1",
          transaction_id: "d1",
        }),
      ],
      CONFIG,
    );
    expect(skipped).toHaveLength(0);
    expect(activities.map((a) => a.activityType).sort()).toEqual(["DIVIDEND", "TRANSFER_IN", "TRANSFER_OUT"]);
    const div = activities.find((a) => a.activityType === "DIVIDEND")!;
    expect(div.amount).toBe("1.5");
    expect(div.tax).toBe("0.5");
    expect(div.currency).toBe("EUR");
    expect(div.comment).toContain("Distribution Example Bond (Dist) (2.20 USD)");
    const out = activities.find((a) => a.activityType === "TRANSFER_OUT")!;
    const cashIn = activities.find((a) => a.activityType === "TRANSFER_IN")!;
    expect(out.amount).toBe("1.5");
    expect(cashIn.accountId).toBe("cash");
    expect(out.transferGroupId).toBe("div-d1");
    expect(cashIn.transferGroupId).toBe("div-d1");
  });

  it("EXCHANGE (cash from a share-exchange programme) is booked like a dividend", () => {
    const { activities } = transform(
      [row({ category: "CASH", type: "EXCHANGE", symbol: "NL0000000001", name: "Example NV", amount: "7", tax: "-1.84" })],
      CONFIG,
    );
    const div = activities.find((a) => a.activityType === "DIVIDEND")!;
    expect(div.amount).toBe("5.16");
    expect(div.tax).toBe("1.84");
    expect(div.comment).toContain("Exchange distribution Example NV");
    expect(activities.find((a) => a.activityType === "TRANSFER_IN")!.amount).toBe("5.16");
  });

  it("DIVIDEND comments are unchanged so earlier imports stay duplicates", () => {
    const { activities } = transform(
      [row({ category: "CASH", type: "DIVIDEND", symbol: "AAPL", name: "Apple", shares: "1", amount: "2", tax: "-1" })],
      CONFIG,
    );
    expect(activities.map((a) => a.comment?.replace(/ \[.*\]$/, "")).sort()).toEqual([
      "Dividend Apple",
      "Dividend Apple -> Cash",
      "Dividend Apple from Portfolio",
    ]);
  });
});

describe("Dividend corrections", () => {
  const div = (amount: string, tax: string, datetime: string, transaction_id: string) =>
    row({ category: "CASH", type: "DIVIDEND", symbol: "DE0001", name: "Example AG", shares: "25", amount, tax, datetime, date: datetime.slice(0, 10), transaction_id });

  it("a reversal cancels the closest matching dividend; the original stays booked", () => {
    const { activities, skipped } = transform(
      [
        div("385", "-101.54", "2025-05-13T09:44:22.000Z", "orig"),
        div("-385", "101.54", "2025-06-03T12:26:41.000Z", "rev"),
        div("385", "-101.54", "2025-06-03T12:47:54.000Z", "rebook"),
      ],
      CONFIG,
    );
    const dividends = activities.filter((a) => a.activityType === "DIVIDEND");
    expect(dividends).toHaveLength(1);
    expect(dividends[0].date).toBe("2025-05-13T09:44:22.000Z");
    expect(skipped.map((s) => [s.reason, s.kind])).toEqual([
      ["Reversal of the dividend of the same day; the two rows cancel out.", "netted"],
      ["Cancelled by the reversal of 2025-06-03; the two rows cancel out.", "netted"],
    ]);
  });

  it("a negative dividend without a matching partner is skipped, never booked as income", () => {
    const { activities, skipped } = transform([div("-23.2", "", "2025-03-26T16:01:14.000Z", "neg")], CONFIG);
    expect(activities).toHaveLength(0);
    expect(skipped[0]).toMatchObject({ kind: "missing" });
    expect(skipped[0].reason).toContain("Negative dividend of 23.2 EUR for Example AG");
    expect(skipped[0].hint).toContain("Trade Republic debited this amount");
  });
});

describe("Tax-only CASH types", () => {
  it.each(["EARNINGS", "PRE_DETERMINED_TAX_BASE"])("%s (Vorabpauschale) → TAX on cash", (type) => {
    const { activities } = transform(
      [row({ category: "CASH", type, symbol: "IE00BK5BQT80", name: "FTSE All-World", amount: "0", tax: "-0.33" })],
      CONFIG,
    );
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({ accountId: "cash", activityType: "TAX", amount: "0.33" });
    expect(activities[0].comment).toContain("Vorabpauschale");
    expect(activities[0].comment).toContain("IE00BK5BQT80");
  });

  it("TAX_OPTIMIZATION / SEC_ACCOUNT: negative → TAX, positive → CREDIT/TAX_REFUND", () => {
    const { activities } = transform(
      [
        row({ category: "CASH", type: "TAX_OPTIMIZATION", amount: "0", tax: "-452.54" }),
        row({ category: "CASH", type: "SEC_ACCOUNT", amount: "0", tax: "452.6", datetime: "2024-02-01T10:00:00.000Z" }),
      ],
      CONFIG,
    );
    expect(activities[0]).toMatchObject({ accountId: "cash", activityType: "TAX", amount: "452.54" });
    expect(activities[1]).toMatchObject({ accountId: "cash", activityType: "CREDIT", subtype: "TAX_REFUND", amount: "452.6" });
  });

  it("a tax-only row without cash effect is skipped", () => {
    const { activities, skipped } = transform([row({ category: "CASH", type: "EARNINGS", amount: "0", tax: "0" })], CONFIG);
    expect(activities).toHaveLength(0);
    expect(skipped[0].reason).toContain("no cash effect");
  });
});

describe("REFERRAL", () => {
  it("→ CREDIT with BONUS subtype to cash", () => {
    const { activities } = transform([row({ category: "CASH", type: "REFERRAL", amount: "50" })], CONFIG);
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({ accountId: "cash", activityType: "CREDIT", subtype: "BONUS", amount: "50" });
  });
});

describe("Corporate actions", () => {
  const buy = (overrides: Partial<TrRow>) =>
    row({ category: "TRADING", type: "BUY", symbol: "OLD1", name: "Old Co", asset_class: "STOCK", ...overrides });
  const action = (type: string, symbol: string, shares: string, overrides: Partial<TrRow> = {}) =>
    row({
      category: "CORPORATE_ACTION",
      type,
      symbol,
      name: symbol === "NEW1" ? "New Co" : "Old Co",
      shares,
      asset_class: "STOCK",
      currency: "",
      datetime: "2024-06-01T22:00:00.000Z",
      transaction_id: `${type}-${symbol}`,
      ...overrides,
    });

  it.each([
    ["SHARE_EXCHANGE", "Share exchange"],
    ["ADR_DISCONTINUATION", "ADR discontinuation"],
    ["REORGANISATION", "Reorganisation"],
  ])("%s → unpaired TRANSFER_OUT old ISIN + TRANSFER_IN new ISIN carrying the cost basis", (type, label) => {
    const { activities, skipped } = transform(
      [
        buy({ shares: "10", price: "10", amount: "-100", fee: "-1", transaction_id: "b1" }),
        action(type, "OLD1", "-10"),
        action(type, "NEW1", "10"),
      ],
      CONFIG,
    );
    expect(skipped).toHaveLength(0);
    const out = activities.find((a) => a.activityType === "TRANSFER_OUT" && a.symbol === "OLD1")!;
    const inn = activities.find((a) => a.activityType === "TRANSFER_IN" && a.symbol === "NEW1")!;
    expect(out).toMatchObject({ accountId: "portfolio", quantity: "10", unitPrice: "10.1", currency: "EUR" });
    expect(inn).toMatchObject({ accountId: "portfolio", quantity: "10", unitPrice: "10.1", symbolName: "New Co" });
    expect(out.comment).toContain(`${label}: OLD1 -> NEW1`);
    // different assets can't be a Wealthfolio transfer pair
    expect(out.transferGroupId).toBeUndefined();
    expect(inn.transferGroupId).toBeUndefined();
    expect(new Date(inn.date as string).getTime()).toBeGreaterThan(new Date(out.date as string).getTime());
  });

  it("REVERSE_SPLIT with a new ISIN spreads the cost basis over the new share count", () => {
    const { activities } = transform(
      [
        buy({ shares: "25000", price: "0.04", amount: "-1000", fee: "-1" }),
        action("REVERSE_SPLIT", "OLD1", "-25000"),
        action("REVERSE_SPLIT", "NEW1", "38.461538"),
      ],
      CONFIG,
    );
    const inn = activities.find((a) => a.activityType === "TRANSFER_IN" && a.symbol === "NEW1")!;
    expect(inn.quantity).toBe("38.461538");
    expect(Number(inn.quantity) * Number(inn.unitPrice)).toBeCloseTo(1001, 4);
  });

  it("cost basis follows FIFO after a partial sale, regardless of row order in the file", () => {
    const { activities } = transform(
      [
        action("SHARE_EXCHANGE", "NEW1", "5"),
        action("SHARE_EXCHANGE", "OLD1", "-5"),
        row({ category: "TRADING", type: "SELL", symbol: "OLD1", shares: "-5", price: "30", amount: "150", datetime: "2024-03-01T10:00:00.000Z" }),
        buy({ shares: "5", price: "20", amount: "-100", datetime: "2024-02-01T10:00:00.000Z" }),
        buy({ shares: "5", price: "10", amount: "-50", datetime: "2024-01-01T10:00:00.000Z" }),
      ],
      CONFIG,
    );
    // the 10 € lot was sold first, the 20 € lot is exchanged
    expect(activities.find((a) => a.activityType === "TRANSFER_IN" && a.symbol === "NEW1")!.unitPrice).toBe("20");
  });

  it("is skipped when the file doesn't hold the outgoing shares (cost basis unknown)", () => {
    const { activities, skipped } = transform(
      [buy({ shares: "4", price: "10", amount: "-40" }), action("SHARE_EXCHANGE", "OLD1", "-10"), action("SHARE_EXCHANGE", "NEW1", "10")],
      CONFIG,
    );
    expect(activities.filter((a) => a.activityType.startsWith("TRANSFER_") && a.symbol !== "$CASH-EUR")).toHaveLength(0);
    expect(skipped).toHaveLength(2);
    expect(skipped[0].reason).toContain("the cost basis is unknown because this file holds only 4 of the 10 exchanged shares");
    expect(skipped[0]).toMatchObject({ kind: "missing" });
    expect(skipped[0].hint).toContain("complete transaction history");
  });

  it("is skipped when the legs don't form one out/in pair", () => {
    const { skipped } = transform([buy({ shares: "10", price: "10", amount: "-100" }), action("SHARE_EXCHANGE", "OLD1", "-10")], CONFIG);
    expect(skipped[0].reason).toContain("expected one outgoing and one incoming ISIN at the same time, found 1 outgoing and 0 incoming");
  });

  it("WORTHLESS → SELL at 0 without a cash transfer", () => {
    const { activities } = transform(
      [buy({ shares: "15", price: "100", amount: "-1500" }), action("WORTHLESS", "OLD1", "-15")],
      CONFIG,
    );
    const sell = activities.find((a) => a.activityType === "SELL")!;
    expect(sell).toMatchObject({ symbol: "OLD1", quantity: "15", unitPrice: "0", fee: "0", amount: "0" });
    expect(sell.comment).toContain("written off as worthless");
    expect(activities.filter((a) => a.activityType === "TRANSFER_OUT")).toHaveLength(1); // only the BUY funding
  });

  it("SPLIT → Wealthfolio SPLIT with ratio (held + n) / held from the file", () => {
    const { activities } = transform(
      [buy({ shares: "1", price: "3000", amount: "-3000" }), action("SPLIT", "OLD1", "19")],
      CONFIG,
    );
    const split = activities.find((a) => a.activityType === "SPLIT")!;
    expect(split).toMatchObject({ accountId: "portfolio", symbol: "OLD1", amount: "20" });
    expect(split.comment).toContain("split 20:1 (1 -> 20 shares)");
  });

  it("the share count after a SPLIT feeds later corporate actions", () => {
    const { activities } = transform(
      [
        buy({ shares: "1", price: "100", amount: "-100" }),
        action("SPLIT", "OLD1", "19", { datetime: "2024-03-01T22:00:00.000Z" }),
        action("SHARE_EXCHANGE", "OLD1", "-20"),
        action("SHARE_EXCHANGE", "NEW1", "20"),
      ],
      CONFIG,
    );
    expect(activities.find((a) => a.activityType === "TRANSFER_IN" && a.symbol === "NEW1")!.unitPrice).toBe("5");
  });

  it("SPLIT without shares in the file is skipped with a hint", () => {
    const { skipped } = transform([action("SPLIT", "OLD1", "19")], CONFIG);
    expect(skipped[0]).toMatchObject({ kind: "missing" });
    expect(skipped[0].reason).toContain("split ratio can't be derived");
  });

  it("STOCK_DIVIDEND → DIVIDEND/DIVIDEND_IN_KIND; a later +n/-n rebooking cancels out", () => {
    const { activities, skipped } = transform(
      [
        action("STOCK_DIVIDEND", "OLD1", "58.98", { price: "1.1796", datetime: "2023-09-13T22:49:41.000Z", transaction_id: "sd1" }),
        action("STOCK_DIVIDEND", "OLD1", "58.98", { price: "1.1796", datetime: "2024-01-26T17:40:18.000Z", date: "2024-01-26", transaction_id: "sd2" }),
        action("STOCK_DIVIDEND", "OLD1", "-58.98", { price: "1.1796", datetime: "2024-01-26T22:45:48.000Z", date: "2024-01-26", transaction_id: "sd3" }),
      ],
      CONFIG,
    );
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      accountId: "portfolio",
      activityType: "DIVIDEND",
      subtype: "DIVIDEND_IN_KIND",
      symbol: "OLD1",
      quantity: "58.98",
      unitPrice: "1.1796",
      amount: "69.572808",
      date: "2023-09-13T22:49:41.000Z",
    });
    expect(skipped.map((s) => s.kind)).toEqual(["netted", "netted"]);
  });

  it("STOCK_DIVIDEND without a price is skipped with a hint", () => {
    const { skipped } = transform([action("STOCK_DIVIDEND", "OLD1", "5")], CONFIG);
    expect(skipped[0]).toMatchObject({ kind: "missing" });
    expect(skipped[0].reason).toContain("without a value per share");
  });

  it("DIVIDEND_REINVESTMENT + its negative DIVIDEND row → BUY funded from the cash account", () => {
    const { activities, skipped } = transform(
      [
        row({ category: "CASH", type: "DIVIDEND", symbol: "OLD1", name: "Old Co", shares: "70", amount: "23.21", tax: "-6.11", datetime: "2025-03-26T15:58:52.000Z", transaction_id: "cashdiv" }),
        action("DIVIDEND_REINVESTMENT", "OLD1", "0.726204", { datetime: "2025-03-26T16:00:56.000Z", transaction_id: "drip" }),
        row({ category: "CASH", type: "DIVIDEND", symbol: "OLD1", name: "Old Co", shares: "70", amount: "-23.2", datetime: "2025-03-26T16:01:14.000Z", transaction_id: "debit" }),
      ],
      CONFIG,
    );
    expect(skipped).toHaveLength(0);
    // the cash dividend is booked once as income
    expect(activities.filter((a) => a.activityType === "DIVIDEND")).toHaveLength(1);
    const buy = activities.find((a) => a.activityType === "BUY")!;
    expect(buy).toMatchObject({ accountId: "portfolio", symbol: "OLD1", quantity: "0.726204", fee: "0" });
    expect(Number(buy.amount)).toBeCloseTo(23.2, 8);
    const out = activities.find((a) => a.activityType === "TRANSFER_OUT" && a.accountId === "cash")!;
    const inn = activities.find((a) => a.activityType === "TRANSFER_IN" && a.accountId === "portfolio")!;
    expect(out).toMatchObject({ amount: "23.2", transferGroupId: "buy-drip" });
    expect(inn).toMatchObject({ amount: "23.2", transferGroupId: "buy-drip" });
  });

  it("DIVIDEND_REINVESTMENT without a cash debit is skipped with a hint", () => {
    const { skipped } = transform([action("DIVIDEND_REINVESTMENT", "OLD1", "0.5")], CONFIG);
    expect(skipped[0]).toMatchObject({ kind: "missing" });
    expect(skipped[0].hint).toContain("BUY");
  });

  it("other corporate actions are skipped as not imported, with the share change and a hint", () => {
    const { skipped } = transform([action("SPIN_OFF", "OLD1", "3")], CONFIG);
    expect(skipped[0]).toMatchObject({ kind: "missing" });
    expect(skipped[0].reason).toBe("Corporate action SPIN_OFF isn't supported yet, so Old Co wasn't changed (+3 shares).");
    expect(skipped[0].hint).toContain("Add the change manually");
  });
});

describe("INTEREST", () => {
  it("INTEREST_PAYMENT → one INTEREST with net amount and the withholding tax in the tax field", () => {
    const { activities } = transform(
      [row({ category: "CASH", type: "INTEREST_PAYMENT", amount: "5", tax: "-0.5" })],
      CONFIG,
    );
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({ accountId: "cash", activityType: "INTEREST", amount: "4.5", tax: "0.5" });
  });

  it("INTEREST_PAYMENT without tax has no tax field", () => {
    const { activities } = transform([row({ category: "CASH", type: "INTEREST_PAYMENT", amount: "5", tax: "0.00" })], CONFIG);
    expect(activities[0]).toMatchObject({ amount: "5" });
    expect(activities[0].tax).toBeUndefined();
  });
});

describe("Transfer patterns", () => {
  it("matched IBAN on TRANSFER_OUTBOUND produces TRANSFER_OUT (+ optional TRANSFER_IN)", () => {
    const config: AddonSettings = {
      ...CONFIG,
      transferPatterns: [
        { iban: "DE89370400440532013000", label: "Broker", destinationAccountId: "broker-acc" },
      ],
    };

    const { activities } = transform(
      [
        row({
          category: "CASH",
          type: "TRANSFER_OUTBOUND",
          amount: "-1000",
          counterparty_iban: "DE89370400440532013000",
        }),
      ],
      config,
    );

    expect(activities).toHaveLength(2);
    expect(activities[0].activityType).toBe("TRANSFER_OUT");
    expect(activities[0].accountId).toBe("cash");
    expect(activities[1].activityType).toBe("TRANSFER_IN");
    expect(activities[1].accountId).toBe("broker-acc");

    expect(activities[0].transferGroupId).toBeTruthy();
    expect(activities[0].transferGroupId).toBe(activities[1].transferGroupId);
  });

  it("unmatched TRANSFER_OUTBOUND → plain WITHDRAWAL", () => {
    const { activities } = transform(
      [row({ category: "CASH", type: "TRANSFER_OUTBOUND", amount: "-500" })],
      CONFIG,
    );
    expect(activities).toHaveLength(1);
    expect(activities[0].activityType).toBe("WITHDRAWAL");
  });

  it("keyword match on TRANSFER_OUTBOUND", () => {
    const config: AddonSettings = {
      ...CONFIG,
      transferPatterns: [{ keyword: "SALARY", label: "Employer" }],
    };
    const { activities } = transform(
      [
        row({
          category: "CASH",
          type: "TRANSFER_OUTBOUND",
          amount: "-100",
          description: "Monthly salary payment",
        }),
      ],
      config,
    );
    expect(activities[0].activityType).toBe("TRANSFER_OUT");
    expect(activities[0].comment).toContain("Employer");
  });

  it("matched pattern without destinationAccountId → lone TRANSFER_OUT, no group id", () => {
    const config: AddonSettings = {
      ...CONFIG,
      transferPatterns: [{ keyword: "SALARY", label: "Employer" }],
    };
    const { activities } = transform(
      [
        row({
          category: "CASH",
          type: "TRANSFER_OUTBOUND",
          amount: "-100",
          description: "Monthly salary payment",
        }),
      ],
      config,
    );
    expect(activities).toHaveLength(1);
    expect(activities[0].transferGroupId).toBeUndefined();
  });

  it("matched IBAN on CUSTOMER_OUTBOUND_REQUEST produces TRANSFER_OUT + TRANSFER_IN, grouped", () => {
    const config: AddonSettings = {
      ...CONFIG,
      transferPatterns: [
        { iban: "DE89370400440532013000", label: "Broker", destinationAccountId: "broker-acc" },
      ],
    };

    const { activities } = transform(
      [
        row({
          category: "CASH",
          type: "CUSTOMER_OUTBOUND_REQUEST",
          amount: "-1000",
          counterparty_iban: "DE89370400440532013000",
        }),
      ],
      config,
    );

    expect(activities).toHaveLength(2);
    expect(activities[0].activityType).toBe("TRANSFER_OUT");
    expect(activities[0].accountId).toBe("cash");
    expect(activities[1].activityType).toBe("TRANSFER_IN");
    expect(activities[1].accountId).toBe("broker-acc");
    expect(activities[0].transferGroupId).toBeTruthy();
    expect(activities[0].transferGroupId).toBe(activities[1].transferGroupId);
  });

  it("unmatched CUSTOMER_OUTBOUND_REQUEST → plain WITHDRAWAL (unchanged)", () => {
    const { activities } = transform(
      [row({ category: "CASH", type: "CUSTOMER_OUTBOUND_REQUEST", amount: "-200" })],
      CONFIG,
    );
    expect(activities).toHaveLength(1);
    expect(activities[0].activityType).toBe("WITHDRAWAL");
    expect(activities[0].amount).toBe("200");
  });
});

describe("Unknown types", () => {
  it("unknown CASH type goes to skipped", () => {
    const { activities, skipped } = transform(
      [row({ category: "CASH", type: "UNKNOWN_FUTURE_TYPE" })],
      CONFIG,
    );
    expect(activities).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ kind: "missing" });
    expect(skipped[0].reason).toContain("CASH/UNKNOWN_FUTURE_TYPE isn't supported yet");
    expect(skipped[0].hint).toContain("doesn't move cash");
  });

  it("an unknown CASH type that moved money says by how much", () => {
    const { skipped } = transform([row({ category: "CASH", type: "NEW_THING", amount: "-12.5", fee: "-1" })], CONFIG);
    expect(skipped[0].hint).toBe(
      "It changed your Trade Republic cash by -13.5 EUR. Add it manually in Wealthfolio and report the type so it can be supported.",
    );
  });

  it("unknown category goes to skipped", () => {
    const { activities, skipped } = transform(
      [row({ category: "UNKNOWN_CATEGORY", type: "SOMETHING" })],
      CONFIG,
    );
    expect(activities).toHaveLength(0);
    expect(skipped[0].reason).toContain("category UNKNOWN_CATEGORY/SOMETHING isn't supported yet");
  });
});

describe("Cash symbol", () => {
  it("cash activities use the configured cash currency and are recognised as cash", () => {
    const { activities } = transform(
      [row({ category: "CASH", type: "CUSTOMER_INBOUND", amount: "100", currency: "CHF" })],
      { ...CONFIG, cashCurrency: "CHF" },
    );
    expect(activities[0].symbol).toBe("$CASH-CHF");
    expect(isCashSymbol(activities[0].symbol)).toBe(true);
  });

  it("isCashSymbol rejects securities and empty values", () => {
    expect(isCashSymbol("$CASH-EUR")).toBe(true);
    expect(isCashSymbol("$CASH-USD")).toBe(true);
    expect(isCashSymbol("IE00BK5BQT80")).toBe(false);
    expect(isCashSymbol("")).toBe(false);
    expect(isCashSymbol(undefined)).toBe(false);
  });
});

describe("Output ordering", () => {
  it("activities are sorted by date ascending", () => {
    const { activities } = transform(
      [
        row({
          category: "CASH",
          type: "CUSTOMER_INBOUND",
          amount: "100",
          datetime: "2024-03-01T10:00:00.000Z",
        }),
        row({
          category: "CASH",
          type: "CUSTOMER_INBOUND",
          amount: "200",
          datetime: "2024-01-01T10:00:00.000Z",
        }),
      ],
      CONFIG,
    );
    const dates = activities.map((a) => new Date(a.date as string).getTime());
    expect(dates[0]).toBeLessThan(dates[1]);
  });
});

describe("CSV fixture integration", () => {
  const csv = readFileSync(join(__dirname, "__fixtures__/tr-sample.csv"), "utf-8");
  const { data: rows } = Papa.parse<TrRow>(csv, { header: true, skipEmptyLines: true });

  const { activities, skipped } = transform(rows, CONFIG);

  it("parses 26 rows without errors", () => {
    expect(rows).toHaveLength(26);
  });

  it("produces 34 activities and 1 skipped (MIGRATION)", () => {
    expect(activities).toHaveLength(34);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].type).toBe("MIGRATION");
  });

  it("CUSTOMER_INBOUND → DEPOSIT of 1000 to cash", () => {
    const dep = activities.find(
      (a) => a.activityType === "DEPOSIT" && a.comment?.includes("No SEPA"),
    )!;
    expect(dep.accountId).toBe("cash");
    expect(dep.amount).toBe("1000");
  });

  it("regular BUY (FTSE) → 3 activities including TRANSFER_OUT cash of 201", () => {
    const fundBuys = activities.filter(
      (a) => a.activityType === "BUY" && a.symbol === "IE00BK5BQT80",
    );
    expect(fundBuys).toHaveLength(1);
    expect(fundBuys[0].accountId).toBe("portfolio");

    const fundTransferOut = activities.find(
      (a) =>
        a.activityType === "TRANSFER_OUT" &&
        a.accountId === "cash" &&
        a.comment?.includes("IE00BK5BQT80"),
    )!;
    expect(fundTransferOut.amount).toBe("201"); // 200 + 1 fee
  });

  it("STOCKPERK-funded BUY (Apple) → CREDIT + BUY, no cash TRANSFER_OUT", () => {
    const credit = activities.find((a) => a.activityType === "CREDIT")!;
    expect(credit.amount).toBe("16");

    const appleBuy = activities.find(
      (a) => a.activityType === "BUY" && a.symbol === "US0378331005",
    )!;
    expect(appleBuy.quantity).toBe("0.1000000000");

    // No cash TRANSFER_OUT for the stockperk-funded buy
    const cashTransfersOut = activities.filter(
      (a) =>
        a.activityType === "TRANSFER_OUT" &&
        a.accountId === "cash" &&
        a.comment?.includes("US0378331005"),
    );
    expect(cashTransfersOut).toHaveLength(0);
  });

  it("DIVIDEND (USD) → DIVIDEND in EUR + TRANSFER_OUT portfolio + TRANSFER_IN cash", () => {
    const div = activities.find((a) => a.activityType === "DIVIDEND")!;
    expect(div.currency).toBe("EUR");
    expect(div.amount).toBe("0.04");
    expect(div.tax).toBe("0.01");
    expect(div.comment).toContain("Apple (0.05 USD)");

    const divOut = activities.find(
      (a) =>
        a.activityType === "TRANSFER_OUT" &&
        a.accountId === "portfolio" &&
        a.comment?.includes("Dividend"),
    )!;
    expect(divOut).toBeDefined();

    const divIn = activities.find(
      (a) => a.activityType === "TRANSFER_IN" && a.comment?.includes("Dividend"),
    )!;
    expect(divIn.accountId).toBe("cash");

    expect(divOut.transferGroupId).toBeTruthy();
    expect(divOut.transferGroupId).toBe(divIn.transferGroupId);
  });

  it("every internal TRANSFER_OUT/TRANSFER_IN pair shares a transferGroupId; unmatched WITHDRAWAL doesn't", () => {
    const transfers = activities.filter(
      (a) => a.activityType === "TRANSFER_OUT" || a.activityType === "TRANSFER_IN",
    );
    const grouped = transfers.filter((a) => a.transferGroupId);
    // BUY (2), dividend reinvestment, DIVIDEND and DISTRIBUTION funding pairs = 5 pairs = 10 legs (no SELL here)
    expect(grouped).toHaveLength(10);
    for (const groupId of new Set(grouped.map((a) => a.transferGroupId))) {
      expect(grouped.filter((a) => a.transferGroupId === groupId)).toHaveLength(2);
    }

    const unmatchedWithdrawal = activities.find(
      (a) => a.activityType === "WITHDRAWAL" && a.comment?.startsWith("Outgoing transfer for Jane Doe"),
    )!;
    expect(unmatchedWithdrawal.transferGroupId).toBeUndefined();
  });

  it("INTEREST_PAYMENT → INTEREST to cash", () => {
    const interest = activities.find((a) => a.activityType === "INTEREST")!;
    expect(interest.accountId).toBe("cash");
    expect(interest.amount).toBe("4.5");
  });

  it("CUSTOMER_OUTBOUND_REQUEST → WITHDRAWAL of 500 from cash", () => {
    const w = activities.find(
      (a) => a.activityType === "WITHDRAWAL" && a.comment?.includes("20240401"),
    )!;
    expect(w.amount).toBe("500");
    expect(w.accountId).toBe("cash");
  });

  it("CARD_ORDERING_FEE → FEE of 5 from cash", () => {
    const fee = activities.find((a) => a.activityType === "FEE")!;
    expect(fee.amount).toBe("5");
    expect(fee.accountId).toBe("cash");
  });

  it("CARD_TRANSACTION → WITHDRAWAL of 60 from cash", () => {
    const card = activities.find(
      (a) => a.activityType === "WITHDRAWAL" && a.comment?.includes("SUPERMARKET"),
    )!;
    expect(card.amount).toBe("60");
  });

  it("BENEFITS_SAVEBACK → CREDIT with BONUS subtype to cash", () => {
    const saveback = activities.find(
      (a) => a.activityType === "CREDIT" && a.subtype === "BONUS" && a.accountId === "cash",
    )!;
    expect(saveback.amount).toBe("4");
  });

  it("TRANSFER_OUTBOUND (unmatched) → plain WITHDRAWAL from cash", () => {
    const w = activities.find(
      (a) => a.activityType === "WITHDRAWAL" && a.comment?.startsWith("Outgoing transfer for Jane Doe"),
    )!;
    expect(w.amount).toBe("300");
    expect(w.accountId).toBe("cash");
  });

  it("TRANSFER_INSTANT_INBOUND → DEPOSIT to cash", () => {
    const dep = activities.find(
      (a) => a.activityType === "DEPOSIT" && a.comment?.includes("Incoming transfer"),
    )!;
    expect(dep.amount).toBe("500");
    expect(dep.accountId).toBe("cash");
  });

  it("DISTRIBUTION, REFERRAL, EARNINGS and TAX_OPTIMIZATION are mapped, not skipped", () => {
    const by = (c: string) => activities.filter((a) => a.comment?.startsWith(c));
    expect(by("Distribution Example Bond").find((a) => a.activityType === "DIVIDEND")!.amount).toBe("1.5");
    expect(by("Referral bonus")[0]).toMatchObject({ activityType: "CREDIT", subtype: "BONUS", amount: "50" });
    expect(by("Advance lump-sum tax")[0]).toMatchObject({ activityType: "TAX", amount: "0.33" });
    expect(by("Tax optimisation")[0]).toMatchObject({ activityType: "CREDIT", subtype: "TAX_REFUND", amount: "1.25" });
  });

  it("SHARE_EXCHANGE moves the Apple position to the new ISIN at its cost; WORTHLESS sells at 0", () => {
    const out = activities.find((a) => a.activityType === "TRANSFER_OUT" && a.symbol === "US0378331005")!;
    const inn = activities.find((a) => a.activityType === "TRANSFER_IN" && a.symbol === "US0000000001")!;
    expect(out).toMatchObject({ quantity: "0.1", unitPrice: "160" });
    expect(inn).toMatchObject({ quantity: "0.1", unitPrice: "160" });
    const sell = activities.find((a) => a.activityType === "SELL" && a.symbol === "DE0000000002")!;
    expect(sell).toMatchObject({ quantity: "5", unitPrice: "0", amount: "0" });
  });

  it("SPLIT, STOCK_DIVIDEND and DIVIDEND_REINVESTMENT are mapped", () => {
    expect(activities.find((a) => a.activityType === "SPLIT")).toMatchObject({ symbol: "US0000000001", amount: "4" });
    expect(activities.find((a) => a.subtype === "DIVIDEND_IN_KIND")).toMatchObject({ symbol: "NL0000000003", quantity: "2", amount: "3" });
    expect(activities.find((a) => a.activityType === "BUY" && a.symbol === "NL0000000003")).toMatchObject({ quantity: "0.5", unitPrice: "2" });
    expect(skipped.map((s) => s.kind)).toEqual(["netted"]);
  });
});
