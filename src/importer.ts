import type {
  ActivityCreate,
  ActivityDetails,
  ActivityImport,
  ActivityUpdate,
  AddonContext,
  QuoteMode,
} from "@wealthfolio/addon-sdk";
import { isCashSymbol } from "./common";
import type { ActivityImportEx, SecurityMapping } from "./types";

// Import logic of the wizard, kept free of React so it can be unit-tested
// (#13). ImportPage.tsx only holds state and renders.

export type ActivityStatus = "valid" | "duplicate" | "error";

export function activityStatus(a: ActivityImport): ActivityStatus {
  // Only flag as duplicate if it already exists in the DB (duplicateOfId).
  // duplicateOfLineNumber means checkImport found a similar row elsewhere in the same
  // batch — for our transform this is always a false positive (e.g. TRANSFER_OUT +
  // TRANSFER_IN generated from one CSV row have the same amount and near-identical
  // timestamps).
  if (a.duplicateOfId) return "duplicate";
  if (!a.isValid || (a.errors && Object.keys(a.errors).length > 0)) return "error";
  return "valid";
}

export function firstError(a: ActivityImport): string {
  if (!a.errors) return "";
  const msgs = Object.values(a.errors).flat();
  return msgs[0] ?? "";
}

// Applies resolved ISIN -> ticker mappings to the transform() output, turning
// the placeholder ISIN symbol into the real (or custom) asset fields.
export function applySecurityMappings(
  activities: ActivityImportEx[],
  resolvedMappings: Map<string, SecurityMapping>,
): ActivityImportEx[] {
  // "custom" keeps the ISIN as the symbol. Wealthfolio rejects an equity that has
  // no market data (e.g. delisted) unless it is manually quoted. Funds pass that
  // check, and a requested quote mode also switches an existing asset, so only
  // equities are marked MANUAL - decided per ISIN, because rows like DIVIDEND
  // carry no instrumentType of their own.
  const equityIsins = new Set(activities.filter((a) => a.instrumentType === "EQUITY").map((a) => a.symbol));
  return activities.map((a) => {
    if (!a.symbol || isCashSymbol(a.symbol)) return a;
    const m = resolvedMappings.get(a.symbol);
    if (!m) return a;
    if (m === "custom") return equityIsins.has(a.symbol) ? { ...a, quoteMode: "MANUAL" } : a;
    return {
      ...a,
      symbol: m.canonicalSymbol || m.symbol,
      symbolName: m.shortName,
      exchangeMic: m.canonicalExchangeMic || m.exchangeMic,
      quoteCcy: m.currency || a.quoteCcy,
      instrumentType: m.quoteType === "EQUITY" ? "EQUITY" : m.quoteType === "ETF" ? "FUND" : a.instrumentType,
      providerId: m.providerId,
      providerSymbol: m.providerSymbol,
      assetId: m.existingAssetId,
    };
  });
}

// checkImport round-trips through the backend, which drops our custom
// transferGroupId (ActivityImport has no such field) — so the lineNumber ->
// transferGroupId mapping is re-derived from the pre-checkImport transform
// output, since lineNumber does survive checkImport (docs/ARCHITECTURE.md 6.3).
export function groupIdsByLine(original: ActivityImportEx[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const a of original) {
    if (a.transferGroupId && a.lineNumber != null) map.set(a.lineNumber, a.transferGroupId);
  }
  return map;
}

// What gets submitted: everything except errors and the duplicates the user
// excluded. Duplicates are included by default and updated in place.
export function selectCandidates(
  checked: ActivityImport[],
  excludedLines: Set<number>,
): { candidates: ActivityImport[]; userSkipped: number } {
  const isExcluded = (a: ActivityImport) => a.lineNumber != null && excludedLines.has(a.lineNumber);
  const userSkipped = checked.filter((a) => activityStatus(a) !== "error" && isExcluded(a)).length;
  const candidates = checked.filter((a) => activityStatus(a) !== "error" && !isExcluded(a));
  return { candidates, userSkipped };
}

