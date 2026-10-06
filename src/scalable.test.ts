import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { tradeFinalCash } from "./common";
import { detectFormat, parseAndTransform } from "./formats";
import { berlinToIso, deNum, transformScalable } from "./scalable";
import type { ActivityImportEx, AddonSettings, ScRow } from "./types";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONFIG: AddonSettings = {
  cashAccountId: "tr-cash",
  cashCurrency: "EUR",
  portfolioAccountId: "tr-portfolio",
  scalableCashAccountId: "sc-cash",
  scalableCashCurrency: "EUR",
  scalablePortfolioAccountId: "sc-portfolio",
  transferPatterns: [],
  securityMappings: {},
};

function row(overrides: Partial<ScRow>): ScRow {
  return {
    Datum: "15.01.2024",
    Uhrzeit: "01:00:00",
    Typ: "",
    Wertpapiername: "",
    ISIN: "",
    Wert: "0",
    Stück: "",
    Buchungswährung: "EUR",
    Gebühren: "",
    Steuern: "",
    Bruttobetrag: "",
    Notiz: "N0001",
    ...overrides,
  };
}

const types = (acts: ActivityImportEx[]) => acts.map((a) => `${a.accountId}:${a.activityType}`);

describe("parsing helpers", () => {
  it("deNum parses German numbers", () => {
    expect(deNum("-3894,15")).toBe(-3894.15);
    expect(deNum("12,933359")).toBe(12.933359);
    expect(deNum("1.234,5")).toBe(1234.5);
    expect(deNum("")).toBe(0);
  });

  it("berlinToIso converts Europe/Berlin local time to UTC (summer and winter)", () => {
    expect(berlinToIso("16.06.2026", "20:09:37")).toBe("2026-06-16T18:09:37.000Z");
    expect(berlinToIso("10.01.2024", "13:59:57")).toBe("2024-01-10T12:59:57.000Z");
    // booking-only rows: 01:00/02:00 local = midnight UTC
    expect(berlinToIso("24.01.2026", "01:00:00")).toBe("2026-01-24T00:00:00.000Z");
    // Datum occasionally carries a trailing time
    expect(berlinToIso("08.09.2026 00:00:00", "02:00:00")).toBe("2026-09-08T00:00:00.000Z");
  });
});

