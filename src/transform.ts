import { addSec, fmtAmt, makeCashAct, matchPattern, sortAndNumber, timeTag, tradeFinalCash } from "./common";
import type { ActivityImportEx, AddonSettings, SkipKind, SkippedRow, TransformResult, TrRow } from "./types";

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

type Skip = { reason: string; kind: SkipKind; hint?: string };
// Outcome of a row handled by planSpecialRows: the activities it becomes (may
// be empty when another row books its effect) or why it is skipped.
type Planned = { activities: ActivityImportEx[] } | { skip: Skip };

// More decimals than fmtAmt: a per-share cost basis can be tiny (25,000 → 38 shares).
function fmtPrice(n: number): string {
  return n.toFixed(10).replace(/\.?0+$/, "") || "0";
}

// Hint for an unsupported row: what it moved, so the user can add it by hand.
function moneyHint(r: TrRow): string {
  const cash = num(r.amount) + num(r.fee) + num(r.tax);
  const moved = Math.round(cash * 100) ? `${cash > 0 ? "+" : "-"}${fmtAmt(cash)} ${r.currency || "EUR"}` : "";
  return moved
    ? `It changed your Trade Republic cash by ${moved}. Add it manually in Wealthfolio and report the type so it can be supported.`
    : "It doesn't move cash. Report the type so it can be supported.";
}

const time = (r: TrRow) => new Date(r.datetime).getTime();
const closest = (rows: TrRow[], to: TrRow) =>
  [...rows].sort((a, b) => Math.abs(time(a) - time(to)) - Math.abs(time(b) - time(to)))[0];
const DAY_MS = 24 * 60 * 60 * 1000;