// ── Already in Wealthfolio from another source ──────────────────────────────
// checkImport only recognises an activity imported from the same source (same
// comment and amount). A trade or dividend imported once from the CSV export
// and once from the PDF statement differs in comment and time, so it would be
// created twice. matchExisting finds such activities by their substance:
// account, type, security, day, shares and amount.

const MATCH_TYPES = new Set(["BUY", "SELL", "DIVIDEND"]);
// CSV timestamps and PDF execution/payment times of the same transaction lie
// within a day of each other (time zone, noon for dividends).
const MATCH_WINDOW_MS = 36 * 60 * 60 * 1000;
const AMOUNT_TOLERANCE = 0.02;
// Transfer legs of a trade or dividend are booked a few seconds before/after it.
const LEG_WINDOW_MS = 5 * 1000;

const toNum = (v: unknown) => {
  const n = Number(v ?? NaN);
  return Number.isFinite(n) ? n : NaN;
};

function existingAmount(e: ActivityDetails): number {
  const amount = toNum(e.amount);
  if (!Number.isNaN(amount)) return Math.abs(amount);
  return Math.abs(toNum(e.quantity) * toNum(e.unitPrice));
}

// Lines of `checked` that already exist in Wealthfolio under another source,
// each mapped to every line of its transaction (the trade or dividend plus its
// transfer legs and a tax-refund credit), so the whole
// transaction is skipped or included together. Activities checkImport already
// flags as duplicates are left to that mechanism; the existing activities they
// point to can't match a second time.
export function matchExisting(
  checked: ActivityImport[],
  existing: ActivityDetails[],
  groupIdByLine: Map<number, string>,
): Map<number, number[]> {
  const claimed = new Set(checked.map((a) => a.duplicateOfId).filter(Boolean));
  const pool = existing.filter((e) => MATCH_TYPES.has(e.activityType) && !claimed.has(e.id));
  const used = new Set<string>();
  const result = new Map<number, number[]>();

  for (const a of checked) {
    if (a.lineNumber == null || !MATCH_TYPES.has(a.activityType) || activityStatus(a) !== "valid") continue;
    const time = new Date(String(a.date)).getTime();
    const amount = Math.abs(toNum(a.amount));
    const quantity = Math.abs(toNum(a.quantity));
    const match = pool.find((e) => {
      if (used.has(e.id) || e.accountId !== a.accountId || e.activityType !== a.activityType) return false;
      const sameAsset = (!!a.assetId && e.assetId === a.assetId) || (!!a.symbol && e.assetSymbol === a.symbol);
      if (!sameAsset) return false;
      if (Math.abs(new Date(e.date).getTime() - time) > MATCH_WINDOW_MS) return false;
      if (Math.abs(existingAmount(e) - amount) > AMOUNT_TOLERANCE) return false;
      // Dividends: the CSV exports book the quantity differently (shares or 1).
      return a.activityType === "DIVIDEND" || Math.abs(Math.abs(toNum(e.quantity)) - quantity) < 1e-6;
    });
    if (!match) continue;
    used.add(match.id);

    // The transaction's other lines: the transfer pair that funds or sweeps it
    // (its leg on this account, seconds apart, over the same amount - the
    // trade itself carries no group id) and a tax-refund credit at the same
    // instant.
    const near = (o: ActivityImport) =>
      o.accountId === a.accountId && Math.abs(new Date(String(o.date)).getTime() - time) <= LEG_WINDOW_MS;
    const groups = new Set<string>();
    for (const o of checked) {
      if (o.lineNumber == null || !near(o) || !isCashSymbol(o.symbol)) continue;
      if (o.activityType !== "TRANSFER_IN" && o.activityType !== "TRANSFER_OUT") continue;
      const group = groupIdByLine.get(o.lineNumber);
      if (group && Math.abs(Math.abs(toNum(o.amount)) - amount) <= AMOUNT_TOLERANCE) groups.add(group);
    }
    const lines = checked
      .filter(
        (o) =>
          o.lineNumber != null &&
          (o === a ||
            groups.has(groupIdByLine.get(o.lineNumber) ?? "") ||
            (o.activityType === "CREDIT" && o.subtype === "TAX_REFUND" && near(o))),
      )
      .map((o) => o.lineNumber as number);
    for (const ln of lines) result.set(ln, lines);
  }
  return result;
}

