import {
  AMOUNT,
  DATE,
  ISIN,
  berlinDateTime,
  decimalOf,
  first,
  germanDate,
  hash,
  lines,
  parseNum,
  round2,
  section,
  unsupported,
  validated,
  type PdfParseResult,
  type PdfTransaction,
} from "./model";

// Trade Republic statements (German): Wertpapierabrechnung (Kauf, Verkauf,
// Sparplan, Round up, Saveback) and Dividende / Ausschüttung.
// Layout: header with AUSFÜHRUNG/AUFTRAG ids, then ÜBERSICHT (position, GESAMT),
// ABRECHNUNG (charges and taxes, GESAMT) and BUCHUNG (cash account, date, amount).

export function isTradeRepublic(text: string): boolean {
  return /TRADE REPUBLIC BANK GMBH|Trade Republic Bank GmbH/.test(text);
}

// Income taxes on a trade; "Zinssteuer" appears on Austrian accounts.
const TAX_LINE = /^(Kapitalertrags?steuer|Solidaritätszuschlag|Kirchensteuer|Zinssteuer)\b/;
const BOOKING = new RegExp(`^.+? (${DATE}|\\d{4}-\\d{2}-\\d{2}) (-?${AMOUNT}) ([A-Z]{3})$`);

export function parseTradeRepublic(text: string): PdfParseResult {
  const ls = lines(text);
  const heading = ls.find((l) =>
    /^(WERTPAPIERABRECHNUNG( .+)?|DIVIDENDE|(BAR)?AUSSCHÜTTUNG)$/.test(l),
  );
  if (!heading) {
    const known = ls.find((l) => /^(VORABPAUSCHALE|KONTOAUSZUG|KONTOÜBERSICHT|STEUERABRECHNUNG|ABRECHNUNG ZINSEN|ZINSZAHLUNG|SPLIT|STORNO|SECURITIES SETTLEMENT|DIVIDEND)\b/.test(l));
    return unsupported(
      "trade-republic",
      known ?? "Unknown document",
      "Only German trade statements (Kauf, Verkauf, Sparplan) and dividend statements are supported.",
    );
  }
  if (ls.some((l) => /^STORNO\b|STORNIERUNG/.test(l))) {
    return unsupported("trade-republic", heading, "Cancellations (Storno) are not supported - leave both documents out.");
  }

  // Booking line, e.g. "DE50… 2026-07-09 -4.533,40 EUR". Its amount tells the
  // document's decimal separator (newer statements mix both notations).
  const bookingIdx = ls.findIndex((l) => /^VERRECHNUNGSKONTO\b/.test(l));
  const booking = bookingIdx >= 0 ? first(ls.slice(bookingIdx + 1, bookingIdx + 4), BOOKING) : undefined;
  if (!booking) return unsupported("trade-republic", heading, "No cash booking (BUCHUNG) found.");
  const dec = decimalOf(booking[2]);
  const num = (s: string) => parseNum(s, dec);
  // Signed as booked: negative for a purchase.
  const booked = num(booking[2]);
  const currency = booking[3];

  const overview = section(ls, /^ÜBERSICHT$/, /^(ABRECHNUNG|BUCHUNG)$/);
  const total = first(overview, new RegExp(`^GESAMT (${AMOUNT}) ([A-Z]{3})$`));
  // Usually its own line ("ISIN: …" or the bare ISIN); some statements glue it
  // to the end of the position line.
  const isinLine =
    first(overview, new RegExp(`^(?:ISIN: )?(${ISIN})(?: |$)`)) ?? first(overview, new RegExp(`[A-Z]{3}(${ISIN})$`));
  const posHeader = overview.findIndex((l) => /^POSITION ANZAHL/.test(l));
  const firstPos = posHeader >= 0 ? overview[posHeader + 1] ?? "" : "";
  const name = firstPos
    .replace(new RegExp(` ${AMOUNT} (Stk\\.|Stücke).*$`), "")
    .replace(new RegExp(` ${AMOUNT} [A-Z]{3}$`), "")
    .trim();
  const sharesMatch = first(overview, new RegExp(`(${AMOUNT}) (?:Stk\\.|Stücke)`));
  if (!total || !sharesMatch) return unsupported("trade-republic", heading, "No position (ÜBERSICHT) found.");
  const shares = num(sharesMatch[1]);
  const isin = isinLine?.[1] ?? "";

  if (heading.startsWith("WERTPAPIERABRECHNUNG")) {
    // "Limit-Order Kauf am 07.07.2026, um 07:30 Uhr", "Market-Order SELL am
    // 18.03.2026 um 19:05", "Sparplanausführung am …", "Ausführung von Round up
    // am …", "Kindergeld-Ausführung am …".
    const sentence = first(
      overview,
      new RegExp(`(Kauf|Verkauf|BUY|SELL|Sparplanausführung|Ausführung von [\\w ]+?|\\S+-Ausführung) am (${DATE})(?:,? um (\\d{2}:\\d{2}))?`),
    );
    if (!sentence) return unsupported("trade-republic", heading, "Execution date not found.");
    const kind = sentence[1] === "Verkauf" || sentence[1] === "SELL" ? "SELL" : "BUY";
    const label =
      sentence[1] === "Sparplanausführung"
        ? "Sparplan"
        : sentence[1] === "BUY"
          ? "Kauf"
          : sentence[1] === "SELL"
            ? "Verkauf"
            : sentence[1].replace(/^Ausführung von /, "").replace(/-Ausführung$/, "");
    const billing = section(ls, /^ABRECHNUNG$/, /^(GESAMT|BUCHUNG)\b/);
    // Taxes are listed as charges ("-19,71 EUR"); a positive one is a refund.
    let tax = 0;
    for (const l of billing) {
      const m = TAX_LINE.test(l) ? new RegExp(`(-?${AMOUNT}) [A-Z]{3}$`).exec(l) : null;
      if (m) tax -= num(m[1]);
    }
    const ref = first(ls, /\bAUSFÜHRUNG ([0-9a-f]{4}-[0-9a-f]{4})\b/) ?? first(ls, /\b(?:AUFTRAG|ORDER) ([0-9a-f]{4}-[0-9a-f]{4})\b/);
    const tx: PdfTransaction = {
      kind,
      label,
      docId: ref?.[1] ?? hash(text),
      isin,
      name,
      shares,
      datetime: berlinDateTime(sentence[2], sentence[3]),
      currency,
      gross: num(total[1]),
      tax: round2(tax),
      net: kind === "BUY" ? -booked : booked,
    };
    return validated("trade-republic", tx);
  }

  // Dividend / distribution: gross in the payout currency, converted with the
  // rate on the "Zwischensumme <rate> USD/EUR" line (foreign units per EUR).
  const grossFx = num(total[1]);
  const fxCurrency = total[2];
  let gross = grossFx;
  let original: PdfTransaction["original"];
  if (fxCurrency !== currency) {
    const rateLine = first(ls, new RegExp(`(${AMOUNT}) (?:${fxCurrency}/${currency}|${currency}/${fxCurrency}) `));
    const rate = rateLine ? num(rateLine[1]) : NaN;
    if (!(rate > 0)) return unsupported("trade-republic", heading, "Exchange rate not found.");
    gross = round2(grossFx / rate);
    original = { amount: grossFx, currency: fxCurrency, rate };
  }
  const payDate = germanDate(booking[1]);
  const tx: PdfTransaction = {
    kind: "DIVIDEND",
    label: heading === "DIVIDENDE" ? "Dividende" : heading === "AUSSCHÜTTUNG" ? "Ausschüttung" : "Barausschüttung",
    docId: `${isin}-${payDate}`,
    isin,
    name,
    shares,
    datetime: berlinDateTime(payDate),
    currency,
    gross,
    tax: round2(gross - booked),
    net: booked,
    original,
  };
  return validated("trade-republic", tx);
}