describe("Kauf / Verkauf", () => {
  it("Kauf → cash TRANSFER_OUT, portfolio TRANSFER_IN, BUY with price from Bruttobetrag", () => {
    const { activities } = transformScalable(
      [
        row({
          Typ: "Kauf",
          Datum: "16.06.2026",
          Uhrzeit: "20:09:37",
          Wertpapiername: "Test ETF",
          ISIN: "IE00TEST0001",
          Wert: "-3894,15",
          Stück: "6",
          Gebühren: "0,99",
          Steuern: "0",
          Bruttobetrag: "3893,16",
          Notiz: "ORDER1",
        }),
      ],
      CONFIG,
    );
    expect(types(activities)).toEqual(["sc-cash:TRANSFER_OUT", "sc-portfolio:TRANSFER_IN", "sc-portfolio:BUY"]);
    const [out, inn, buy] = activities;
    expect(out.amount).toBe("3894.15");
    expect(inn.amount).toBe("3894.15");
    expect(out.transferGroupId).toBe("sc-buy-ORDER1");
    expect(inn.transferGroupId).toBe("sc-buy-ORDER1");
    expect(buy.symbol).toBe("IE00TEST0001");
    expect(buy.quantity).toBe("6");
    expect(buy.unitPrice).toBe("648.86");
    expect(buy.fee).toBe("0.99");
    expect(buy.date).toBe("2026-06-16T18:09:37.000Z");
  });

  it("Verkauf → SELL, portfolio TRANSFER_OUT and cash TRANSFER_IN of the net proceeds", () => {
    const { activities } = transformScalable(
      [
        row({
          Typ: "Verkauf",
          ISIN: "IE00TEST0002",
          Wertpapiername: "Test",
          Wert: "5796,74",
          Stück: "117",
          Gebühren: "0,99",
          Steuern: "265,21",
          Bruttobetrag: "6062,94",
          Notiz: "ORDER2",
        }),
      ],
      CONFIG,
    );
    expect(types(activities)).toEqual(["sc-portfolio:SELL", "sc-portfolio:TRANSFER_OUT", "sc-cash:TRANSFER_IN"]);
    // fee and tax in their own fields; amount = gross − fee − tax = Wert
    expect(activities[0]).toMatchObject({ fee: "0.99", tax: "265.21" });
    expect(Number(activities[0].amount)).toBeCloseTo(5796.74, 6);
    expect(activities[1].amount).toBe("5796.74");
    expect(activities[1].transferGroupId).toBe("sc-sell-ORDER2");
    expect(activities[2].transferGroupId).toBe("sc-sell-ORDER2");
  });

  it("Kauf without tax keeps fee and amount as before and has no tax field", () => {
    const { activities } = transformScalable(
      [row({ Typ: "Kauf", ISIN: "IE00TEST0001", Wert: "-1001", Stück: "10", Gebühren: "1", Steuern: "0", Bruttobetrag: "1000", Notiz: "O9" })],
      CONFIG,
    );
    const buy = activities.find((a) => a.activityType === "BUY")!;
    expect(buy).toMatchObject({ fee: "1", amount: "1001" });
    expect(buy.tax).toBeUndefined();
  });

  it("a negative Steuern (refund) on a Verkauf becomes a CREDIT/TAX_REFUND and is swept to cash", () => {
    const { activities } = transformScalable(
      [row({ Typ: "Verkauf", ISIN: "IE00TEST0002", Wert: "1011", Stück: "10", Gebühren: "1", Steuern: "-12", Bruttobetrag: "1000", Notiz: "O10" })],
      CONFIG,
    );
    const sell = activities.find((a) => a.activityType === "SELL")!;
    expect(sell).toMatchObject({ fee: "1", amount: "999" });
    expect(sell.tax).toBeUndefined();
    expect(activities.find((a) => a.activityType === "CREDIT")).toMatchObject({
      accountId: "sc-portfolio",
      subtype: "TAX_REFUND",
      amount: "12",
    });
    expect(activities.find((a) => a.activityType === "TRANSFER_OUT")!.amount).toBe("1011");
  });
});

describe("cash types", () => {
  it.each([
    ["Zinsen", "31,9", "sc-cash:INTEREST", undefined],
    ["Einlage", "1000", "sc-cash:DEPOSIT", undefined],
    ["Entnahme", "-9000", "sc-cash:WITHDRAWAL", undefined],
    ["TAX", "-2,29", "sc-cash:TAX", undefined],
    ["Steuerrückerstattung", "98,27", "sc-cash:CREDIT", "TAX_REFUND"],
    ["FEE", "-4,99", "sc-cash:FEE", undefined],
  ])("%s → %s", (typ, wert, expected, subtype) => {
    const { activities, skipped } = transformScalable([row({ Typ: typ, Wert: wert })], CONFIG);
    expect(skipped).toHaveLength(0);
    expect(types(activities)).toEqual([expected]);
    expect(activities[0].amount).toBe(String(Math.abs(deNum(wert))));
    expect(activities[0].subtype).toBe(subtype);
  });

  it("Entnahme matching a keyword pattern with destination → grouped transfer pair", () => {
    const { activities } = transformScalable([row({ Typ: "Entnahme", Wert: "-500", Notiz: "P1 Auszahlung GIRO" })], {
      ...CONFIG,
      transferPatterns: [{ keyword: "giro", label: "Girokonto", destinationAccountId: "giro" }],
    });
    expect(types(activities)).toEqual(["sc-cash:TRANSFER_OUT", "giro:TRANSFER_IN"]);
    expect(activities[0].transferGroupId).toBeDefined();
    expect(activities[0].transferGroupId).toBe(activities[1].transferGroupId);
  });

  it("Einlage never checks transfer patterns", () => {
    const { activities } = transformScalable([row({ Typ: "Einlage", Wert: "500", Notiz: "GIRO" })], {
      ...CONFIG,
      transferPatterns: [{ keyword: "giro", label: "Girokonto", destinationAccountId: "giro" }],
    });
    expect(types(activities)).toEqual(["sc-cash:DEPOSIT"]);
  });

  it("tolerates missing columns and keeps distinct group IDs for Kauf rows without Notiz", () => {
    const short = { Datum: "15.01.2024", Uhrzeit: "10:00:00", Typ: "Einlage", Wert: "5" } as unknown as ScRow;
    expect(types(transformScalable([short], CONFIG).activities)).toEqual(["sc-cash:DEPOSIT"]);

    const buy = (wert: string) =>
      row({ Typ: "Kauf", ISIN: "X9", Wert: wert, Stück: "1", Bruttobetrag: wert.replace("-", ""), Notiz: "" });
    const { activities } = transformScalable([buy("-10"), buy("-20")], CONFIG);
    const groups = new Set(activities.map((a) => a.transferGroupId).filter(Boolean));
    expect(groups.size).toBe(2);
  });

  it("unknown type goes to skipped", () => {
    const { activities, skipped } = transformScalable([row({ Typ: "SOMETHING", Wert: "1" })], CONFIG);
    expect(activities).toHaveLength(0);
    expect(skipped[0]).toMatchObject({ kind: "missing" });
    expect(skipped[0].reason).toContain("type SOMETHING isn't supported yet");
    expect(skipped[0].hint).toContain("Add it manually");
  });
});

