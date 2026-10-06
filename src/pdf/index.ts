import { formatAccounts, isFormatConfigured, FORMAT_LABEL, type ParseOutcome } from "../formats";
import type { AddonSettings } from "../types";
import { pdfBroker, transformPdfs, type PdfFile } from "./activities";
import { unsupported } from "./model";
import { parsePdfText } from "./parse";
import { pdfToPages } from "./text";

// Any number of PDF statements of one broker → activities for that broker's
// account pair (the same pair its CSV import uses). Documents that can't be
// read or aren't supported become "missing" rows in the Skipped list.
export async function parsePdfFiles(
  files: { name: string; data: ArrayBuffer }[],
  settings: AddonSettings,
): Promise<ParseOutcome> {
  const parsed: PdfFile[] = [];
  for (const f of files) {
    try {
      const text = (await pdfToPages(f.data)).join("\n");
      parsed.push({ file: f.name, result: parsePdfText(text) });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      parsed.push({ file: f.name, result: unsupported(null, "Unreadable PDF", `The PDF could not be read: ${reason}`) });
    }
  }
  const broker = pdfBroker(parsed);
  if (!broker.ok) return { ok: false, error: broker.error };
  if (!isFormatConfigured(broker.broker, settings)) {
    return { ok: false, error: `Select your ${FORMAT_LABEL[broker.broker]} cash and securities accounts in Settings first.` };
  }
  return {
    ok: true,
    format: broker.broker,
    result: transformPdfs(parsed, broker.broker, formatAccounts(broker.broker, settings)),
  };
}