// The accounts whose existing activities matchExisting needs: those holding
// trades and dividends in this import.
export function accountsToMatch(checked: ActivityImport[]): string[] {
  return [...new Set(checked.filter((a) => MATCH_TYPES.has(a.activityType)).map((a) => a.accountId))];
}

export type Payload = { kind: "update"; payload: ActivityUpdate } | { kind: "create"; payload: ActivityCreate };

// Update for an activity that already exists (re-import), create otherwise.
export function buildPayload(a: ActivityImport, sourceGroupId: string | undefined): Payload {
  const asset =
    a.symbol || a.assetId
      ? {
          id: a.assetId,
          symbol: a.symbol,
          name: a.symbolName,
          exchangeMic: a.exchangeMic,
          quoteCcy: a.quoteCcy,
          instrumentType: a.instrumentType,
          quoteMode: a.quoteMode as QuoteMode | undefined,
          providerId: a.providerId,
          providerSymbol: a.providerSymbol,
        }
      : undefined;
  const fields = {
    accountId: a.accountId,
    activityType: a.activityType,
    subtype: a.subtype,
    activityDate: a.date as string,
    currency: a.currency,
    quantity: a.quantity,
    unitPrice: a.unitPrice,
    amount: a.amount,
    fee: a.fee,
    tax: a.tax,
    fxRate: a.fxRate,
    comment: a.comment,
    asset,
    sourceGroupId,
  };
  if (activityStatus(a) === "duplicate" && a.duplicateOfId) {
    return { kind: "update", payload: { id: a.duplicateOfId, ...fields } as ActivityUpdate };
  }
  return { kind: "create", payload: fields as ActivityCreate };
}

export interface FailedActivity {
  activity: ActivityImport;
  error: string;
}

export interface ImportRun {
  // Activities Wealthfolio accepted: new ones plus `updated` existing ones.
  imported: number;
  updated: number;
  failed: FailedActivity[];
}

// Text of the import button. Duplicates are existing activities that get
// updated, not imported again, so they are counted separately.
export function importButtonLabel(newCount: number, updateCount: number): string {
  if (updateCount === 0) return `Import ${newCount} ${newCount === 1 ? "activity" : "activities"}`;
  if (newCount === 0) return `Update ${updateCount} existing`;
  return `Import ${newCount} new · update ${updateCount} existing`;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export type ActivitiesApi = Pick<AddonContext["api"]["activities"], "create" | "update">;

// Submits the activities one at a time. A failing call doesn't stop the run;
// it is collected with Wealthfolio's error message so the user can see it and
// retry exactly those activities (#11). Retrying passes the failed activities
// back in; they keep their sourceGroupId through groupIdByLine.
export async function runImport(
  api: ActivitiesApi,
  activities: ActivityImport[],
  groupIdByLine: Map<number, string>,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportRun> {
  const run: ImportRun = { imported: 0, updated: 0, failed: [] };
  for (let i = 0; i < activities.length; i++) {
    const a = activities[i];
    const sourceGroupId = a.lineNumber != null ? groupIdByLine.get(a.lineNumber) : undefined;
    const p = buildPayload(a, sourceGroupId);
    try {
      if (p.kind === "update") await api.update(p.payload);
      else await api.create(p.payload);
      run.imported++;
      if (p.kind === "update") run.updated++;
    } catch (e) {
      run.failed.push({ activity: a, error: errorMessage(e) });
    }
    onProgress?.(i + 1, activities.length);
  }
  return run;
}

// Failed activities as CSV, for copying out of the sandboxed addon (no downloads).
export function failedAsCsv(failed: FailedActivity[], accountName: (id: string) => string): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["date", "account", "type", "symbol", "quantity", "amount", "currency", "comment", "error"];
  const rows = failed.map(({ activity: a, error }) =>
    [String(a.date).slice(0, 19), accountName(a.accountId ?? ""), a.activityType, a.symbol, a.quantity, a.amount, a.currency, a.comment, error]
      .map(esc)
      .join(","),
  );
  return [head.join(","), ...rows].join("\n");
}