describe("Dividende", () => {
  it("positive dividend → DIVIDEND + grouped portfolio→cash transfer", () => {
    const { activities } = transformScalable(
      [row({ Typ: "Dividende", ISIN: "IE00TEST0001", Wertpapiername: "Test", Wert: "219,26" })],
      CONFIG,
    );
    expect(types(activities)).toEqual(["sc-portfolio:DIVIDEND", "sc-portfolio:TRANSFER_OUT", "sc-cash:TRANSFER_IN"]);
    expect(activities[0].amount).toBe("219.26");
    expect(activities[1].transferGroupId).toBe(activities[2].transferGroupId);
  });

  it("cancellation removes itself and the original dividend, keeps the re-booking", () => {
    const { activities, skipped } = transformScalable(
      [
        row({ Typ: "Dividende", ISIN: "X1", Datum: "27.08.2025", Uhrzeit: "02:00:00", Wert: "40", Notiz: "C_WWEK 2_2025-08-27" }),
        row({ Typ: "Dividende", ISIN: "X1", Datum: "27.08.2025", Uhrzeit: "02:00:00", Wert: "-40", Notiz: "C_CANCEL-WWEK 1_2025-08-27" }),
        row({ Typ: "Dividende", ISIN: "X1", Datum: "11.06.2025", Uhrzeit: "02:00:00", Wert: "40", Notiz: "C_WWEK 1_2025-06-11" }),
      ],
      CONFIG,
    );
    expect(activities.filter((a) => a.activityType === "DIVIDEND")).toHaveLength(1);
    expect(activities.find((a) => a.activityType === "DIVIDEND")!.date).toBe("2025-08-27T00:00:00.000Z");
    expect(skipped).toHaveLength(2);
  });
});

