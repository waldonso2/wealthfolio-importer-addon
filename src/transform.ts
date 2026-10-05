import { addSec, fmtAmt, makeCashAct, matchPattern, sortAndNumber, timeTag, tradeFinalCash } from "./common";
import type { ActivityImportEx, AddonSettings, SkippedRow, TransformResult, TrRow } from "./types";

function num(s: string | undefined | null): number {
  if (!s || s.trim() === "") return 0;
  return parseFloat(s);
}

// CASH types booked like a dividend (DIVIDEND + TAX + transfer to cash). The
// label goes into the comments; "Dividend" must stay unchanged so already
// imported dividends are still recognised as duplicates.
const DIVIDEND_LIKE = new Map<string, string>([
  ["DIVIDEND", "Dividend"],
  ["DISTRIBUTION", "Distribution"], // fund/ETF distribution
  ["EXCHANGE", "Exchange distribution"], // cash paid in a share-exchange programme (e.g. Prosus)
]);

// CASH types that only move tax: the cash effect is amount + tax (amount is
// usually 0). Negative → TAX, positive → CREDIT/TAX_REFUND.
const TAX_ONLY = new Map<string, string>([
  ["EARNINGS", "Advance lump-sum tax (Vorabpauschale)"],
  ["PRE_DETERMINED_TAX_BASE", "Advance lump-sum tax (Vorabpauschale)"],
  ["SEC_ACCOUNT", "Tax adjustment"],
  ["TAX_OPTIMIZATION", "Tax optimisation"],
]);

// CORPORATE_ACTION types where one ISIN is swapped for another at the same
// timestamp: the old ISIN leaves with -n shares, the new one arrives with +m.
const SECURITY_EXCHANGE = new Map<string, string>([
  ["SHARE_EXCHANGE", "Share exchange"],
  ["ADR_DISCONTINUATION", "ADR discontinuation"],
  ["REORGANISATION", "Reorganisation"],
  ["REVERSE_SPLIT", "Reverse split"],
]);

type CorporateResult = { activity: ActivityImportEx } | { skip: string };

// More decimals than fmtAmt: a per-share cost basis can be tiny (25,000 → 38 shares).
function fmtPrice(n: number): string {
  return n.toFixed(10).replace(/\.?0+$/, "") || "0";
}

