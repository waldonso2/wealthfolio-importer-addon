import { failure, formatAccounts, isFormatConfigured, FORMAT_LABEL, type ParseOutcome } from "../formats";
import type { AddonSettings } from "../types";
import { pdfBroker, transformPdfs, type PdfFile } from "./activities";
import { msg } from "../i18n";
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
      parsed.push({
        file: f.name,
        result: unsupported(null, msg("skip.pdf.unreadableTitle"), msg("skip.pdf.unreadable", { error: reason })),
      });
    }
  }
  const broker = pdfBroker(parsed);
  if (!broker.ok) return failure(broker.error);
  if (!isFormatConfigured(broker.broker, settings)) {
    return failure(msg("upload.selectAccounts", { broker: FORMAT_LABEL[broker.broker] }));
  }
  return {
    ok: true,
    format: broker.broker,
    result: transformPdfs(parsed, broker.broker, formatAccounts(broker.broker, settings)),
  };
}