describe("security transfers (empty Typ)", () => {
  it("out/in legs with the same share count within 7 days net to zero", () => {
    const { activities, skipped } = transformScalable(
      [
        row({ ISIN: "X2", Datum: "05.12.2025", Wert: "-480", Stück: "20", Notiz: "WWUM 1" }),
        row({ ISIN: "X2", Datum: "06.12.2025", Wert: "500", Stück: "20", Notiz: "SWITCH-101-X2" }),
        // a CANCEL- row is outgoing although Wert is positive
        row({ ISIN: "X2", Datum: "07.12.2025", Wert: "500", Stück: "20", Notiz: "CANCEL-SWITCH-101-X2" }),
        row({ ISIN: "X2", Datum: "07.12.2025", Wert: "500", Stück: "20", Notiz: "SWITCH-101-1-X2" }),
      ],
      CONFIG,
    );
    expect(activities).toHaveLength(0);
    expect(skipped).toHaveLength(4);
  });

  it("unpaired incoming transfer → security TRANSFER_IN", () => {
    const { activities } = transformScalable(
      [row({ ISIN: "X3", Wert: "1200", Stück: "5", Notiz: "SWITCH-1" })],
      CONFIG,
    );
    expect(types(activities)).toEqual(["sc-portfolio:TRANSFER_IN"]);
    expect(activities[0].unitPrice).toBe("240");
  });

  it("SWAP_OUT + matching outgoing transfer → SELL + transfer pair", () => {
    const { activities, skipped } = transformScalable(
      [
        row({ ISIN: "X4", Wertpapiername: "Fund", Wert: "-2163,42", Stück: "600", Notiz: "WWUM 7" }),
        row({ Typ: "SWAP_OUT", Wert: "2163,42", Notiz: "CASH_D_WWUM 7_2025-04-28 Fund" }),
      ],
      CONFIG,
    );
    expect(skipped).toHaveLength(0);
    expect(types(activities)).toEqual(["sc-portfolio:SELL", "sc-portfolio:TRANSFER_OUT", "sc-cash:TRANSFER_IN"]);
    expect(activities[0].quantity).toBe("600");
    expect(activities[1].amount).toBe("2163.42");
  });

  it("zero-value outgoing row + same-day Dividende payout → SELL (redemption)", () => {
    const { activities } = transformScalable(
      [
        row({ Typ: "Dividende", ISIN: "X5", Wert: "24,99", Notiz: "CASH_D_121_D_2026-02-09" }),
        row({ ISIN: "X5", Wert: "0", Stück: "12", Notiz: "121_D" }),
      ],
      CONFIG,
    );
    expect(types(activities)).toEqual(["sc-portfolio:SELL", "sc-portfolio:TRANSFER_OUT", "sc-cash:TRANSFER_IN"]);
    expect(activities[0].quantity).toBe("12");
    expect(activities[2].amount).toBe("24.99");
  });

  it("depot-migration cash (SWITCH- deposit + matching withdrawal) is skipped", () => {
    const { activities, skipped } = transformScalable(
      [
        row({ Typ: "Einlage", Datum: "06.12.2025", Wert: "1079,41", Notiz: "CASH_SWITCH-101-EUR-DEPOSIT" }),
        row({ Typ: "Entnahme", Datum: "08.12.2025", Wert: "-1079,41", Notiz: "Migration Cash" }),
        row({ Typ: "Einlage", Datum: "19.12.2025", Wert: "142,92", Notiz: "CASH_SWITCH-101-EUR-DISTRIBUTION-RKN" }),
      ],
      CONFIG,
    );
    expect(skipped).toHaveLength(2);
    expect(types(activities)).toEqual(["sc-cash:DEPOSIT"]);
    expect(activities[0].amount).toBe("142.92");
  });
});

describe("format detection", () => {
  it("detects Scalable (with BOM) and Trade Republic headers", () => {
    expect(detectFormat("﻿Datum;Uhrzeit;Typ;Wertpapiername;ISIN\r\n")).toBe("scalable");
    expect(detectFormat('"datetime","date","account_type","category","type","transaction_id"\n')).toBe("trade-republic");
    expect(detectFormat("foo,bar\n1,2\n")).toBeNull();
  });

  it("rejects a format whose accounts are not configured", () => {
    const out = parseAndTransform("Datum;Uhrzeit;Typ\r\n", { ...CONFIG, scalableCashAccountId: "" });
    expect(out.ok).toBe(false);
  });
});