// Maps the supported CORPORATE_ACTION rows, keyed by transaction_id.
//
// Wealthfolio refuses a TRANSFER_OUT/TRANSFER_IN pair between two different
// assets, so an ISIN change is booked as an unpaired TRANSFER_OUT of the old
// ISIN and an unpaired TRANSFER_IN of the new one that carries the old
// position's cost basis as unitPrice. The export has no cost basis, so it is
// rebuilt FIFO (like Wealthfolio's lot relief) from the BUY/SELL/FREE_RECEIPT
// rows of the same file; if the file doesn't hold the shares, the rows are
// skipped instead of booking a made-up cost.
function mapCorporateActions(rows: TrRow[], config: AddonSettings): Map<string, CorporateResult> {
  const { portfolioAccountId } = config;
  const cashCurrency = config.cashCurrency || "EUR";
  const result = new Map<string, CorporateResult>();
  const lots = new Map<string, { qty: number; cost: number }[]>();

  const held = (isin: string) => (lots.get(isin) ?? []).reduce((sum, l) => sum + l.qty, 0);
  const addLot = (isin: string, qty: number, cost: number) => {
    if (qty > 0) lots.set(isin, [...(lots.get(isin) ?? []), { qty, cost }]);
  };
  // Removes qty shares FIFO and returns the cost basis they carried.
  const relieve = (isin: string, qty: number): number => {
    let left = qty;
    let cost = 0;
    for (const lot of lots.get(isin) ?? []) {
      if (left <= 0) break;
      const take = Math.min(lot.qty, left);
      const part = (lot.cost * take) / lot.qty;
      cost += part;
      lot.cost -= part;
      lot.qty -= take;
      left -= take;
    }
    lots.set(isin, (lots.get(isin) ?? []).filter((l) => l.qty > 1e-9));
    return cost;
  };
  const security = (r: TrRow, activityType: string, date: string, quantity: number, unitPrice: string, comment: string) =>
    ({
      accountId: portfolioAccountId,
      activityType,
      date,
      symbol: r.symbol,
      symbolName: r.name,
      instrumentType: r.asset_class === "STOCK" ? "EQUITY" : "FUND",
      quoteCcy: r.currency || cashCurrency,
      quantity: fmtPrice(quantity),
      unitPrice,
      currency: r.currency || cashCurrency,
      comment,
      isValid: true,
      isDraft: false,
    }) as ActivityImportEx;

  const sorted = [...rows].sort((a, b) => a.datetime.localeCompare(b.datetime));
  for (const r of sorted) {
    const shares = Math.abs(num(r.shares));

    if (r.category === "TRADING" && r.type === "BUY") {
      const fee = Math.abs(num(r.fee)) + Math.abs(num(r.tax));
      addLot(r.symbol, shares, Number(tradeFinalCash("BUY", r.shares, r.price, fee ? fmtAmt(fee) : "0")));
      continue;
    }
    if (r.category === "TRADING" && r.type === "SELL") {
      relieve(r.symbol, shares);
      continue;
    }
    if (r.category === "DELIVERY" && r.type === "FREE_RECEIPT") {
      addLot(r.symbol, shares, shares * num(r.price));
      continue;
    }
    if (r.category !== "CORPORATE_ACTION" || result.has(r.transaction_id)) continue;

    if (r.type === "WORTHLESS") {
      relieve(r.symbol, shares);
      result.set(r.transaction_id, {
        activity: {
          ...security(r, "SELL", r.datetime, shares, "0", `${r.name} - written off as worthless${timeTag(r.datetime)}`),
          fee: "0",
          amount: "0",
        },
      });
      continue;
    }

    const label = SECURITY_EXCHANGE.get(r.type);
    if (!label) continue;
    const legs = sorted.filter(
      (x) => x.category === "CORPORATE_ACTION" && x.type === r.type && x.datetime === r.datetime,
    );
    const out = legs.filter((x) => num(x.shares) < 0);
    const inn = legs.filter((x) => num(x.shares) > 0);
    const skipAll = (reason: string) => legs.forEach((x) => result.set(x.transaction_id, { skip: reason }));
    if (out.length !== 1 || inn.length !== 1 || out[0].symbol === inn[0].symbol) {
      skipAll(`${r.type}: expected one outgoing and one incoming ISIN at the same time`);
      continue;
    }
    const [o, i] = [out[0], inn[0]];
    const outQty = Math.abs(num(o.shares));
    const inQty = num(i.shares);
    if (held(o.symbol) + 1e-9 < outQty) {
      skipAll(
        `${r.type}: cost basis of ${o.symbol} unknown - this file holds ${fmtPrice(held(o.symbol))} of ${fmtPrice(outQty)} shares (import the full history)`,
      );
      continue;
    }
    const cost = relieve(o.symbol, outQty);
    addLot(i.symbol, inQty, cost);
    const note = `${label}: ${o.symbol} -> ${i.symbol}`;
    result.set(o.transaction_id, {
      activity: security(o, "TRANSFER_OUT", o.datetime, outQty, fmtPrice(cost / outQty), `${o.name} - ${note}${timeTag(o.datetime)}`),
    });
    result.set(i.transaction_id, {
      activity: security(i, "TRANSFER_IN", addSec(i.datetime, 1), inQty, fmtPrice(cost / inQty), `${i.name} - ${note}${timeTag(i.datetime)}`),
    });
  }
  return result;
}

