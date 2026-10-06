import { isDkb, parseDkb } from "./dkb";
import { unsupported, type PdfParseResult } from "./model";
import { isScalable, parseScalable } from "./scalable";
import { isTradeRepublic, parseTradeRepublic } from "./tradeRepublic";

// Text of one PDF → transaction. The broker is told from the document itself.
// Scalable and Trade Republic are checked before DKB, whose marker (the Berlin
// postcode on its letterhead) is the weakest.
export function parsePdfText(text: string): PdfParseResult {
  if (isTradeRepublic(text)) return parseTradeRepublic(text);
  if (isScalable(text)) return parseScalable(text);
  if (isDkb(text)) return parseDkb(text);
  return unsupported(null, "Unknown document", "Not a statement from Trade Republic, Scalable Capital or DKB.");
}
