import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { reconcile } from "../reconcile";
import type { AddonSettings } from "../types";
import { pdfBroker, transformPdfs, type PdfFile } from "./activities";
import { parsePdfFiles } from "./index";
import { decimalOf, parseNum, tradeFee, type PdfTransaction } from "./model";
import { parsePdfText } from "./parse";
import { pdfToPages } from "./text";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(__dirname, "../__fixtures__/pdf", name), "utf-8");

const SETTINGS: AddonSettings = {
  cashAccountId: "tr-cash",
  cashCurrency: "EUR",
  portfolioAccountId: "tr-portfolio",
  scalableCashAccountId: "sc-cash",
  scalableCashCurrency: "EUR",
  scalablePortfolioAccountId: "sc-portfolio",
  dkbCashAccountId: "dkb-cash",
  dkbPortfolioAccountId: "dkb-portfolio",
  transferPatterns: [],
  securityMappings: {},
};

function tx(name: string): PdfTransaction {
  const r = parsePdfText(fixture(name));
  if (!r.ok) throw new Error(`${name}: ${r.reason}`);
  return r.tx;
}

// Minimal PDF with Helvetica text items at the given positions, one array per
// page - enough for pdf.js to extract.
function makePdf(pages: { x: number; y: number; s: string }[][]): Uint8Array {
  const latin1 = (s: string) =>
    [...s]
      .map((c) => {
        const code = c.charCodeAt(0);
        if (c === "(" || c === ")" || c === "\\") return `\\${c}`;
        return code > 126 ? `\\${code.toString(8).padStart(3, "0")}` : c;
      })
      .join("");
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) - 1 + 1;
  const catalog = add("");
  const pagesObj = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const kids: number[] = [];
  for (const items of pages) {
    const stream = items.map((i) => `BT /F1 10 Tf ${i.x} ${i.y} Td (${latin1(i.s)}) Tj ET`).join("\n");
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0));
}

const linesToPdf = (text: string) =>
  makePdf([text.split("\n").filter(Boolean).map((s, i) => ({ x: 40, y: 800 - i * 14, s }))]);

describe("parseNum / decimalOf", () => {
  it("German, English and signed notations", () => {
    expect(parseNum("4.532,40")).toBe(4532.4);
    expect(parseNum("-1,00")).toBe(-1);
    expect(parseNum("4.972,20-")).toBe(-4972.2);
    expect(parseNum("17,95+")).toBe(17.95);
    expect(parseNum("140.36", ".")).toBe(140.36);
    expect(parseNum("3.226355", ".")).toBe(3.226355);
    expect(parseNum("22.165,00")).toBe(22165);
    expect(parseNum("1,234.50", ".")).toBe(1234.5);
  });

  it("a lone separator before three digits follows the document's notation", () => {
    expect(parseNum("1.000", ",")).toBe(1000);
    expect(parseNum("1.000", ".")).toBe(1);
    expect(parseNum("1,102", ",")).toBe(1.102);
    expect(decimalOf("-4.533,40")).toBe(",");
    expect(decimalOf("100.79")).toBe(".");
  });
});

describe("Trade Republic", () => {
  it("purchase: market value, fee from the charges, execution time in UTC", () => {
    expect(tx("tr-kauf.txt")).toMatchObject({
      kind: "BUY",
      label: "Kauf",
      docId: "e5f6-0789",
      isin: "IE00TEST0001",
      name: "Test World Equity EUR (Acc)",
      shares: 120,
      datetime: "2026-03-03T08:15:00.000Z",
      currency: "EUR",
      gross: 3015,
      tax: 0,
      net: 3016,
    });
    expect(tradeFee(tx("tr-kauf.txt"))).toBe(1);
  });

  it("sale: taxes separate from the fee", () => {
    const t = tx("tr-verkauf.txt");
    expect(t).toMatchObject({ kind: "SELL", docId: "2222-bbbb", gross: 1000, tax: 10.55, net: 988.45 });
    expect(tradeFee(t)).toBe(1);
  });

  it("dividend in USD with English number notation: gross converted, tax = gross - net", () => {
    expect(tx("tr-dividende.txt")).toMatchObject({
      kind: "DIVIDEND",
      label: "Dividende",
      isin: "IE00TEST0003",
      name: "Test High Dividend USD (Dist)",
      shares: 200,
      datetime: "2026-09-30T10:00:00.000Z",
      gross: 100,
      tax: 18.46,
      net: 81.54,
      original: { amount: 110, currency: "USD", rate: 1.1 },
    });
  });

  it("documents other than trades and dividends are reported, not guessed", () => {
    const r = parsePdfText("TRADE REPUBLIC BANK GMBH BRUNNENSTRASSE 19-21 10119 BERLIN\nVORABPAUSCHALE\n");
    expect(r).toMatchObject({ ok: false, broker: "trade-republic", title: "VORABPAUSCHALE" });
  });
});

