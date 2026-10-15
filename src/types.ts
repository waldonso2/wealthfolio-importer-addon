import type { ActivityImport, SymbolSearchResult } from "@wealthfolio/addon-sdk";
import type { ImportFormat } from "./formats";
import type { Params } from "./i18n";

export interface TrRow {
  datetime: string;
  date: string;
  account_type: string;
  type: string;
  category: string;
  currency: string;
  amount: string;
  fee: string;
  tax: string;
  description: string;
  counterparty_name: string;
  counterparty_iban: string;
  symbol: string;
  name: string;
  shares: string;
  price: string;
  asset_class: string;
  transaction_id: string;
  original_amount: string;
  original_currency: string;
  fx_rate: string;
  mcc_code: string;
  [key: string]: string;
}

// One row of a Scalable Capital transaction export (German headers, ";"-separated,
// decimal comma). All values are raw strings exactly as exported.
export interface ScRow {
  Datum: string;
  Uhrzeit: string;
  Typ: string;
  Wertpapiername: string;
  ISIN: string;
  Wert: string;
  Stück: string;
  Buchungswährung: string;
  Gebühren: string;
  Steuern: string;
  Bruttobetrag: string;
  Notiz: string;
  [key: string]: string;
}

export interface TransferPattern {
  iban?: string;
  keyword?: string;
  label: string;
  destinationAccountId?: string;
}

// Resolution for one Trade Republic ISIN: either a chosen ticker (from
// ctx.api.market.searchTicker) or "custom" to keep the ISIN as the symbol.
export type SecurityMapping = SymbolSearchResult | "custom";

// The Wealthfolio account pair a broker imports into (its CSV export and its PDF statements alike), and the
// currency of its cash account.
export interface BrokerAccounts {
  cashAccountId: string;
  portfolioAccountId: string;
  cashCurrency: string;
}

// What a transformer gets: the broker's accounts and the transfer patterns.
export type BrokerConfig = BrokerAccounts & { transferPatterns: TransferPattern[] };

export interface AddonSettings {
  // One account pair per broker (#79), so users of several brokers never mix them. Settings saved before 3.9.4
  // (named fields per broker) are taken over on load (settings.ts).
  brokers: Record<ImportFormat, BrokerAccounts>;
  transferPatterns: TransferPattern[];
  // ISIN -> resolved mapping, persisted so recurring imports of the same
  // security don't require re-mapping every time.
  securityMappings: Record<string, SecurityMapping>;
  // ISIN -> security name as in the broker's file, remembered with the mapping:
  // warns when the mapped asset looks like another product and preselects the
  // activities of that ISIN when a mapping is corrected (#41).
  securityNames: Record<string, string>;
}

// "netted": skipped on purpose, its effect is already covered (a reversal and the
// row it cancels, a technical rebooking) - nothing to do. "missing": not
// imported - Wealthfolio will differ from the broker until the user adds it.
export type SkipKind = "netted" | "missing";

export interface SkippedRow {
  datetime: string;
  type: string;
  category: string;
  description: string;
  reason: string;
  kind?: SkipKind;
  // What the user can do about a "missing" row.
  hint?: string;
  // The same texts for the UI (#74): translation keys of `type`, `reason` and
  // `hint` and their params (src/i18n.ts). `reason`/`hint` stay English.
  typeKey?: string;
  reasonKey?: string;
  hintKey?: string;
  params?: Params;
}

// ActivityImport (the CSV-import-shaped SDK type) has no sourceGroupId field —
// only Activity/ActivityCreate/ActivityUpdate do. We carry our own
// transferGroupId through transform() and translate it to sourceGroupId when
// building the ActivityCreate/ActivityUpdate payloads in ImportPage.
export type ActivityImportEx = ActivityImport & { transferGroupId?: string };

export interface TransformResult {
  activities: ActivityImportEx[];
  skipped: SkippedRow[];
}
