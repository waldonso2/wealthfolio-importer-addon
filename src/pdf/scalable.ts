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

// Scalable Capital statements (German, issued by Scalable Capital Bank GmbH):
// Wertpapierabrechnung (Kauf, Verkauf, also from savings plans) and Dividende.
// Older statements issued by Baader Bank have a different layout and are not
// recognised here.

export function isScalable(text: string): boolean {
  return /Scalable Capital (Bank )?GmbH/.test(text);
}

export function parseScalable(text: string): PdfParseResult {
  const ls = lines(text);
  const num = (s: string) => parseNum(s, ",");

  if (ls.some((l) => l === "Wertpapierabrechnung")) {
    const pos = first(
      ls,
      new RegExp(`^(Kauf|Verkauf) (.+) (${AMOUNT}) Stk\\. (${AMOUNT}) [A-Z]{3} (${AMOUNT}) ([A-Z]{3})$`),
    );
    if (!pos) return unsupported("scalable", "Wertpapierabrechnung", "No Kauf/Verkauf position found.");
    const kind = pos[1] === "Kauf" ? "BUY" : "SELL";
    const posIdx = ls.indexOf(pos[0]);
    const isin = first(ls.slice(posIdx + 1, posIdx + 3), new RegExp(`^(${ISIN})$`))?.[1] ?? "";
    const exec = first(ls, new RegExp(`^Ausführung (${DATE}) (\\d{2}:\\d{2}:\\d{2})(?: Geschäft (\\S+))?`));
    const order = first(ls, /^Typ .* Order (\S+)$/);
    // "Belastung"/"Gutschrift"; statements before 2025 say "Total".
    const total = first(ls, new RegExp(`^(Belastung|Gutschrift|Total) (${AMOUNT}) ([A-Z]{3})$`));
    if (!exec || !total) return unsupported("scalable", `${pos[1]} ${pos[2]}`, "Execution or booked amount not found.");
    // "Steuern" carries the sign of its effect on the cash: -x on a sale is a
    // charge, +x on a purchase too.
    const steuern = first(ls, new RegExp(`^Steuern ([-+]?${AMOUNT}) [A-Z]{3}$`));
    const signed = steuern ? num(steuern[1]) : 0;
    const tx: PdfTransaction = {
      kind,
      label: pos[1],
      docId: exec[3] ?? order?.[1] ?? `${isin}-${exec[1]}-${exec[2]}`,
      isin,
      name: pos[2],
      shares: num(pos[3]),
      datetime: berlinDateTime(exec[1], exec[2]),
      currency: total[3],
      gross: num(pos[5]),
      tax: round2(kind === "BUY" ? signed : -signed),
      net: num(total[2]),
    };
    return validated("scalable", tx);
  }

  if (ls.some((l) => l === "Dividende" || l === "Ausschüttung")) {
    const label = ls.includes("Dividende") ? "Dividende" : "Ausschüttung";
    const isin = first(ls, new RegExp(`^ISIN (${ISIN})$`))?.[1] ?? "";
    const name = first(ls, /^Berechtigtes Wertpapier (.+)$/)?.[1] ?? "";
    // pdf.js trims lines, so no trailing space is required after the number.
    const shares = first(ls, new RegExp(`^Berechtigte Anzahl (${AMOUNT})`));
    const credit = first(ls, new RegExp(`^(${DATE}) (${DATE}) Gutschrift .* (${AMOUNT}) ([A-Z]{3})$`));
    const total = first(ls, new RegExp(`^Gesamtbetrag (${AMOUNT}) ([A-Z]{3})$`));
    if (!shares || !credit || !total) return unsupported("scalable", `${label} ${name}`.trim(), "Dividend amounts not found.");
    const perShare = first(ls, new RegExp(`Gutschrift (${AMOUNT}) ([A-Z]{3}) ${AMOUNT} ${AMOUNT} [A-Z]{3}$`));
    const rate = first(ls, new RegExp(`^([A-Z]{3}) / ([A-Z]{3}) (${AMOUNT})$`));
    const gross = num(credit[3]);
    const net = num(total[1]);
    const original =
      perShare && rate && perShare[2] !== total[2]
        ? { amount: round2(num(perShare[1]) * num(shares[1])), currency: perShare[2], rate: num(rate[3]) }
        : undefined;
    const tx: PdfTransaction = {
      kind: "DIVIDEND",
      label,
      docId: `${isin}-${credit[1]}`,
      isin,
      name,
      shares: num(shares[1]),
      datetime: berlinDateTime(credit[1]),
      currency: total[2],
      gross,
      tax: round2(gross - net),
      net,
      original,
    };
    return validated("scalable", tx);
  }

  const known = ls.find((l) => /^(Vorabpauschale|Steuerneuberechnung|Rechnungsabschluss|Zinszahlung|Kapitalrückzahlung|Verrechnungskonto)\b/.test(l));
  return unsupported(
    "scalable",
    known ?? "Unknown document",
    "Only trade statements (Wertpapierabrechnung) and dividend statements are supported.",
  );
}
