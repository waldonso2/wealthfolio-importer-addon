import type { ActivityImport } from "@wealthfolio/addon-sdk";
import type { ActivityImportEx, TransferPattern } from "./types";

// Helpers shared by every broker transformer (transform.ts, scalable.ts).

export function addSec(isoDate: string, seconds: number): string {
  return new Date(new Date(isoDate).getTime() + seconds * 1000).toISOString();
}

export function fmtAmt(n: number): string {
  const abs = Math.abs(n);
  const str = abs.toFixed(6);
  return str.replace(/\.?0+$/, "") || "0";
}

// Try in order: IBAN exact on counterparty_iban → IBAN substring in description → keyword in description
export function matchPattern(
  cpiban: string,
  desc: string,
  patterns: TransferPattern[],
): TransferPattern | undefined {
  const upper = desc.toUpperCase();
  return (
    patterns.find((p) => p.iban && p.iban === cpiban) ??
    patterns.find((p) => p.iban && upper.includes(p.iban.toUpperCase())) ??
    patterns.find((p) => p.keyword && upper.includes(p.keyword.toUpperCase()))
  );
}

// Appends the time component of an ISO datetime to make activity comments unique
// per transaction. Wealthfolio's idempotencyKey does not include the date field,
// so same-merchant / same-amount charges (e.g. multiple parking swipes or ETF
// plan buys on the same day) would otherwise collapse to a single activity.
export function timeTag(dt: string): string {
  const t = dt.slice(11, 26); // "HH:MM:SS.mmmmmm" from "YYYY-MM-DDTHH:MM:SS.mmmmmmZ"
  return t ? ` [${t}]` : "";
}

// Cash activities use a synthetic per-currency symbol ("$CASH-EUR", "$CASH-USD",
// …) that must never be treated as a security, whatever the cash currency is.
const CASH_SYMBOL_PREFIX = "$CASH-";

export function isCashSymbol(symbol: string | null | undefined): boolean {
  return !!symbol && symbol.startsWith(CASH_SYMBOL_PREFIX);
}

export function makeCashAct(currency: string) {
  return function cashAct(
    accountId: string,
    activityType: string,
    date: string,
    amount: number,
    comment: string,
    subtype?: string,
    transferGroupId?: string,
  ): ActivityImportEx {
    return {
      accountId,
      activityType: activityType as ActivityImport["activityType"],
      subtype: subtype ?? undefined,
      date,
      symbol: `${CASH_SYMBOL_PREFIX}${currency}`,
      quantity: "1",
      unitPrice: "1",
      amount: fmtAmt(amount),
      currency,
      comment,
      isValid: true,
      isDraft: false,
      transferGroupId,
    };
  };
}

// Sort by date and assign line numbers. lineNumber is the key ImportPage uses to
// re-associate transferGroupId after checkImport, so it is assigned only here.
export function sortAndNumber(activities: ActivityImportEx[]): void {
  activities.sort((a, b) => {
    const da = new Date(a.date as string).getTime();
    const db = new Date(b.date as string).getTime();
    return da - db;
  });
  activities.forEach((a, i) => {
    a.lineNumber = i + 1;
  });
}