export function transform(rows: TrRow[], config: AddonSettings): TransformResult {
  const { cashAccountId, portfolioAccountId, transferPatterns } = config;
  const cashCurrency = config.cashCurrency || "EUR";
  const cashAct = makeCashAct(cashCurrency);

  const activities: ActivityImportEx[] = [];
  const skipped: SkippedRow[] = [];
  const corporate = mapCorporateActions(rows, config);

  // Pre-build set of BUY transaction_ids funded by a STOCKPERK gift
  const stockperkFundedBuyIds = new Set<string>();
  const stockperkRows = rows.filter((r) => r.type === "STOCKPERK");
  for (const s of stockperkRows) {
    for (const b of rows) {
      if (
        b.type === "BUY" &&
        b.symbol === s.symbol &&
        b.date === s.date &&
        Math.round(Math.abs(num(b.amount)) * 100) === Math.round(Math.abs(num(s.amount)) * 100)
      ) {
        stockperkFundedBuyIds.add(b.transaction_id);
        break;
      }
    }
  }

  for (const r of rows) {
    const { category, type: typ, datetime: dt, amount, fee, tax, description: desc } = r;
    const cpiban = r.counterparty_iban ?? "";
    const cpname = r.counterparty_name ?? "";

    // ── TRADING / BUY ───────────────────────────────────────────────────────
    if (category === "TRADING" && typ === "BUY") {
      const buyFee = Math.abs(num(fee));
      const buyTax = Math.abs(num(tax));
      const buyFeeTotal = buyFee + buyTax;
      const totalCash = Math.abs(num(amount)) + buyFeeTotal;
      const instrType = r.asset_class === "STOCK" ? "EQUITY" : "FUND";
      const quoteCcy = r.currency || "EUR";

      if (stockperkFundedBuyIds.has(r.transaction_id)) {
        activities.push(
          cashAct(
            portfolioAccountId,
            "CREDIT",
            addSec(dt, -1),
            totalCash,
            `Stockperk TR gift: ${r.name} (${r.symbol})${timeTag(dt)}`,
            "BONUS",
          ),
        );
        activities.push({
          accountId: portfolioAccountId,
          activityType: "BUY",
          date: dt,
          symbol: r.symbol,
          symbolName: r.name,
          instrumentType: instrType,
          quoteCcy,
          quantity: r.shares,
          unitPrice: r.price,
          fee: buyFeeTotal ? fmtAmt(buyFeeTotal) : "0",
          amount: tradeFinalCash("BUY", r.shares, r.price, buyFeeTotal ? fmtAmt(buyFeeTotal) : "0"),
          currency: quoteCcy,
          comment: `${r.name} - Stockperk gift buy (funded by TR, not own funds)${timeTag(dt)}`,
          isValid: true,
          isDraft: false,
        });
        continue;
      }

      // Regular BUY: fund from Efectivo via internal transfer
      const buyGroupId = `buy-${r.transaction_id}`;
      activities.push(
        cashAct(
          cashAccountId,
          "TRANSFER_OUT",
          addSec(dt, -2),
          totalCash,
          `Funds for ${r.symbol} (${r.name}) buy -> Portfolio${timeTag(dt)}`,
          undefined,
          buyGroupId,
        ),
      );
      activities.push(
        cashAct(
          portfolioAccountId,
          "TRANSFER_IN",
          addSec(dt, -1),
          totalCash,
          `Funds from Cash for ${r.symbol} buy${timeTag(dt)}`,
          undefined,
          buyGroupId,
        ),
      );
      activities.push({
        accountId: portfolioAccountId,
        activityType: "BUY",
        date: dt,
        symbol: r.symbol,
        symbolName: r.name,
        instrumentType: instrType,
        quoteCcy,
        quantity: r.shares,
        unitPrice: r.price,
        fee: buyFeeTotal ? fmtAmt(buyFeeTotal) : "0",
        amount: tradeFinalCash("BUY", r.shares, r.price, buyFeeTotal ? fmtAmt(buyFeeTotal) : "0"),
        currency: quoteCcy,
        comment: (desc ? `${r.name} - ${desc}` : r.name) + timeTag(dt),
        isValid: true,
        isDraft: false,
      });
      continue;
    }

    // ── TRADING / SELL ──────────────────────────────────────────────────────
    if (category === "TRADING" && typ === "SELL") {
      const sellFee = Math.abs(num(fee));
      const sellTax = Math.abs(num(tax));
      const sellFeeTotal = sellFee + sellTax;
      const proceeds = Math.abs(num(amount)) - sellFeeTotal;
      const instrType = r.asset_class === "STOCK" ? "EQUITY" : "FUND";
      const quoteCcy = r.currency || "EUR";

      activities.push({
        accountId: portfolioAccountId,
        activityType: "SELL",
        date: dt,
        symbol: r.symbol,
        symbolName: r.name,
        instrumentType: instrType,
        quoteCcy,
        quantity: r.shares,
        unitPrice: r.price,
        fee: sellFeeTotal ? fmtAmt(sellFeeTotal) : "0",
        amount: tradeFinalCash("SELL", r.shares, r.price, sellFeeTotal ? fmtAmt(sellFeeTotal) : "0"),
        currency: quoteCcy,
        comment: (desc ? `${r.name} - ${desc}` : r.name) + timeTag(dt),
        isValid: true,
        isDraft: false,
      });
      const sellGroupId = `sell-${r.transaction_id}`;
      activities.push(
        cashAct(
          portfolioAccountId,
          "TRANSFER_OUT",
          addSec(dt, 1),
          proceeds,
          `${r.symbol} (${r.name}) sale -> Cash${timeTag(dt)}`,
          undefined,
          sellGroupId,
        ),
      );
      activities.push(
        cashAct(
          cashAccountId,
          "TRANSFER_IN",
          addSec(dt, 2),
          proceeds,
          `${r.symbol} sale from Portfolio${timeTag(dt)}`,
          undefined,
          sellGroupId,
        ),
      );
      continue;
    }

    // ── DELIVERY / MIGRATION ────────────────────────────────────────────────
    if (category === "DELIVERY" && typ === "MIGRATION") {
      skipped.push({
        datetime: dt,
        type: typ,
        category,
        description: desc,
        reason: "MIGRATION: technical ISIN change, no net portfolio effect",
      });
      continue;
    }

    // ── DELIVERY / FREE_RECEIPT ─────────────────────────────────────────────
    if (category === "DELIVERY" && typ === "FREE_RECEIPT") {
      const instrType = r.asset_class === "STOCK" ? "EQUITY" : "FUND";
      const quoteCcy = r.currency || "EUR";
      activities.push({
        accountId: portfolioAccountId,
        activityType: "TRANSFER_IN",
        date: dt,
        symbol: r.symbol,
        symbolName: r.name,
        instrumentType: instrType,
        quoteCcy,
        quantity: r.shares,
        unitPrice: r.price || undefined,
        currency: quoteCcy,
        comment: `${r.name} transfer from another broker${timeTag(dt)}`,
        isValid: true,
        isDraft: false,
      });
      continue;
    }

    // ── CASH ────────────────────────────────────────────────────────────────
    if (category === "CASH") {
      const amt = num(amount);
      const absAmt = Math.abs(amt);

      if (typ === "STOCKPERK") {
        continue;
      }

      if (typ === "CUSTOMER_INBOUND" || typ === "CUSTOMER_INPAYMENT") {
        activities.push(
          cashAct(cashAccountId, "DEPOSIT", dt, absAmt, (cpname ? `${desc} (${cpname})` : desc) + timeTag(dt)),
        );
        continue;
      }

      if (typ === "CUSTOMER_OUTBOUND_REQUEST") {
        const match = matchPattern(cpiban, desc, transferPatterns);

        if (match) {
          const groupId = match.destinationAccountId ? `xfer-${r.transaction_id}` : undefined;
          activities.push(
            cashAct(
              cashAccountId,
              "TRANSFER_OUT",
              dt,
              absAmt,
              `-> ${match.label}: ${desc}` + (cpname ? ` (${cpname})` : "") + timeTag(dt),
              undefined,
              groupId,
            ),
          );
          if (match.destinationAccountId) {
            activities.push(
              cashAct(
                match.destinationAccountId,
                "TRANSFER_IN",
                dt,
                absAmt,
                `<- TR: ${desc}${timeTag(dt)}`,
                undefined,
                groupId,
              ),
            );
          }
        } else {
          activities.push(
            cashAct(cashAccountId, "WITHDRAWAL", dt, absAmt, (cpname ? `${desc} (${cpname})` : desc) + timeTag(dt)),
          );
        }
        continue;
      }

      if (typ === "CARD_TRANSACTION" || typ === "CARD_TRANSACTION_INTERNATIONAL") {
        const cardFee = num(fee);
        const netAmt = amt + cardFee;
        const mccPart = r.mcc_code ? ` (MCC ${r.mcc_code})` : "";
        const feePart = cardFee ? ` [+ fee ${Math.abs(cardFee).toFixed(2)}]` : "";
        const merchant = r.name || desc;
        const c = `${merchant}${mccPart}${feePart}${timeTag(dt)}`;
        activities.push(
          cashAct(
            cashAccountId,
            netAmt >= 0 ? "DEPOSIT" : "WITHDRAWAL",
            dt,
            Math.abs(netAmt),
            netAmt >= 0 ? `Card refund: ${c}` : c,
          ),
        );
        continue;
      }

      if (typ === "CARD_ORDERING_FEE") {
        const feeAmt = fee ? Math.abs(num(fee)) : absAmt;
        activities.push(cashAct(cashAccountId, "FEE", dt, feeAmt, desc + timeTag(dt)));
        continue;
      }

      if (typ === "BENEFITS_SAVEBACK") {
        const taxAmt = num(tax);
        const net = absAmt + taxAmt;
        activities.push(
          cashAct(
            cashAccountId,
            "CREDIT",
            dt,
            net,
            `Saveback - ${r.name}` +
              (taxAmt ? ` (withholding tax ${Math.abs(taxAmt).toFixed(2)} EUR)` : "") +
              timeTag(dt),
            "BONUS",
          ),
        );
        continue;
      }

      const label = DIVIDEND_LIKE.get(typ);
      if (label) {
        const lower = label.toLowerCase();
        const taxAmt = num(tax);
        const netCash = absAmt + taxAmt;
        const sharesVal = r.shares || "1";
        const quoteCcy = r.original_currency || r.currency || cashCurrency;

        const tOut = addSec(dt, 1);
        const tIn = addSec(dt, 2);

        // Booked in the currency TR actually paid out (the cash currency). The
        // original amount (e.g. USD) only goes into the comment: a DIVIDEND in the
        // original currency left that currency as cash on the portfolio account,
        // because TAX and the sweep to cash are in EUR.
        const original = r.original_currency ? ` (${r.original_amount} ${r.original_currency})` : "";
        activities.push({
          accountId: portfolioAccountId,
          activityType: "DIVIDEND",
          date: dt,
          symbol: r.symbol,
          symbolName: r.name,
          quoteCcy,
          quantity: sharesVal,
          currency: r.currency || cashCurrency,
          amount: fmtAmt(absAmt),
          comment: `${label} ${r.name}${original}${timeTag(dt)}`,
          isValid: true,
          isDraft: false,
        });
        if (taxAmt) {
          activities.push(cashAct(portfolioAccountId, "TAX", dt, Math.abs(taxAmt), `Withholding tax on ${lower} ${r.name}${timeTag(dt)}`));
        }

        const dividendGroupId = `div-${r.transaction_id}`;
        activities.push(
          cashAct(
            portfolioAccountId,
            "TRANSFER_OUT",
            tOut,
            netCash,
            `${label} ${r.name} -> Cash${timeTag(dt)}`,
            undefined,
            dividendGroupId,
          ),
        );
        activities.push(
          cashAct(
            cashAccountId,
            "TRANSFER_IN",
            tIn,
            netCash,
            `${label} ${r.name} from Portfolio${timeTag(dt)}`,
            undefined,
            dividendGroupId,
          ),
        );
        continue;
      }

      const taxLabel = TAX_ONLY.get(typ);
      if (taxLabel) {
        const net = amt + num(tax);
        const what = `${taxLabel}${r.name ? ` - ${r.name}` : ""}${r.symbol ? ` (${r.symbol})` : ""}`;
        if (Math.round(net * 100) === 0) {
          skipped.push({ datetime: dt, type: typ, category, description: desc, reason: `${typ}: no cash effect` });
        } else if (net < 0) {
          activities.push(cashAct(cashAccountId, "TAX", dt, Math.abs(net), what + timeTag(dt)));
        } else {
          activities.push(cashAct(cashAccountId, "CREDIT", dt, net, `${what} refund${timeTag(dt)}`, "TAX_REFUND"));
        }
        continue;
      }

      if (typ === "REFERRAL") {
        const taxAmt = num(tax);
        activities.push(
          cashAct(
            cashAccountId,
            "CREDIT",
            dt,
            absAmt + taxAmt,
            "Referral bonus" + (taxAmt ? ` (withholding tax ${Math.abs(taxAmt).toFixed(2)} EUR)` : "") + timeTag(dt),
            "BONUS",
          ),
        );
        continue;
      }

      if (typ === "INTEREST_PAYMENT" || typ === "MANUAL_CASH_TRANSFER") {
        const taxAmt = num(tax);
        activities.push(cashAct(cashAccountId, "INTEREST", dt, absAmt, desc + timeTag(dt)));
        if (taxAmt) {
          activities.push(cashAct(cashAccountId, "TAX", dt, Math.abs(taxAmt), `Withholding tax on interest${timeTag(dt)}`));
        }
        continue;
      }

      if (typ === "TRANSFER_DIRECT_DEBIT_INBOUND") {
        const match = matchPattern(cpiban, desc, transferPatterns);
        if (match) {
          const groupId = match.destinationAccountId ? `xfer-${r.transaction_id}` : undefined;
          activities.push(
            cashAct(
              cashAccountId,
              "TRANSFER_OUT",
              dt,
              absAmt,
              `-> ${match.label}: ${desc}${timeTag(dt)}`,
              undefined,
              groupId,
            ),
          );
          if (match.destinationAccountId) {
            activities.push(
              cashAct(
                match.destinationAccountId,
                "TRANSFER_IN",
                dt,
                absAmt,
                `<- TR: ${desc}${timeTag(dt)}`,
                undefined,
                groupId,
              ),
            );
          }
        } else {
          activities.push(cashAct(cashAccountId, "WITHDRAWAL", dt, absAmt, desc + timeTag(dt)));
        }
        continue;
      }

      if (typ === "TRANSFER_INBOUND" || typ === "TRANSFER_INSTANT_INBOUND") {
        activities.push(
          cashAct(
            cashAccountId,
            amt >= 0 ? "DEPOSIT" : "WITHDRAWAL",
            dt,
            absAmt,
            (cpname ? `${desc} (${cpname})` : desc) + timeTag(dt),
          ),
        );
        continue;
      }

      if (typ === "TRANSFER_OUTBOUND" || typ === "TRANSFER_INSTANT_OUTBOUND") {
        const match = matchPattern(cpiban, desc, transferPatterns);

        if (match) {
          const groupId = match.destinationAccountId ? `xfer-${r.transaction_id}` : undefined;
          activities.push(
            cashAct(
              cashAccountId,
              "TRANSFER_OUT",
              dt,
              absAmt,
              `-> ${match.label}: ${desc}` + (cpname ? ` (${cpname})` : "") + timeTag(dt),
              undefined,
              groupId,
            ),
          );
          if (match.destinationAccountId) {
            activities.push(
              cashAct(
                match.destinationAccountId,
                "TRANSFER_IN",
                dt,
                absAmt,
                `<- TR: ${desc}${timeTag(dt)}`,
                undefined,
                groupId,
              ),
            );
          }
        } else {
          activities.push(
            cashAct(cashAccountId, "WITHDRAWAL", dt, absAmt, (cpname ? `${desc} (${cpname})` : desc) + timeTag(dt)),
          );
        }
        continue;
      }

      skipped.push({
        datetime: dt,
        type: typ,
        category,
        description: desc,
        reason: `Unknown CASH type: ${typ}`,
      });
      continue;
    }

    // ── CORPORATE_ACTION (mapped up front, see mapCorporateActions) ───────────
    const mapped = category === "CORPORATE_ACTION" ? corporate.get(r.transaction_id) : undefined;
    if (mapped && "activity" in mapped) {
      activities.push(mapped.activity);
      continue;
    }
    if (mapped) {
      skipped.push({ datetime: dt, type: typ, category, description: desc, reason: mapped.skip });
      continue;
    }

    skipped.push({
      datetime: dt,
      type: typ,
      category,
      description: desc,
      reason: category === "CORPORATE_ACTION" ? `Unsupported corporate action: ${typ}` : `Unknown category: ${category}`,
    });
  }

  sortAndNumber(activities);

  return { activities, skipped };
}
