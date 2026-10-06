import {
  AMOUNT,
  DATE,
  ISIN,
  berlinDateTime,
  first,
  lines,
  parseNum,
  round2,
  unsupported,
  validated,
  type PdfParseResult,
  type PdfTransaction,
} from "./model";

// DKB securities statements: Wertpapier Abrechnung Kauf/Verkauf and
// Dividendengutschrift / Ausschüttung / Ertragsgutschrift. Amounts carry their
// sign behind the number ("4.972,20- EUR", "17,95+ EUR").

export function isDkb(text: string): boolean {
  // Letterhead postcode (newer statements) or DKB's BIC in the booking note.
  return /^10919 Berlin\b/m.test(text) || /Deutsche Kreditbank|\bDKB AG\b|BIC BYLADEM1001/.test(text);
}

const TAX_LINE = new RegExp(`^(Kapitalertragsteuer|Solidaritätszuschlag|Kirchensteuer) .* (${AMOUNT})([-+])? EUR$`);

// "Stück 86 XTR.NASDAQ 100 ETF IE00BMFKG444 (A2QJU3)" → [_, unit, amount, name,
// isin]. Some statements put the ISIN on a line of its own further down.
function findPosition(ls: string[]): [string, string, string, string, string] | undefined {
  const full = first(ls, new RegExp(`^(St(?:ü|u)ck|[A-Z]{3}) (${AMOUNT}) (.+) (${ISIN}) \\([A-Z0-9]{6}\\)$`));
  if (full) return [full[0], full[1], full[2], full[3], full[4]];
  const header = ls.findIndex((l) => /^Nominale Wertpapierbezeichnung/.test(l));
  if (header < 0) return undefined;
  const pos = new RegExp(`^(St(?:ü|u)ck|[A-Z]{3}) (${AMOUNT}) (.+)$`).exec(ls[header + 1] ?? "");
  const isin = first(ls.slice(header + 2, header + 5), new RegExp(`^(${ISIN}) \\([A-Z0-9]{6}\\)$`));
  return pos && isin ? [pos[0], pos[1], pos[2], pos[3], isin[1]] : undefined;
}

export function parseDkb(text: string): PdfParseResult {
  const ls = lines(text);
  const num = (s: string) => parseNum(s, ",");
  if (ls.some((l) => /^Storno\b/.test(l))) {
    return unsupported("dkb", "Storno", "Cancellations (Storno) are not supported - leave both documents out.");
  }
  const position = findPosition(ls);
  const name = position?.[3] ?? "";

  // Fund units bought from / returned to the fund company: "Ausgabe" /
  // "Rücknahme Investmentfonds".
  const trade = first(ls, /^Wertpapier Abrechnung (Kauf|Verkauf|Ausgabe Investmentfonds|Rücknahme Investmentfonds)\b/);
  if (trade) {
    const kind = trade[1] === "Kauf" || trade[1].startsWith("Ausgabe") ? "BUY" : "SELL";
    const title = `${trade[1]} ${name}`.trim();
    if (!position || !position[1].startsWith("St")) {
      return unsupported("dkb", title, "Only securities quoted per piece are supported (no bonds quoted in percent).");
    }
    const when = first(ls, new RegExp(`^Schlusstag(?:/-Zeit)? (${DATE})(?: (\\d{2}:\\d{2}:\\d{2}))?`));
    const value = first(ls, new RegExp(`^Kurswert (${AMOUNT})-? ([A-Z]{3})$`));
    const total = first(ls, new RegExp(`^Ausmachender Betrag (${AMOUNT})[-+]? ([A-Z]{3})$`));
    if (!when || !value || !total) return unsupported("dkb", title, "Trade date, market value or booked amount not found.");
    if (value[2] !== total[2]) return unsupported("dkb", title, "Market value and booked amount are in different currencies.");
    let tax = 0;
    for (const l of ls) {
      const m = TAX_LINE.exec(l);
      if (m) tax += m[3] === "+" ? -num(m[2]) : num(m[2]);
    }
    const order = first(ls, /\bAuftragsnummer (\S+)/) ?? first(ls, /Abrechnungsnr\. (\d+)/);
    const tx: PdfTransaction = {
      kind,
      label: trade[1],
      docId: order?.[1] ?? `${position[4]}-${when[1]}-${when[2] ?? ""}`,
      isin: position[4],
      name,
      shares: num(position[2]),
      datetime: berlinDateTime(when[1], when[2]),
      currency: total[2],
      gross: num(value[1]),
      tax: round2(tax),
      net: num(total[1]),
    };
    return validated("dkb", tx);
  }

  const income = first(
    ls,
    new RegExp(`^(Dividendengutschrift|Ausschüttung|Ertragsgutschrift)\\b.*? (?:(${AMOUNT}) ([A-Z]{3}) )?(${AMOUNT})\\+ EUR$`),
  );
  if (income) {
    const label = income[1];
    const title = `${label} ${name}`.trim();
    if (!position || !position[1].startsWith("St")) return unsupported("dkb", title, "No share position found.");
    const total = first(ls, new RegExp(`^Ausmachender Betrag (${AMOUNT})\\+? ([A-Z]{3})$`));
    const valueDate = first(ls, new RegExp(`(?:Wertstellung|Valuta) (${DATE})`));
    const rate = first(ls, new RegExp(`^Devisenkurs [A-Z]{3} / [A-Z]{3} (${AMOUNT})`));
    const reference = first(ls, /Abrechnungsnr\. (\d+)/);
    if (!total || !valueDate) return unsupported("dkb", title, "Booked amount or value date not found.");
    const gross = num(income[4]);
    const net = num(total[1]);
    const tx: PdfTransaction = {
      kind: "DIVIDEND",
      label,
      docId: reference?.[1] ?? `${position[4]}-${valueDate[1]}`,
      isin: position[4],
      name,
      shares: num(position[2]),
      datetime: berlinDateTime(valueDate[1]),
      currency: total[2],
      gross,
      tax: round2(gross - net),
      net,
      original:
        income[2] && income[3] && rate ? { amount: num(income[2]), currency: income[3], rate: num(rate[1]) } : undefined,
    };
    return validated("dkb", tx);
  }

  const known = ls.find((l) => /^(Zinsgutschrift|Vorabpauschale|Halbjahresabrechnung Sparplan|Kontoauszug|Depotbuchung)\b/.test(l));
  return unsupported(
    "dkb",
    known ?? "Unknown document",
    "Only trade statements (Wertpapier Abrechnung Kauf/Verkauf) and dividend statements are supported.",
  );
}
