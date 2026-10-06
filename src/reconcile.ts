import { isCashSymbol } from "./common";
import type { ActivityImportEx } from "./types";

// Pre-import reconciliation: what the broker's accounts will look like in
// Wealthfolio once the file is imported, computed from the transformer output
// alone. Cash follows Wealthfolio's rule that `amount` is the actual cash flow
// (docs/ARCHITECTURE.md 5.4); holdings follow quantities, splits and in-kind
// dividends.

export interface Holding {
  symbol: string;
  name: string;
  quantity: number;
}

export interface Reconciliation {
  // Cash per currency on the broker's cash account.
  cash: Record<string, number>;
  // Cash per currency left on the securities account - should all be 0.
  portfolioCash: Record<string, number>;
  // Securities on the securities account at the end of the file (non-zero only).
  holdings: Holding[];
  // Positions that went below 0 at some point: rows missing or mis-mapped.
  negative: { symbol: string; name: string; date: string; quantity: number }[];
  // The broker's own cash balance computed from the export, when it has one.
  brokerCash?: { currency: string; amount: number };
}

const CASH_TOLERANCE = 0.005;
const SHARE_TOLERANCE = 1e-6;

const CASH_IN = new Set(["DEPOSIT", "DIVIDEND", "INTEREST", "CREDIT", "SELL"]);
const CASH_OUT = new Set(["WITHDRAWAL", "BUY", "FEE", "TAX"]);

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

// Cash effect of one activity on its own account, in its currency.
export function cashEffect(a: ActivityImportEx): number {
  const amount = Math.abs(num(a.amount));
  const type = a.activityType;
  // A dividend in kind is income plus a cash-neutral buy (Wealthfolio expands it).
  if (type === "DIVIDEND" && a.subtype === "DIVIDEND_IN_KIND") return 0;
  if (CASH_IN.has(type)) return amount;
  if (CASH_OUT.has(type)) return -amount;
  // Transfers move cash only when they are cash transfers; a security transfer
  // moves shares.
  if (type === "TRANSFER_IN" && isCashSymbol(a.symbol)) return amount;
  if (type === "TRANSFER_OUT" && isCashSymbol(a.symbol)) return -amount;
  return 0;
}

function addTo(map: Record<string, number>, key: string, value: number) {
  if (value) map[key] = (map[key] ?? 0) + value;
}

const round = (map: Record<string, number>, tolerance: number) =>
  Object.fromEntries(Object.entries(map).filter(([, v]) => Math.abs(v) > tolerance));

export function reconcile(
  activities: ActivityImportEx[],
  accounts: { cashAccountId: string; portfolioAccountId: string },
  brokerCash?: { currency: string; amount: number },
): Reconciliation {
  const cash: Record<string, number> = {};
  const portfolioCash: Record<string, number> = {};
  const shares = new Map<string, Holding>();
  const negative: Reconciliation["negative"] = [];
  const reportedNegative = new Set<string>();

  const sorted = [...activities].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const a of sorted) {
    const currency = a.currency || "EUR";
    if (a.accountId === accounts.cashAccountId) addTo(cash, currency, cashEffect(a));
    if (a.accountId !== accounts.portfolioAccountId) continue;
    addTo(portfolioCash, currency, cashEffect(a));

    if (!a.symbol || isCashSymbol(a.symbol)) continue;
    const symbol = a.symbol;
    const h = shares.get(symbol) ?? { symbol, name: a.symbolName ?? "", quantity: 0 };
    if (a.symbolName) h.name = a.symbolName;
    const qty = Math.abs(num(a.quantity));
    switch (a.activityType) {
      case "BUY":
      case "TRANSFER_IN":
        h.quantity += qty;
        break;
      case "DIVIDEND":
        if (a.subtype === "DIVIDEND_IN_KIND") h.quantity += qty;
        break;
      case "SELL":
      case "TRANSFER_OUT":
        h.quantity -= qty;
        break;
      case "SPLIT": {
        // Wealthfolio reads the split ratio from amount (fallback: quantity).
        const ratio = num(a.amount) > 0 ? num(a.amount) : qty;
        if (ratio > 0) h.quantity *= ratio;
        break;
      }
    }
    shares.set(symbol, h);
    if (h.quantity < -SHARE_TOLERANCE && !reportedNegative.has(symbol)) {
      reportedNegative.add(symbol);
      negative.push({ symbol, name: h.name, date: String(a.date).slice(0, 10), quantity: h.quantity });
    }
  }

  return {
    cash: round(cash, CASH_TOLERANCE),
    portfolioCash: round(portfolioCash, CASH_TOLERANCE),
    holdings: [...shares.values()]
      .filter((h) => Math.abs(h.quantity) > SHARE_TOLERANCE)
      .sort((a, b) => (a.name || a.symbol).localeCompare(b.name || b.symbol)),
    negative,
    brokerCash,
  };
}

// Difference between the broker's own cash balance and the imported cash
// account, or 0 when the export has no balance or they match.
export function cashDifference(r: Reconciliation): number {
  if (!r.brokerCash) return 0;
  const diff = (r.cash[r.brokerCash.currency] ?? 0) - r.brokerCash.amount;
  return Math.abs(diff) > CASH_TOLERANCE ? diff : 0;
}
