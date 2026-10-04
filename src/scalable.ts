import { addSec, fmtAmt, makeCashAct, matchPattern, sortAndNumber, timeTag } from "./common";
import type { ActivityImportEx, AddonSettings, ScRow, SkippedRow, TransformResult } from "./types";

// Scalable Capital transaction export → Wealthfolio activities.
// See docs/ARCHITECTURE.md section 14 for the format and the mapping rules.

const TIME_ZONE = "Europe/Berlin";
const DAY_MS = 24 * 60 * 60 * 1000;
// Max distance between the out- and in-leg of a depot migration / correction.
const NETTING_WINDOW_MS = 7 * DAY_MS;

// German number: decimal comma, optional "." thousands separator. "" → 0.
export function deNum(s: string | undefined | null): number {
  if (!s || s.trim() === "") return 0;
  return parseFloat(s.trim().replace(/\./g, "").replace(",", "."));
}

// Plain decimal string for quantities ("12,933359" → "12.933359").
function qty(s: string): string {
  return fmtAmt(deNum(s));
}

const berlinFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

// Offset of Europe/Berlin from UTC at the given instant, in ms.
function berlinOffset(utcMs: number): number {
  const parts = Object.fromEntries(
    berlinFmt.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - utcMs;
}

// "16.06.2026" + "20:09:37" (Berlin local time) → "2026-06-16T18:09:37.000Z".
// Datum occasionally carries a trailing " 00:00:00", so only the first 10 chars count.
// Uses Intl rather than the machine's time zone, so results are identical in CI (UTC).
export function berlinToIso(datum: string, uhrzeit: string): string {
  const [d, m, y] = datum.trim().slice(0, 10).split(".").map(Number);
  const [hh = 0, mi = 0, ss = 0] = (uhrzeit || "00:00:00").trim().split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mi, ss);
  let utc = guess - berlinOffset(guess);
  utc = guess - berlinOffset(utc); // re-evaluate near DST switches
  return new Date(utc).toISOString();
}

// Stable 32-bit FNV-1a hash → hex. Used as an ID for rows without an order ID;
// row indices are not stable because new exports prepend rows.
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function rowId(r: ScRow): string {
  if ((r.Typ === "Kauf" || r.Typ === "Verkauf") && r.Notiz.trim()) return r.Notiz.trim();
  return hash([r.Datum, r.Uhrzeit, r.Typ, r.ISIN, r.Wert, r.Notiz].join("|"));
}

function day(r: ScRow): string {
  return r.Datum.trim().slice(0, 10);
}

// Direction of a security transfer row (empty Typ). The sign of Wert is not
// reliable: CANCEL-… rows carry a positive Wert but reverse an earlier in-leg.
function isOutgoing(r: ScRow): boolean {
  if (r.Notiz.trim().startsWith("CANCEL-")) return true;
  return deNum(r.Wert) <= 0;
}

const COLUMNS = [
  "Datum",
  "Uhrzeit",
  "Typ",
  "Wertpapiername",
  "ISIN",
  "Wert",
  "Stück",
  "Buchungswährung",
  "Gebühren",
  "Steuern",
  "Bruttobetrag",
  "Notiz",
] as const;