describe("Scalable Capital", () => {
  it("purchase", () => {
    const t = tx("sc-kauf.txt");
    expect(t).toMatchObject({
      kind: "BUY",
      docId: "1000000001",
      isin: "IE00TEST0004",
      shares: 4,
      datetime: "2026-06-16T17:38:52.000Z",
      gross: 2402,
      tax: 0,
      net: 2402.99,
    });
    expect(tradeFee(t)).toBe(0.99);
  });

  it("sale with taxes", () => {
    const t = tx("sc-verkauf.txt");
    expect(t).toMatchObject({ kind: "SELL", gross: 2000, tax: 52.75, net: 1946.26 });
    expect(tradeFee(t)).toBe(0.99);
  });

  it("dividend: gross and tax, which the CSV export doesn't have", () => {
    expect(tx("sc-dividende.txt")).toMatchObject({
      kind: "DIVIDEND",
      isin: "IE00TEST0004",
      shares: 10,
      gross: 20,
      tax: 3.69,
      net: 16.31,
      original: { amount: 22, currency: "USD", rate: 1.1 },
    });
  });
});

describe("DKB", () => {
  it("purchase", () => {
    const t = tx("dkb-kauf.txt");
    expect(t).toMatchObject({
      kind: "BUY",
      docId: "123456/78.00",
      isin: "IE00TEST0006",
      name: "TEST NASDAQ 100 ETF",
      shares: 40,
      datetime: "2026-05-11T18:58:34.000Z",
      gross: 2000,
      net: 2010,
    });
    expect(tradeFee(t)).toBe(10);
  });

  it("fund distribution in USD", () => {
    expect(tx("dkb-ausschuettung.txt")).toMatchObject({
      kind: "DIVIDEND",
      label: "Ausschüttung",
      docId: "99999999901",
      isin: "IE00TEST0007",
      shares: 50,
      datetime: "2026-08-19T10:00:00.000Z",
      gross: 50,
      tax: 9.23,
      net: 40.77,
      original: { amount: 55, currency: "USD", rate: 1.1 },
    });
  });

  it("cancellations and bonds are rejected", () => {
    expect(parsePdfText(`${fixture("dkb-kauf.txt")}\nStorno zur Wertpapier Abrechnung vom 01.05.2026`).ok).toBe(false);
    const bond = fixture("dkb-kauf.txt").replace("Stück 40 TEST NASDAQ 100 ETF", "EUR 2.000,00 5 % TEST ANLEIHE");
    expect(parsePdfText(bond)).toMatchObject({ ok: false, reason: expect.stringContaining("bonds") });
  });
});