// Rows whose meaning depends on other rows of the file, keyed by transaction_id:
//
// - Dividend corrections. A dividend-like row with a negative amount either
//   reverses a dividend (same ISIN, amount and tax with opposite signs; it
//   cancels the closest-in-time match, so a reversal followed by an immediate
//   rebooking keeps the originally booked dividend and earlier imports stay
//   duplicates) or pays for a dividend reinvestment (see below).
// - Corporate actions. The export only has share counts, so a position's share
//   count and cost basis are rebuilt FIFO (like Wealthfolio's lot relief) from
//   the BUY/SELL/FREE_RECEIPT rows of the same file:
//   - ISIN exchanges become an unpaired TRANSFER_OUT of the old and TRANSFER_IN
//     of the new ISIN carrying the cost basis as unitPrice (Wealthfolio refuses
//     a transfer pair between two different assets);
//   - SPLIT becomes a Wealthfolio SPLIT with ratio (held + n) / held;
//   - STOCK_DIVIDEND becomes DIVIDEND/DIVIDEND_IN_KIND (income plus shares,
//     cash-neutral); a +n/-n rebooking pair cancels out;
//   - DIVIDEND_REINVESTMENT becomes a BUY funded from the cash account with the
//     negative DIVIDEND row TR books for it (the cash dividend itself was
//     already booked as income);
//   - WORTHLESS becomes a SELL at 0.
//   If the file doesn't hold the shares, the rows are skipped rather than
//   booked with a made-up cost or ratio.
function planSpecialRows(rows: TrRow[], config: AddonSettings): Map<string, Planned> {
  const { cashAccountId, portfolioAccountId } = config;
  const cashCurrency = config.cashCurrency || "EUR";
  const cashAct = makeCashAct(cashCurrency);
  const plan = new Map<string, Planned>();
  const skip = (r: TrRow, reason: string, kind: SkipKind, hint?: string) =>
    plan.set(r.transaction_id, { skip: { reason, kind, hint } });
  const book = (r: TrRow, ...activities: ActivityImportEx[]) => plan.set(r.transaction_id, { activities });

  // ── Dividend reversals ────────────────────────────────────────────────────
  const dividends = rows.filter((r) => r.category === "CASH" && DIVIDEND_LIKE.has(r.type));
  const cents = (s: string) => Math.round(num(s) * 100);
  const negativeDividends: TrRow[] = [];
  for (const neg of dividends.filter((r) => num(r.amount) < 0)) {
    const candidates = dividends.filter(
      (r) =>
        num(r.amount) > 0 &&
        !plan.has(r.transaction_id) &&
        r.symbol === neg.symbol &&
        cents(r.amount) === -cents(neg.amount) &&
        cents(r.tax) === -cents(neg.tax),
    );
    if (candidates.length === 0) {
      negativeDividends.push(neg);
      continue;
    }
    const partner = closest(candidates, neg);
    const when = partner.date === neg.date ? "the same day" : partner.date;
    skip(neg, `Reversal of the ${partner.type.toLowerCase()} of ${when}; the two rows cancel out.`, "netted");
    skip(partner, `Cancelled by the reversal of ${neg.date}; the two rows cancel out.`, "netted");
  }

  // ── Stock dividend rebookings (+n / -n) ───────────────────────────────────
  const stockDividends = rows.filter((r) => r.category === "CORPORATE_ACTION" && r.type === "STOCK_DIVIDEND");
  for (const neg of stockDividends.filter((r) => num(r.shares) < 0)) {
    const candidates = stockDividends.filter(
      (r) => num(r.shares) > 0 && !plan.has(r.transaction_id) && r.symbol === neg.symbol && num(r.shares) === -num(neg.shares),
    );
    if (candidates.length === 0) {
      skip(
        neg,
        `Stock dividend reversal of ${fmtPrice(-num(neg.shares))} ${neg.name} shares without a matching stock dividend.`,
        "missing",
        "Check the position in Wealthfolio and remove the shares manually if Trade Republic took them back.",
      );
      continue;
    }
    const partner = closest(candidates, neg);
    skip(neg, `Rebooking by Trade Republic: cancels out with the stock dividend booked ${partner.date === neg.date ? "the same day" : partner.date}.`, "netted");
    skip(partner, `Rebooking by Trade Republic: cancelled by the reversal of ${neg.date}.`, "netted");
  }

  // ── Positions (FIFO) and corporate actions, in time order ─────────────────
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
  const fullHistory =
    "Import the complete transaction history (all years) so the position is known, or add this change manually in Wealthfolio.";

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
    if (r.category !== "CORPORATE_ACTION" || plan.has(r.transaction_id)) continue;

    if (r.type === "WORTHLESS") {
      relieve(r.symbol, shares);
      book(r, {
        ...security(r, "SELL", r.datetime, shares, "0", `${r.name} - written off as worthless${timeTag(r.datetime)}`),
        fee: "0",
        amount: "0",
      });
      continue;
    }

    if (r.type === "SPLIT") {
      const before = held(r.symbol);
      const ratio = before > 0 ? (before + num(r.shares)) / before : 0;
      if (ratio <= 0) {
        skip(
          r,
          `Split of ${r.name} (${num(r.shares) > 0 ? "+" : ""}${fmtPrice(num(r.shares))} shares): the split ratio can't be derived because this file holds no ${r.symbol} shares before the split.`,
          "missing",
          fullHistory,
        );
        continue;
      }
      for (const lot of lots.get(r.symbol) ?? []) lot.qty *= ratio;
      book(r, {
        accountId: portfolioAccountId,
        activityType: "SPLIT",
        date: r.datetime,
        symbol: r.symbol,
        symbolName: r.name,
        instrumentType: r.asset_class === "STOCK" ? "EQUITY" : "FUND",
        quoteCcy: r.currency || cashCurrency,
        amount: fmtPrice(ratio),
        currency: r.currency || cashCurrency,
        comment: `${r.name} - split ${fmtPrice(ratio)}:1 (${fmtPrice(before)} -> ${fmtPrice(before * ratio)} shares)${timeTag(r.datetime)}`,
        isValid: true,
        isDraft: false,
      } as ActivityImportEx);
      continue;
    }

    if (r.type === "STOCK_DIVIDEND") {
      const price = num(r.price);
      if (price <= 0) {
        skip(
          r,
          `Stock dividend of ${fmtPrice(shares)} ${r.name} shares without a value per share in the export.`,
          "missing",
          "Add it manually in Wealthfolio as a dividend in kind (Dividend, subtype Dividend in kind) with the value from your Trade Republic statement.",
        );
        continue;
      }
      addLot(r.symbol, shares, shares * price);
      book(r, {
        ...security(r, "DIVIDEND", r.datetime, shares, fmtPrice(price), `${r.name} - stock dividend: ${fmtPrice(shares)} shares${timeTag(r.datetime)}`),
        subtype: "DIVIDEND_IN_KIND",
        amount: fmtAmt(shares * price),
      });
      continue;
    }

    if (r.type === "DIVIDEND_REINVESTMENT") {
      const funding = negativeDividends.filter(
        (d) => d.symbol === r.symbol && !plan.has(d.transaction_id) && Math.abs(time(d) - time(r)) <= 7 * DAY_MS,
      );
      if (funding.length === 0 || shares <= 0) {
        skip(
          r,
          `Dividend reinvestment of ${fmtPrice(shares)} ${r.name} shares: the export has no matching cash debit, so the purchase price is unknown.`,
          "missing",
          "Add it manually in Wealthfolio as a BUY with the amount from your Trade Republic statement.",
        );
        continue;
      }
      const cash = closest(funding, r);
      const total = Math.abs(num(cash.amount)) + Math.abs(num(cash.fee));
      const unitPrice = fmtPrice(total / shares);
      const groupId = `buy-${r.transaction_id}`;
      addLot(r.symbol, shares, total);
      book(
        r,
        cashAct(cashAccountId, "TRANSFER_OUT", addSec(r.datetime, -2), total, `Funds for ${r.symbol} (${r.name}) dividend reinvestment -> Portfolio${timeTag(r.datetime)}`, undefined, groupId),
        cashAct(portfolioAccountId, "TRANSFER_IN", addSec(r.datetime, -1), total, `Funds from Cash for ${r.symbol} dividend reinvestment${timeTag(r.datetime)}`, undefined, groupId),
        {
          ...security(r, "BUY", r.datetime, shares, unitPrice, `${r.name} - dividend reinvestment${timeTag(r.datetime)}`),
          fee: "0",
          amount: tradeFinalCash("BUY", fmtPrice(shares), unitPrice, "0"),
        },
      );
      book(cash); // its cash is the funding above
      continue;
    }

    const label = SECURITY_EXCHANGE.get(r.type);
    if (!label) continue;
    const legs = sorted.filter(
      (x) => x.category === "CORPORATE_ACTION" && x.type === r.type && x.datetime === r.datetime,
    );
    const out = legs.filter((x) => num(x.shares) < 0);
    const inn = legs.filter((x) => num(x.shares) > 0);
    const skipAll = (reason: string, hint: string) => legs.forEach((x) => skip(x, reason, "missing", hint));
    if (out.length !== 1 || inn.length !== 1 || out[0].symbol === inn[0].symbol) {
      skipAll(
        `${label}: expected one outgoing and one incoming ISIN at the same time, found ${out.length} outgoing and ${inn.length} incoming.`,
        "Add the exchange manually in Wealthfolio: TRANSFER_OUT of the old and TRANSFER_IN of the new security.",
      );
      continue;
    }
    const [o, i] = [out[0], inn[0]];
    const outQty = Math.abs(num(o.shares));
    const inQty = num(i.shares);
    if (held(o.symbol) + 1e-9 < outQty) {
      skipAll(
        `${label} ${o.symbol} -> ${i.symbol}: the cost basis is unknown because this file holds only ${fmtPrice(held(o.symbol))} of the ${fmtPrice(outQty)} exchanged shares.`,
        fullHistory,
      );
      continue;
    }
    const cost = relieve(o.symbol, outQty);
    addLot(i.symbol, inQty, cost);
    const note = `${label}: ${o.symbol} -> ${i.symbol}`;
    book(o, security(o, "TRANSFER_OUT", o.datetime, outQty, fmtPrice(cost / outQty), `${o.name} - ${note}${timeTag(o.datetime)}`));
    book(i, security(i, "TRANSFER_IN", addSec(i.datetime, 1), inQty, fmtPrice(cost / inQty), `${i.name} - ${note}${timeTag(i.datetime)}`));
  }

  for (const neg of negativeDividends) {
    if (plan.has(neg.transaction_id)) continue;
    skip(
      neg,
      `Negative ${neg.type.toLowerCase()} of ${fmtAmt(Math.abs(num(neg.amount)))} ${neg.currency || cashCurrency} for ${neg.name}: neither a reversal of a matching dividend nor the payment for a dividend reinvestment.`,
      "missing",
      "Trade Republic debited this amount. Check your statement and add it manually in Wealthfolio (e.g. as a withdrawal or tax) if it is missing.",
    );
  }
  return plan;
}

