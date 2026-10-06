import { addSec, fmtAmt, makeCashAct, sortAndNumber, tradeFinalCash } from "../common";
import type { ActivityImportEx, SkippedRow, TransformResult } from "../types";
import { FORMAT_LABEL } from "../formats";
import { tradeFee, type PdfBroker, type PdfParseResult, type PdfTransaction } from "./model";

// Parsed PDF statements → Wealthfolio activities, with the same two-account
// model as the CSV transformers: trades and dividends are booked on the
// securities account, every cash movement there is funded from / swept to the
// cash account as a TRANSFER_OUT/TRANSFER_IN pair with its own transferGroupId,
// so the securities account holds no cash.

export interface PdfFile {
  file: string;
  result: PdfParseResult;
}

const GROUP_PREFIX: Record<PdfBroker, string> = {
  "trade-republic": "pdf-tr",
  scalable: "pdf-sc",
  dkb: "pdf-dkb",
};

const ADD_MANUALLY = "Add it manually in Wealthfolio, or import the broker's CSV export for this period instead.";

export function transformPdfs(
  files: PdfFile[],
  broker: PdfBroker,
  accounts: { cashAccountId: string; portfolioAccountId: string },
): TransformResult {
  const { cashAccountId, portfolioAccountId } = accounts;
  const activities: ActivityImportEx[] = [];
  const skipped: SkippedRow[] = [];
  const seen = new Set<string>();

  for (const { file, result } of files) {
    if (!result.ok) {
      skipped.push({
        datetime: "",
        type: result.title,
        category: "PDF",
        description: file,
        reason: result.reason,
        kind: "missing",
        hint: ADD_MANUALLY,
      });
      continue;
    }
    const tx = result.tx;
    if (seen.has(tx.docId)) {
      skipped.push({
        datetime: tx.datetime,
        type: tx.label,
        category: "PDF",
        description: `${file} - ${tx.name}`,
        reason: "The same statement was uploaded more than once; it is imported once.",
        kind: "netted",
      });
      continue;
    }
    seen.add(tx.docId);
    activities.push(...txActivities(tx, `${GROUP_PREFIX[broker]}-${tx.docId}`, cashAccountId, portfolioAccountId));
  }

  sortAndNumber(activities);
  return { activities, skipped };
}

function txActivities(tx: PdfTransaction, groupId: string, cashAccountId: string, portfolioAccountId: string): ActivityImportEx[] {
  const out: ActivityImportEx[] = [];
  const cashAct = makeCashAct(tx.currency);
  const dt = tx.datetime;
  const ref = ` [PDF ${tx.docId}]`;
  const security = {
    symbol: tx.isin,
    symbolName: tx.name,
    quoteCcy: tx.currency,
    currency: tx.currency,
    isValid: true,
    isDraft: false,
  };
  // Taxes go into the tax field; a refund can't, so it is its own credit.
  const tax = tx.tax > 0 ? fmtAmt(tx.tax) : undefined;
  const refund = tx.tax < 0 ? -tx.tax : 0;
  const refundCredit = (what: string) =>
    cashAct(portfolioAccountId, "CREDIT", dt, refund, `Tax refund on ${what} of ${tx.name}${ref}`, "TAX_REFUND");
  const sweepToCash = (label: string) => {
    out.push(cashAct(portfolioAccountId, "TRANSFER_OUT", addSec(dt, 1), tx.net, `${label} -> Cash${ref}`, undefined, groupId));
    out.push(cashAct(cashAccountId, "TRANSFER_IN", addSec(dt, 2), tx.net, `${label} from Portfolio${ref}`, undefined, groupId));
  };

  if (tx.kind === "DIVIDEND") {
    const original = tx.original
      ? ` - ${fmtAmt(tx.original.amount)} ${tx.original.currency} @ ${fmtAmt(tx.original.rate)}`
      : "";
    out.push({
      ...security,
      accountId: portfolioAccountId,
      activityType: "DIVIDEND",
      date: dt,
      quantity: fmtAmt(tx.shares),
      // Net cash received; withholding and German taxes in the tax field.
      amount: fmtAmt(refund ? tx.net - refund : tx.net),
      tax,
      comment: `${tx.label} ${tx.name}${original}${ref}`,
    });
    if (refund) out.push(refundCredit("dividend"));
    sweepToCash(`${tx.label} ${tx.name}`);
    return out;
  }

  const quantity = fmtAmt(tx.shares);
  const unitPrice = fmtAmt(tx.gross / tx.shares);
  const fee = fmtAmt(tradeFee(tx));
  const trade: ActivityImportEx = {
    ...security,
    accountId: portfolioAccountId,
    activityType: tx.kind,
    date: dt,
    quantity,
    unitPrice,
    fee,
    tax,
    amount: tradeFinalCash(tx.kind, quantity, unitPrice, fee, tax),
    comment: `${tx.label} ${tx.name}${ref}`,
  };

  if (tx.kind === "BUY") {
    out.push(
      cashAct(cashAccountId, "TRANSFER_OUT", addSec(dt, -2), tx.net, `Funds for ${tx.isin} (${tx.name}) buy -> Portfolio${ref}`, undefined, groupId),
    );
    out.push(cashAct(portfolioAccountId, "TRANSFER_IN", addSec(dt, -1), tx.net, `Funds from Cash for ${tx.isin} buy${ref}`, undefined, groupId));
    out.push(trade);
    if (refund) out.push(refundCredit("purchase"));
    return out;
  }

  out.push(trade);
  if (refund) out.push(refundCredit("sale"));
  sweepToCash(`${tx.isin} (${tx.name}) sale`);
  return out;
}

// Which broker a set of parsed PDFs belongs to: every recognised statement
// must come from the same one, since they import into that broker's accounts.
export function pdfBroker(files: PdfFile[]): { ok: true; broker: PdfBroker } | { ok: false; error: string } {
  const brokers = new Set(files.map((f) => f.result.broker).filter((b): b is PdfBroker => b !== null));
  if (brokers.size === 0) {
    return { ok: false, error: "None of the PDFs is a statement from Trade Republic, Scalable Capital or DKB." };
  }
  if (brokers.size > 1) {
    const names = [...brokers].map((b) => FORMAT_LABEL[b]).join(", ");
    return { ok: false, error: `The PDFs come from different brokers (${names}). Upload the statements of one broker at a time.` };
  }
  return { ok: true, broker: [...brokers][0] };
}