describe("Scalable CSV fixture integration", () => {
  const text = readFileSync(join(__dirname, "__fixtures__/scalable-sample.csv"), "utf-8");
  const outcome = parseAndTransform(text, CONFIG);
  if (!outcome.ok) throw new Error(outcome.error);
  const { activities, skipped } = outcome.result;

  it("is detected as Scalable Capital", () => {
    expect(outcome.format).toBe("scalable");
  });

  it("produces 33 activities and 9 skipped rows", () => {
    expect(activities).toHaveLength(33);
    expect(skipped).toHaveLength(9);
  });

  it("only uses the Scalable account pair", () => {
    expect(new Set(activities.map((a) => a.accountId))).toEqual(new Set(["sc-cash", "sc-portfolio"]));
  });

  it("final holdings: 10 × IE00TEST0001, everything else closed", () => {
    const holdings: Record<string, number> = {};
    for (const a of activities) {
      if (a.accountId !== "sc-portfolio" || String(a.symbol).startsWith("$CASH-")) continue;
      const sign = ["BUY", "TRANSFER_IN"].includes(a.activityType)
        ? 1
        : ["SELL", "TRANSFER_OUT"].includes(a.activityType)
          ? -1
          : 0;
      holdings[a.symbol as string] = (holdings[a.symbol as string] ?? 0) + sign * Number(a.quantity);
    }
    expect(holdings).toEqual({ IE00TEST0001: 10, IE00TEST0002: 0, DE000TEST0003: 0, IE00TEST0004: 0 });
  });

  it("every internal TRANSFER_OUT/TRANSFER_IN pair shares a transferGroupId", () => {
    const transfers = activities.filter((a) => a.activityType === "TRANSFER_OUT" || a.activityType === "TRANSFER_IN");
    const byGroup = new Map<string, number>();
    for (const t of transfers) {
      expect(t.transferGroupId).toBeDefined();
      byGroup.set(t.transferGroupId!, (byGroup.get(t.transferGroupId!) ?? 0) + 1);
    }
    for (const count of byGroup.values()) expect(count).toBe(2);
  });

  it("line numbers are unique and sequential after sorting by date", () => {
    expect(activities.map((a) => a.lineNumber)).toEqual(activities.map((_, i) => i + 1));
    const dates = activities.map((a) => new Date(a.date as string).getTime());
    expect([...dates].sort((a, b) => a - b)).toEqual(dates);
  });
});

describe("trade amount (idempotency)", () => {
  // Wealthfolio stores quantity × unitPrice ± fee as the trade amount and hashes
  // it exactly; checkImport only finds a duplicate when the submitted amount is
  // that same decimal value.
  it("tradeFinalCash computes exact decimals without float error", () => {
    expect(tradeFinalCash("BUY", "12.933359", "38.659999", "0")).toBe("500.003646006641");
    expect(tradeFinalCash("BUY", "2.0000000000", "100.000000", "1")).toBe("201");
    expect(tradeFinalCash("SELL", "117", "51.82", "266.2")).toBe("5796.74");
    expect(tradeFinalCash("BUY", "0.1", "0.2", "0")).toBe("0.02");
    expect(tradeFinalCash("SELL", "-5", "-10", "-1")).toBe("49");
    // tax is a charge like the fee
    expect(tradeFinalCash("SELL", "2", "160", "1", "25.5")).toBe("293.5");
    expect(tradeFinalCash("BUY", "2", "100", "1", "-0.5")).toBe("201.5");
  });

  it("Scalable Kauf/Verkauf carry the derived amount", () => {
    const { activities } = transformScalable(
      [
        row({ Typ: "Kauf", ISIN: "X1", Wert: "-500", Stück: "12,933359", Gebühren: "0", Steuern: "0", Bruttobetrag: "500", Notiz: "O1" }),
        row({ Typ: "Verkauf", ISIN: "X1", Wert: "5796,74", Stück: "117", Gebühren: "0,99", Steuern: "265,21", Bruttobetrag: "6062,94", Notiz: "O2" }),
      ],
      CONFIG,
    );
    const buy = activities.find((a) => a.activityType === "BUY")!;
    const sell = activities.find((a) => a.activityType === "SELL")!;
    expect(buy.amount).toBe(tradeFinalCash("BUY", String(buy.quantity), String(buy.unitPrice), String(buy.fee)));
    expect(Math.abs(Number(buy.amount) - 500)).toBeLessThan(0.005);
    expect(sell.amount).toBe(
      tradeFinalCash("SELL", String(sell.quantity), String(sell.unitPrice), String(sell.fee), String(sell.tax)),
    );
    expect(Math.abs(Number(sell.amount) - 5796.74)).toBeLessThan(0.005);
  });
});