export function transformScalable(input: ScRow[], config: AddonSettings): TransformResult {
  // Short rows from the CSV parser leave columns undefined; normalise to "".
  const rows: ScRow[] = input.map((r) => {
    const out = { ...r };
    for (const c of COLUMNS) out[c] = (r[c] ?? "").trim();
    return out;
  });
  const cashAccountId = config.scalableCashAccountId;
  const portfolioAccountId = config.scalablePortfolioAccountId;
  const { transferPatterns } = config;
  const cashCurrency = config.scalableCashCurrency || "EUR";
  const cashAct = makeCashAct(cashCurrency);

  const activities: ActivityImportEx[] = [];
  const skipped: SkippedRow[] = [];
  // Rows already handled as part of a pair; the main loop skips them.
  const consumed = new Set<ScRow>();
  const ts = new Map<ScRow, string>();
  for (const r of rows) ts.set(r, berlinToIso(r.Datum, r.Uhrzeit));
  const time = (r: ScRow) => new Date(ts.get(r)!).getTime();

  const skip = (r: ScRow, reason: string) => {
    consumed.add(r);
    skipped.push({
      datetime: ts.get(r)!,
      type: r.Typ || "(Übertrag)",
      category: "SCALABLE",
      description: r.Wertpapiername ? `${r.Wertpapiername} — ${r.Notiz}` : r.Notiz,
      reason,
    });
  };

  // P→C cash sweep after a sale-like event, tagged as one internal transfer.
  const sweepToCash = (dt: string, amount: number, label: string, groupId: string) => {
    activities.push(
      cashAct(portfolioAccountId, "TRANSFER_OUT", addSec(dt, 1), amount, `${label} -> Cash${timeTag(dt)}`, undefined, groupId),
    );
    activities.push(
      cashAct(cashAccountId, "TRANSFER_IN", addSec(dt, 2), amount, `${label} from Portfolio${timeTag(dt)}`, undefined, groupId),
    );
  };

  const securitySell = (r: ScRow, dt: string, shares: string, proceeds: number, comment: string, groupId: string) => {
    const n = deNum(shares);
    activities.push({
      accountId: portfolioAccountId,
      activityType: "SELL",
      date: dt,
      symbol: r.ISIN,
      symbolName: r.Wertpapiername,
      quoteCcy: r.Buchungswährung || cashCurrency,
      quantity: qty(shares),
      unitPrice: n ? fmtAmt(proceeds / n) : "0",
      fee: "0",
      currency: r.Buchungswährung || cashCurrency,
      comment: comment + timeTag(dt),
      isValid: true,
      isDraft: false,
    });
    sweepToCash(dt, proceeds, `${r.ISIN} (${r.Wertpapiername})`, groupId);
  };

  // ── Pass 1: dividend cancellations (Storno) ───────────────────────────────
  // A negative Dividende with "CANCEL-<ref>" reverses the original dividend whose
  // Notiz contains <ref>; both are dropped, the re-booking (if any) stays.
  for (const c of rows) {
    if (c.Typ !== "Dividende" || deNum(c.Wert) >= 0 || consumed.has(c)) continue;
    const ref = /CANCEL-([^_]+)/.exec(c.Notiz)?.[1];
    const original = ref
      ? rows.find(
          (o) =>
            o !== c &&
            !consumed.has(o) &&
            o.Typ === "Dividende" &&
            o.ISIN === c.ISIN &&
            deNum(o.Wert) > 0 &&
            Math.round(deNum(o.Wert) * 100) === Math.round(-deNum(c.Wert) * 100) &&
            o.Notiz.includes(ref),
        )
      : undefined;
    if (original) {
      skip(c, "Dividend cancellation (Storno) — offsets the original dividend");
      skip(original, `Dividend cancelled later (${ref})`);
    } else {
      skip(c, "Negative dividend without a matching original dividend");
    }
  }

  // ── Pass 2: security transfers (empty Typ) ────────────────────────────────
  // Out- and in-legs with the same share count within 7 days net to zero
  // (depot migration, CANCEL-/CORR-SWITCH corrections) and are skipped.
  const transfers = rows.filter((r) => r.Typ.trim() === "" && r.ISIN);
  const outs = transfers.filter(isOutgoing).sort((a, b) => time(a) - time(b));
  const ins = transfers.filter((r) => !isOutgoing(r));
  for (const o of outs) {
    let best: ScRow | undefined;
    for (const i of ins) {
      if (consumed.has(i) || i.ISIN !== o.ISIN) continue;
      if (Math.abs(deNum(i.Stück) - deNum(o.Stück)) > 1e-9) continue;
      const dist = Math.abs(time(i) - time(o));
      if (dist > NETTING_WINDOW_MS) continue;
      if (!best || dist < Math.abs(time(best) - time(o))) best = i;
    }
    if (best) {
      skip(o, "Depot migration/correction — offset by a matching transfer in");
      skip(best, "Depot migration/correction — offset by a matching transfer out");
    }
  }

  // Remaining outgoing legs: fund liquidation (SWAP_OUT) or certificate
  // redemption (zero-value row + "Dividende" payout) become a SELL.
  for (const o of outs) {
    if (consumed.has(o)) continue;
    const ref = o.Notiz.trim();
    const dt = ts.get(o)!;
    const swap = rows.find(
      (s) => !consumed.has(s) && s.Typ === "SWAP_OUT" && day(s) === day(o) && ref && s.Notiz.includes(ref),
    );
    if (swap) {
      consumed.add(o);
      consumed.add(swap);
      securitySell(o, dt, o.Stück, deNum(swap.Wert), `${o.Wertpapiername} - fund liquidation (SWAP_OUT)`, `sc-swap-${rowId(o)}`);
      continue;
    }
    if (deNum(o.Wert) === 0) {
      const payout = rows.find(
        (d) =>
          !consumed.has(d) &&
          d.Typ === "Dividende" &&
          d.ISIN === o.ISIN &&
          day(d) === day(o) &&
          deNum(d.Wert) > 0 &&
          ref &&
          d.Notiz.includes(ref),
      );
      if (payout) {
        consumed.add(o);
        consumed.add(payout);
        securitySell(o, dt, o.Stück, deNum(payout.Wert), `${o.Wertpapiername} - redemption`, `sc-redeem-${rowId(o)}`);
        continue;
      }
    }
  }

  // ── Pass 3: cash leg of the depot migration ───────────────────────────────
  // An "Einlage" tagged SWITCH- and an "Entnahme" of the same amount within
  // 7 days move cash between the old and new depot; both are skipped.
  for (const e of rows) {
    if (consumed.has(e) || e.Typ !== "Einlage" || !e.Notiz.includes("SWITCH-")) continue;
    let best: ScRow | undefined;
    for (const w of rows) {
      if (consumed.has(w) || w.Typ !== "Entnahme") continue;
      if (Math.round(-deNum(w.Wert) * 100) !== Math.round(deNum(e.Wert) * 100)) continue;
      const dist = Math.abs(time(w) - time(e));
      if (dist > NETTING_WINDOW_MS) continue;
      if (!best || dist < Math.abs(time(best) - time(e))) best = w;
    }
    if (best) {
      skip(e, "Depot migration cash — offset by a matching withdrawal");
      skip(best, "Depot migration cash — offset by a matching deposit");
    }
  }

  // ── Pass 4: everything else, row by row ───────────────────────────────────
  for (const r of rows) {
    if (consumed.has(r)) continue;
    const dt = ts.get(r)!;
    const id = rowId(r);
    const wert = deNum(r.Wert);
    const abs = Math.abs(wert);
    const ccy = r.Buchungswährung || cashCurrency;
    const notiz = r.Notiz.trim();

    switch (r.Typ.trim()) {
      case "Kauf": {
        const shares = deNum(r.Stück);
        const brutto = deNum(r.Bruttobetrag);
        const feeTotal = deNum(r.Gebühren) + deNum(r.Steuern);
        const groupId = `sc-buy-${id}`;
        activities.push(
          cashAct(cashAccountId, "TRANSFER_OUT", addSec(dt, -2), abs, `Funds for ${r.ISIN} (${r.Wertpapiername}) buy -> Portfolio${timeTag(dt)}`, undefined, groupId),
        );
        activities.push(
          cashAct(portfolioAccountId, "TRANSFER_IN", addSec(dt, -1), abs, `Funds from Cash for ${r.ISIN} buy${timeTag(dt)}`, undefined, groupId),
        );
        activities.push({
          accountId: portfolioAccountId,
          activityType: "BUY",
          date: dt,
          symbol: r.ISIN,
          symbolName: r.Wertpapiername,
          quoteCcy: ccy,
          quantity: qty(r.Stück),
          unitPrice: shares ? fmtAmt(brutto / shares) : "0",
          fee: feeTotal ? fmtAmt(feeTotal) : "0",
          currency: ccy,
          comment: `${r.Wertpapiername}${timeTag(dt)}`,
          isValid: true,
          isDraft: false,
        });
        break;
      }

      case "Verkauf": {
        const shares = deNum(r.Stück);
        const brutto = deNum(r.Bruttobetrag);
        const feeTotal = deNum(r.Gebühren) + deNum(r.Steuern);
        activities.push({
          accountId: portfolioAccountId,
          activityType: "SELL",
          date: dt,
          symbol: r.ISIN,
          symbolName: r.Wertpapiername,
          quoteCcy: ccy,
          quantity: qty(r.Stück),
          unitPrice: shares ? fmtAmt(brutto / shares) : "0",
          fee: feeTotal ? fmtAmt(feeTotal) : "0",
          currency: ccy,
          comment: `${r.Wertpapiername}${timeTag(dt)}`,
          isValid: true,
          isDraft: false,
        });
        sweepToCash(dt, abs, `${r.ISIN} (${r.Wertpapiername}) sale`, `sc-sell-${id}`);
        break;
      }

      case "Dividende": {
        activities.push({
          accountId: portfolioAccountId,
          activityType: "DIVIDEND",
          date: dt,
          symbol: r.ISIN,
          symbolName: r.Wertpapiername,
          quoteCcy: ccy,
          quantity: "1",
          currency: ccy,
          amount: fmtAmt(abs),
          comment: `Dividend ${r.Wertpapiername}${timeTag(dt)}`,
          isValid: true,
          isDraft: false,
        });
        sweepToCash(dt, abs, `Dividend ${r.Wertpapiername}`, `sc-div-${id}`);
        break;
      }

      case "Zinsen":
        if (wert >= 0) activities.push(cashAct(cashAccountId, "INTEREST", dt, abs, `Zinsen ${notiz}`.trim() + timeTag(dt)));
        else activities.push(cashAct(cashAccountId, "FEE", dt, abs, `Negativzinsen ${notiz}`.trim() + timeTag(dt), "INTEREST_CHARGE"));
        break;

      // Inbound cash is always external income — no transfer-pattern check.
      case "Einlage":
        activities.push(cashAct(cashAccountId, "DEPOSIT", dt, abs, notiz + timeTag(dt)));
        break;

      // Outbound cash checks transfer patterns (keyword/IBAN text in Notiz only;
      // Scalable exports carry no counterparty IBAN).
      case "Entnahme": {
        const match = matchPattern("", notiz, transferPatterns);
        if (match) {
          const groupId = match.destinationAccountId ? `sc-xfer-${id}` : undefined;
          activities.push(
            cashAct(cashAccountId, "TRANSFER_OUT", dt, abs, `-> ${match.label}: ${notiz}${timeTag(dt)}`, undefined, groupId),
          );
          if (match.destinationAccountId) {
            activities.push(
              cashAct(match.destinationAccountId, "TRANSFER_IN", dt, abs, `<- Scalable: ${notiz}${timeTag(dt)}`, undefined, groupId),
            );
          }
        } else {
          activities.push(cashAct(cashAccountId, "WITHDRAWAL", dt, abs, notiz + timeTag(dt)));
        }
        break;
      }

      case "TAX":
        if (wert <= 0) activities.push(cashAct(cashAccountId, "TAX", dt, abs, notiz + timeTag(dt)));
        else activities.push(cashAct(cashAccountId, "CREDIT", dt, abs, notiz + timeTag(dt), "TAX_REFUND"));
        break;

      case "Steuerrückerstattung":
        activities.push(cashAct(cashAccountId, "CREDIT", dt, abs, `Steuerrückerstattung ${notiz}`.trim() + timeTag(dt), "TAX_REFUND"));
        break;

      case "FEE":
        if (wert <= 0) activities.push(cashAct(cashAccountId, "FEE", dt, abs, notiz + timeTag(dt)));
        else activities.push(cashAct(cashAccountId, "CREDIT", dt, abs, notiz + timeTag(dt), "FEE_REFUND"));
        break;

      case "SWAP_OUT":
        skip(r, "SWAP_OUT without a matching security transfer row");
        break;

      case "": {
        if (!r.ISIN) {
          skip(r, "Empty type without ISIN");
          break;
        }
        // Unpaired security transfer: in → like a TR FREE_RECEIPT, out → security TRANSFER_OUT.
        const shares = deNum(r.Stück);
        const out = isOutgoing(r);
        activities.push({
          accountId: portfolioAccountId,
          activityType: out ? "TRANSFER_OUT" : "TRANSFER_IN",
          date: dt,
          symbol: r.ISIN,
          symbolName: r.Wertpapiername,
          quoteCcy: ccy,
          quantity: qty(r.Stück),
          unitPrice: shares && abs ? fmtAmt(abs / shares) : undefined,
          currency: ccy,
          comment: `${r.Wertpapiername} security transfer ${out ? "out" : "in"} (${notiz})${timeTag(dt)}`,
          isValid: true,
          isDraft: false,
        });
        break;
      }

      default:
        skip(r, `Unknown Scalable type: ${r.Typ}`);
    }
  }

  sortAndNumber(activities);
  return { activities, skipped };
}
