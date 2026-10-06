import type { ActivityCreate, ActivityImport, ActivityUpdate, AddonContext, QuoteMode } from "@wealthfolio/addon-sdk";
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
  const userSkipped = checked.filter((a) => activityStatus(a) === "duplicate" && isExcluded(a)).length;
  const candidates = checked.filter((a) => activityStatus(a) !== "error" && !isExcluded(a));
  return { candidates, userSkipped };
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
  imported: number;
  failed: FailedActivity[];
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
  const run: ImportRun = { imported: 0, failed: [] };
  for (let i = 0; i < activities.length; i++) {
    const a = activities[i];
    const sourceGroupId = a.lineNumber != null ? groupIdByLine.get(a.lineNumber) : undefined;
    const p = buildPayload(a, sourceGroupId);
    try {
      if (p.kind === "update") await api.update(p.payload);
      else await api.create(p.payload);
      run.imported++;
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
