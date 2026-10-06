import type { ImportFormat } from "../formats";
import { berlinToIso } from "../scalable";

// What a broker statement (PDF) says, independent of the broker. The parsers
// (tradeRepublic.ts, scalable.ts, dkb.ts) turn the text of one PDF into this;
// activities.ts maps it to Wealthfolio activities.

export type PdfBroker = ImportFormat;

export interface PdfTransaction {
  kind: "BUY" | "SELL" | "DIVIDEND";
  // The statement's own type, e.g. "Kauf", "Sparplan", "Dividende" - for comments.
  label: string;
  // The broker's reference for this transaction (execution, order or statement
  // number). Part of the comment, so re-importing the same PDF is recognised
  // as a duplicate, and used to drop a PDF that was uploaded twice.
  docId: string;
  isin: string;
  name: string;
  shares: number;
  // Execution time for trades, payment date (noon, Berlin) for dividends. ISO, UTC.
  datetime: string;
  // Booking currency of the cash account.
  currency: string;
  // Market value of a trade or gross income of a dividend, in `currency`.
  gross: number;
  // Income taxes (Kapitalertragsteuer, Soli, Kirchensteuer; for dividends also
  // withholding tax): positive = charged, negative = refunded (e.g. Trade
  // Republic's tax optimisation credited with a dividend).
  tax: number;
  // The amount booked on the cash account (always positive).
  net: number;
  // Dividends paid in a foreign currency: the original gross and the rate.
  original?: { amount: number; currency: string; rate: number };
}

export type PdfParseResult =
  | { ok: true; broker: PdfBroker; tx: PdfTransaction }
  // `title`: what the document is, as far as it could be told; `reason`: why
  // it isn't imported.
  | { ok: false; broker: PdfBroker | null; title: string; reason: string };

// ── Numbers ─────────────────────────────────────────────────────────────────
// Statements use German ("4.532,40") and, in newer Trade Republic PDFs, English
// ("140.36", "3.226355") notation - sometimes both in one document. A single
// separator followed by exactly three digits is ambiguous ("1.000"), so the
// caller passes the document's decimal separator for that case.
export type DecimalSep = "," | ".";

export function parseNum(raw: string, decimal: DecimalSep = ","): number {
  let s = raw.trim().replace(/\s/g, "");
  let sign = 1;
  if (/^[-+]/.test(s)) {
    if (s[0] === "-") sign = -1;
    s = s.slice(1);
  }
  if (/[-+]$/.test(s)) {
    if (s.endsWith("-")) sign = -1;
    s = s.slice(0, -1);
  }
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let sep: DecimalSep | null = null;
  if (lastComma >= 0 && lastDot >= 0) sep = lastComma > lastDot ? "," : ".";
  else if (lastComma >= 0 || lastDot >= 0) {
    const c = lastComma >= 0 ? "," : ".";
    const count = s.split(c).length - 1;
    const digitsAfter = s.length - s.lastIndexOf(c) - 1;
    if (count > 1) sep = null; // "1.234.567": thousands only
    else if (digitsAfter !== 3) sep = c;
    else sep = c === decimal ? c : null;
  }
  const thousands = sep === "," ? "." : ",";
  let normalized = s.split(sep === null ? /[.,]/ : thousands).join("");
  if (sep === ",") normalized = normalized.replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? sign * n : NaN;
}

// The decimal separator a money amount like "4.532,40" or "100.79" uses.
export function decimalOf(amount: string): DecimalSep {
  return /\.\d{2}[-+]?$/.test(amount.trim()) ? "." : ",";
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Dates ───────────────────────────────────────────────────────────────────
// "07.07.2026" or "2026-07-07" → "07.07.2026".
export function germanDate(s: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return iso ? `${iso[3]}.${iso[2]}.${iso[1]}` : s;
}

// Berlin local date (+ time) → ISO UTC. Without a time, noon, so the date
// stays the same in every time zone.
export function berlinDateTime(date: string, time?: string): string {
  const t = time ? (time.length === 5 ? `${time}:00` : time) : "12:00:00";
  return berlinToIso(germanDate(date), t);
}

// ── Text helpers ────────────────────────────────────────────────────────────
export const ISIN = "[A-Z]{2}[A-Z0-9]{9}[0-9]";
export const AMOUNT = "[0-9][0-9.,]*";
export const DATE = "[0-9]{2}\\.[0-9]{2}\\.[0-9]{4}";

export function lines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

// First capture group of the first line matching `re`, or undefined.
export function first(ls: string[], re: RegExp): RegExpExecArray | undefined {
  for (const l of ls) {
    const m = re.exec(l);
    if (m) return m;
  }
  return undefined;
}

// Lines from the first one matching `start` (exclusive) up to the next one
// matching `end` (exclusive).
export function section(ls: string[], start: RegExp, end: RegExp): string[] {
  const i = ls.findIndex((l) => start.test(l));
  if (i < 0) return [];
  const out: string[] = [];
  for (const l of ls.slice(i + 1)) {
    if (end.test(l)) break;
    out.push(l);
  }
  return out;
}

// Stable 32-bit FNV-1a hash, for documents without a reference number.
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function unsupported(broker: PdfBroker | null, title: string, reason: string): PdfParseResult {
  return { ok: false, broker, title, reason };
}

// Fee of a trade: everything between market value and booked amount that isn't
// an income tax. Negative means the statement holds amounts the import doesn't
// understand (e.g. accrued interest on a bond) - those are rejected.
export function tradeFee(tx: Pick<PdfTransaction, "kind" | "gross" | "net" | "tax">): number {
  const charges = tx.kind === "BUY" ? tx.net - tx.gross : tx.gross - tx.net;
  return round2(charges - tx.tax);
}

// Checks shared by all parsers; returns the transaction or why it's rejected.
export function validated(broker: PdfBroker, tx: PdfTransaction): PdfParseResult {
  const title = `${tx.label} ${tx.name}`.trim();
  if (!tx.isin) return unsupported(broker, title, "No ISIN found.");
  if (!(tx.shares > 0)) return unsupported(broker, title, "No share count found.");
  if (!(tx.net >= 0) || Number.isNaN(tx.gross) || Number.isNaN(tx.tax)) {
    return unsupported(broker, title, "Amounts could not be read.");
  }
  if (tx.kind !== "DIVIDEND" && tradeFee(tx) < 0) {
    return unsupported(
      broker,
      title,
      "Market value, taxes and booked amount don't add up - the statement holds amounts the PDF import doesn't handle (e.g. accrued interest).",
    );
  }
  return { ok: true, broker, tx };
}
