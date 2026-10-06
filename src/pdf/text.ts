import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import * as pdfWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";

// PDF → plain text lines with pdf.js (feasibility spike: #14).
//
// The worker code is bundled and registered as `globalThis.pdfjsWorker`, so
// pdf.js runs it on the main thread instead of loading a separate worker file -
// the addon is a single addon.js and its sandbox can't serve one. Statements
// are a few pages, so the main thread is fast enough.
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfWorker;

interface Item {
  s: string;
  x: number;
  y: number;
}

// Items closer than this vertically belong to the same line.
const LINE_TOLERANCE = 2.5;

// One string per page; lines in reading order, items on a line joined by single
// spaces - the same text Portfolio Performance's extractors see (PDFBox), except
// that lines carry no trailing spaces.
export async function pdfToPages(data: ArrayBuffer | Uint8Array): Promise<string[]> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const doc = await getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false }).promise;
  try {
    const pages: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items: Item[] = [];
      for (const it of content.items) {
        if (!("str" in it) || !it.str.trim()) continue;
        items.push({ s: it.str.trim(), x: it.transform[4], y: it.transform[5] });
      }
      items.sort((a, b) => b.y - a.y || a.x - b.x);
      const lines: { y: number; items: Item[] }[] = [];
      for (const it of items) {
        const line = lines.find((l) => Math.abs(l.y - it.y) < LINE_TOLERANCE);
        if (line) line.items.push(it);
        else lines.push({ y: it.y, items: [it] });
      }
      lines.sort((a, b) => b.y - a.y);
      pages.push(lines.map((l) => l.items.sort((a, b) => a.x - b.x).map((i) => i.s).join(" ")).join("\n"));
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}
