import Papa from "papaparse";
import { scalableBrokerCash, transformScalable } from "./scalable";
import { transform, trBrokerCash } from "./transform";
import type { AddonSettings, BrokerAccounts, BrokerConfig, ScRow, TransformResult, TrRow } from "./types";
import { msg, type Msg, type Params } from "./i18n";

// Supported brokers. CSV exports (Trade Republic, Scalable Capital) are told
// apart by their header line, PDF statements (all three, src/pdf/) by their
// content, so the user never has to pick the broker. A new broker is an entry
// here (and in CSV_IMPORTERS if it has a CSV export), its transformer or PDF
// parser, and tests (#79).
export type ImportFormat = "trade-republic" | "scalable" | "dkb";

export const FORMAT_LABEL: Record<ImportFormat, string> = {
  "trade-republic": "Trade Republic",
  scalable: "Scalable Capital",
  dkb: "DKB",
};

// Every broker, in the order the settings show them.
export const FORMATS = Object.keys(FORMAT_LABEL) as ImportFormat[];

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// A broker's CSV export: how its header looks, how it is parsed and transformed, and the broker's own cash
// balance computed from it (reconcile.ts).
interface CsvImporter {
  format: ImportFormat;
  detect(header: string): boolean;
  read(body: string, config: BrokerConfig): { rows: number; result: TransformResult; brokerCash: number };
}

const CSV_IMPORTERS: CsvImporter[] = [
  {
    format: "scalable",
    detect: (header) => /^"?Datum"?;"?Uhrzeit"?;"?Typ"?;/.test(header),
    read(body, config) {
      const rows = Papa.parse<ScRow>(body, { header: true, delimiter: ";", skipEmptyLines: true }).data;
      return { rows: rows.length, result: transformScalable(rows, config), brokerCash: scalableBrokerCash(rows) };
    },
  },
  {
    format: "trade-republic",
    detect: (header) => header.includes("datetime") && header.includes("transaction_id"),
    read(body, config) {
      const rows = Papa.parse<TrRow>(body, { header: true, skipEmptyLines: true }).data;
      return { rows: rows.length, result: transform(rows, config), brokerCash: trBrokerCash(rows) };
    },
  },
];

export function detectFormat(text: string): ImportFormat | null {
  const header = stripBom(text).split(/\r?\n/, 1)[0] ?? "";
  return CSV_IMPORTERS.find((c) => c.detect(header))?.format ?? null;
}

// The Wealthfolio cash/securities account pair a broker imports into - the
// same pair for its CSV export and its PDF statements.
export function formatAccounts(format: ImportFormat, settings: AddonSettings): BrokerAccounts {
  return settings.brokers[format];
}

// The broker and side (cash/securities) of each configured account, for a
// label when the Wealthfolio account itself is unknown (e.g. archived).
export function configuredAccount(settings: AddonSettings, id: string): { broker: ImportFormat; side: "cash" | "portfolio" } | null {
  for (const broker of FORMATS) {
    const pair = formatAccounts(broker, settings);
    if (id === pair.cashAccountId) return { broker, side: "cash" };
    if (id === pair.portfolioAccountId) return { broker, side: "portfolio" };
  }
  return null;
}

// What a broker's transformer gets: its accounts and the transfer patterns.
export function brokerConfig(format: ImportFormat, settings: AddonSettings): BrokerConfig {
  return { ...settings.brokers[format], transferPatterns: settings.transferPatterns };
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
  const importer = CSV_IMPORTERS.find((c) => c.format === format);
  if (!format || !importer) {
    return failure(msg("upload.unrecognisedCsv"));
  }
  if (!isFormatConfigured(format, settings)) {
    return failure(msg("upload.selectAccounts", { broker: FORMAT_LABEL[format] }));
  }
  const config = brokerConfig(format, settings);
  const { rows, result, brokerCash } = importer.read(stripBom(text), config);
  if (rows === 0) return failure(msg("upload.noRows", { broker: FORMAT_LABEL[format] }));
  return { ok: true, format, result, brokerCash: { currency: config.cashCurrency || "EUR", amount: brokerCash } };
}