describe("activities", () => {
  const files = (...names: string[]): PdfFile[] => names.map((n) => ({ file: n, result: parsePdfText(fixture(n)) }));
  const TR = { cashAccountId: "tr-cash", portfolioAccountId: "tr-portfolio" };

  it("buy: funding pair with one group id, BUY with fee; the securities account ends without cash", () => {
    const { activities } = transformPdfs(files("tr-kauf.txt"), "trade-republic", TR);
    expect(activities.map((a) => [a.accountId, a.activityType, a.amount])).toEqual([
      ["tr-cash", "TRANSFER_OUT", "3016"],
      ["tr-portfolio", "TRANSFER_IN", "3016"],
      ["tr-portfolio", "BUY", "3016"],
    ]);
    expect(new Set(activities.map((a) => a.transferGroupId).filter(Boolean))).toEqual(new Set(["pdf-tr-e5f6-0789"]));
    expect(activities[2]).toMatchObject({ quantity: "120", unitPrice: "25.125", fee: "1", tax: undefined });
    expect(activities[2].comment).toBe("Kauf Test World Equity EUR (Acc) [PDF e5f6-0789]");
    expect(reconcile(activities, TR).portfolioCash).toEqual({});
  });

  it("sell and dividend: tax field, sweep to cash, nothing left on the securities account", () => {
    const { activities } = transformPdfs(files("tr-verkauf.txt", "tr-dividende.txt"), "trade-republic", TR);
    const sell = activities.find((a) => a.activityType === "SELL");
    expect(sell).toMatchObject({ amount: "988.45", fee: "1", tax: "10.55" });
    const div = activities.find((a) => a.activityType === "DIVIDEND");
    expect(div).toMatchObject({ amount: "81.54", tax: "18.46", quantity: "200" });
    expect(div?.comment).toBe("Dividende Test High Dividend USD (Dist) - 110 USD @ 1.1 [PDF IE00TEST0003-30.09.2026]");
    const r = reconcile(activities, TR);
    expect(r.portfolioCash).toEqual({});
    expect(r.cash).toEqual({ EUR: 1069.99 });
  });

  it("a tax refund on a dividend becomes its own credit", () => {
    const refund: PdfFile = {
      file: "x.pdf",
      result: {
        ok: true,
        broker: "trade-republic",
        tx: { ...tx("tr-dividende.txt"), gross: 100, tax: -5, net: 105 },
      },
    };
    const { activities } = transformPdfs([refund], "trade-republic", TR);
    expect(activities.find((a) => a.activityType === "DIVIDEND")).toMatchObject({ amount: "100", tax: undefined });
    expect(activities.find((a) => a.activityType === "CREDIT")).toMatchObject({ amount: "5", subtype: "TAX_REFUND" });
    expect(reconcile(activities, TR).portfolioCash).toEqual({});
  });

  it("a statement uploaded twice is imported once; unsupported ones are listed as missing", () => {
    const unknown: PdfFile = { file: "other.pdf", result: parsePdfText("TRADE REPUBLIC BANK GMBH\nKONTOAUSZUG\n") };
    const { activities, skipped } = transformPdfs(
      [...files("tr-kauf.txt", "tr-kauf.txt"), unknown],
      "trade-republic",
      TR,
    );
    expect(activities.filter((a) => a.activityType === "BUY")).toHaveLength(1);
    expect(skipped.map((s) => [s.description.split(" ")[0], s.kind])).toEqual([
      ["tr-kauf.txt", "netted"],
      ["other.pdf", "missing"],
    ]);
  });

  it("all PDFs of one upload must come from one broker", () => {
    expect(pdfBroker(files("tr-kauf.txt", "sc-kauf.txt"))).toMatchObject({ ok: false });
    expect(pdfBroker(files("dkb-kauf.txt", "dkb-ausschuettung.txt"))).toEqual({ ok: true, broker: "dkb" });
  });
});

describe("pdf.js text extraction", () => {
  it("joins items on one baseline in x order and keeps lines in reading order", async () => {
    const pdf = makePdf([
      [
        { x: 300, y: 700, s: "4.532,40 EUR" },
        { x: 40, y: 700, s: "GESAMT" },
        { x: 40, y: 680, s: "Solidaritätszuschlag -1,08 EUR" },
        { x: 200, y: 701.5, s: "same line" },
      ],
      [{ x: 40, y: 800, s: "Seite 2" }],
    ]);
    expect(await pdfToPages(pdf)).toEqual(["GESAMT same line 4.532,40 EUR\nSolidaritätszuschlag -1,08 EUR", "Seite 2"]);
  });

  it("end to end: PDF files of one broker → activities on that broker's accounts", async () => {
    const data = (name: string) => ({ name, data: linesToPdf(fixture(name)).buffer as ArrayBuffer });
    const outcome = await parsePdfFiles([data("dkb-kauf.txt"), data("dkb-ausschuettung.txt")], SETTINGS);
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.format).toBe("dkb");
    expect(outcome.brokerCash).toBeUndefined();
    expect(outcome.result.skipped).toEqual([]);
    expect(outcome.result.activities.map((a) => [a.accountId, a.activityType])).toEqual([
      ["dkb-cash", "TRANSFER_OUT"],
      ["dkb-portfolio", "TRANSFER_IN"],
      ["dkb-portfolio", "BUY"],
      ["dkb-portfolio", "DIVIDEND"],
      ["dkb-portfolio", "TRANSFER_OUT"],
      ["dkb-cash", "TRANSFER_IN"],
    ]);
  });

  it("an unreadable file is reported; a broker without accounts asks for settings", async () => {
    const broken = { name: "broken.pdf", data: new TextEncoder().encode("not a pdf").buffer as ArrayBuffer };
    const ok = { name: "tr.pdf", data: linesToPdf(fixture("tr-kauf.txt")).buffer as ArrayBuffer };
    const outcome = await parsePdfFiles([broken, ok], SETTINGS);
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.result.skipped).toMatchObject([{ description: "broken.pdf", kind: "missing" }]);

    const noDkb = await parsePdfFiles([{ name: "d.pdf", data: linesToPdf(fixture("dkb-kauf.txt")).buffer as ArrayBuffer }], {
      ...SETTINGS,
      dkbCashAccountId: "",
    });
    expect(noDkb).toMatchObject({ ok: false, error: expect.stringContaining("DKB") });
  });
});
