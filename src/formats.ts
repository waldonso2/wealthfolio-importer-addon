import Papa from "papaparse";
import { transformScalable } from "./scalable";
import { transform } from "./transform";
import type { AddonSettings, ScRow, TransformResult, TrRow } from "./types";

// Supported CSV exports. The format is detected from the header line, so the
// user never has to pick it.
export type ImportFormat = "trade-republic" | "scalable";

export const FORMAT_LABEL: Record<ImportFormat, string> = {
  "trade-republic": "Trade Republic",
  scalable: "Scalable Capital",
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

// The Wealthfolio cash/securities account pair a format imports into.
export function formatAccounts(
  format: ImportFormat,
  settings: AddonSettings,
): { cashAccountId: string; portfolioAccountId: string } {
  return format === "scalable"
    ? { cashAccountId: settings.scalableCashAccountId, portfolioAccountId: settings.scalablePortfolioAccountId }
    : { cashAccountId: settings.cashAccountId, portfolioAccountId: settings.portfolioAccountId };
}

export function isFormatConfigured(format: ImportFormat, settings: AddonSettings): boolean {
  const { cashAccountId, portfolioAccountId } = formatAccounts(format, settings);
  return !!cashAccountId && !!portfolioAccountId;
}

export type ParseOutcome =
  | { ok: true; format: ImportFormat; result: TransformResult }
  | { ok: false; error: string };

export function parseAndTransform(text: string, settings: AddonSettings): ParseOutcome {
  const format = detectFormat(text);
  if (!format) {
    return {
      ok: false,
      error: "Unrecognised CSV. Upload a transaction export from Trade Republic or Scalable Capital.",
    };
  }
  if (!isFormatConfigured(format, settings)) {
    return {
      ok: false,
      error: `Select your ${FORMAT_LABEL[format]} cash and securities accounts in Settings first.`,
    };
  }

  const body = stripBom(text);
  if (format === "scalable") {
    const parsed = Papa.parse<ScRow>(body, { header: true, delimiter: ";", skipEmptyLines: true });
    if (parsed.data.length === 0) return { ok: false, error: "No rows found in the Scalable Capital export." };
    return { ok: true, format, result: transformScalable(parsed.data, settings) };
  }
  const parsed = Papa.parse<TrRow>(body, { header: true, skipEmptyLines: true });
  if (parsed.data.length === 0) return { ok: false, error: "No rows found in the Trade Republic export." };
  return { ok: true, format, result: transform(parsed.data, settings) };
}
