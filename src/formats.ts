import Papa from "papaparse";
import { scalableBrokerCash, transformScalable } from "./scalable";
import { transform, trBrokerCash } from "./transform";
import type { AddonSettings, ScRow, TransformResult, TrRow } from "./types";
import { msg, type Msg, type Params } from "./i18n";

// Supported brokers. CSV exports (Trade Republic, Scalable Capital) are told
// apart by their header line, PDF statements (all three, src/pdf/) by their
// content, so the user never has to pick the broker.
export type ImportFormat = "trade-republic" | "scalable" | "dkb";

export const FORMAT_LABEL: Record<ImportFormat, string> = {
  "trade-republic": "Trade Republic",
  scalable: "Scalable Capital",
  dkb: "DKB",
};

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function detectFormat(text: string): ImportFormat | null {
  const header = stripBom(text).split(/\r?\n/, 1)[0] ?? "";
  if (/^"?Datum"?;"?Uhrzeit"?;"?Typ"?;/.test(header)) return "scalable";
  if (header.includes("datetime") && header.includes("transaction_id")) return "trade-republic";
  return null;
}

// The Wealthfolio cash/securities account pair a broker imports into - the
// same pair for its CSV export and its PDF statements.
export function formatAccounts(
  format: ImportFormat,
  settings: AddonSettings,
): { cashAccountId: string; portfolioAccountId: string } {
  switch (format) {
    case "scalable":
      return { cashAccountId: settings.scalableCashAccountId, portfolioAccountId: settings.scalablePortfolioAccountId };
    case "dkb":
      return { cashAccountId: settings.dkbCashAccountId, portfolioAccountId: settings.dkbPortfolioAccountId };
    default:
      return { cashAccountId: settings.cashAccountId, portfolioAccountId: settings.portfolioAccountId };
  }
}

export function isFormatConfigured(format: ImportFormat, settings: AddonSettings): boolean {
  const { cashAccountId, portfolioAccountId } = formatAccounts(format, settings);
  return !!cashAccountId && !!portfolioAccountId;
}

export type ParseOutcome =
  // brokerCash: the broker's own cash balance computed from the export, to
  // compare against the imported cash account (reconcile.ts). PDF statements
  // have none.
  | { ok: true; format: ImportFormat; result: TransformResult; brokerCash?: { currency: string; amount: number } }
  // error: English; errorKey/errorParams: the same for the UI (#74).
  | { ok: false; error: string; errorKey: string; errorParams?: Params };

export function failure(m: Msg): ParseOutcome {
  return { ok: false, error: m.text, errorKey: m.key, errorParams: m.params };
}

export function parseAndTransform(text: string, settings: AddonSettings): ParseOutcome {
  const format = detectFormat(text);
  if (!format) {
    return failure(msg("upload.unrecognisedCsv"));
  }
  if (!isFormatConfigured(format, settings)) {
    return failure(msg("upload.selectAccounts", { broker: FORMAT_LABEL[format] }));
  }

  const body = stripBom(text);
  if (format === "scalable") {
    const parsed = Papa.parse<ScRow>(body, { header: true, delimiter: ";", skipEmptyLines: true });
    if (parsed.data.length === 0) return failure(msg("upload.noRows", { broker: FORMAT_LABEL[format] }));
    return {
      ok: true,
      format,
      result: transformScalable(parsed.data, settings),
      brokerCash: { currency: settings.scalableCashCurrency || "EUR", amount: scalableBrokerCash(parsed.data) },
    };
  }
  const parsed = Papa.parse<TrRow>(body, { header: true, skipEmptyLines: true });
  if (parsed.data.length === 0) return failure(msg("upload.noRows", { broker: FORMAT_LABEL[format] }));
  return {
    ok: true,
    format,
    result: transform(parsed.data, settings),
    brokerCash: { currency: settings.cashCurrency || "EUR", amount: trBrokerCash(parsed.data) },
  };
}