export function transform(rows: TrRow[], config: AddonSettings): TransformResult {
  const { cashAccountId, portfolioAccountId, transferPatterns } = config;
  const cashCurrency = config.cashCurrency || "EUR";
  const cashAct = makeCashAct(cashCurrency);

  const activities: ActivityImportEx[] = [];
  const skipped: SkippedRow[] = [];
  const special = planSpecialRows(rows, config);
  const skip = (r: TrRow, reason: string, kind: SkipKind, hint?: string) =>
    skipped.push({ datetime: r.datetime, type: r.type, category: r.category, description: r.description, reason, kind, hint });

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

    // Rows that depend on other rows (corrections, corporate actions)
    const planned = r.transaction_id ? special.get(r.transaction_id) : undefined;
    if (planned && "skip" in planned) {
      skip(r, planned.skip.reason, planned.skip.kind, planned.skip.hint);
      continue;
    }
    if (planned) {
      activities.push(...planned.activities);
      continue;
    }

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
      skip(r, "Technical ISIN change by Trade Republic; the holding itself doesn't change.", "netted");
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
          skip(r, "Tax booking with no cash effect (amount and tax add up to 0).", "netted");
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

      skip(r, `Trade Republic transaction type CASH/${typ} isn't supported yet, so no activity was created.`, "missing", moneyHint(r));
      continue;
    }

    if (category === "CORPORATE_ACTION") {
      skip(
        r,
        `Corporate action ${typ} isn't supported yet, so ${r.name || r.symbol} wasn't changed${r.shares ? ` (${num(r.shares) > 0 ? "+" : ""}${r.shares.replace(/\.?0+$/, "")} shares)` : ""}.`,
        "missing",
        "Add the change manually in Wealthfolio so the share count matches Trade Republic, and report the type so it can be supported.",
      );
      continue;
    }
    skip(r, `Trade Republic category ${category}/${typ} isn't supported yet, so no activity was created.`, "missing", moneyHint(r));
  }

  sortAndNumber(activities);

  return { activities, skipped };
}
