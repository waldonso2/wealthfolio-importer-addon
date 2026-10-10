import type { ActivityDetails, ActivityUpdate, AddonContext, AssetResolutionInput } from "@wealthfolio/addon-sdk";
import { errorMessage } from "./importer";
import type { AddonSettings, SecurityMapping } from "./types";

// Correcting a wrong ISIN -> asset mapping (#41), kept free of React so it can
// be unit-tested: which existing activities sit on the mapped asset, moving the
// chosen ones to a new asset, and a warning for mappings that look wrong.

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
// Activities that carry the security. Cash transfers carry no asset and stay as they are.
const ASSET_TYPES = new Set(["BUY", "SELL", "DIVIDEND", "SPLIT", "TRANSFER_IN", "TRANSFER_OUT", "ADD_HOLDING", "REMOVE_HOLDING"]);

export function mappingSymbol(isin: string, m: SecurityMapping): string {
  return m === "custom" ? isin : m.canonicalSymbol || m.symbol;
}

export function mappingLabel(m: SecurityMapping): string {
  if (m === "custom") return "Custom (ISIN as symbol)";
  return `${m.canonicalSymbol || m.symbol}${m.shortName ? ` — ${m.shortName}` : ""}`;
}

// The names of the file's securities, remembered with their mappings.
export function rememberNames(settings: AddonSettings, securities: { isin: string; name: string }[]): Record<string, string> {
  const names = { ...settings.securityNames };
  for (const s of securities) if (s.name) names[s.isin] = s.name;
  return names;
}

// Leverage factor ("3x", "2 x", "-3x") and direction words of a product name.
function leverage(name: string): string | null {
  const m = /(?:^|[\s(])-?(\d+(?:[.,]\d+)?)\s*x(?=$|[\s)])/i.exec(name);
  return m ? m[1].replace(",", ".") : null;
}

function directions(name: string): string {
  const words = name.toLowerCase().match(/\b(short|long|bear|bull|inverse)\b/g) ?? [];
  const norm = words.map((w) => (w === "bear" || w === "inverse" ? "short" : w === "bull" ? "long" : w));
  return [...new Set(norm)].sort().join(",");
}

// Why the mapping of `isin` (named `name` in the broker's file) looks wrong, or null.
export function mappingWarning(isin: string, name: string, m: SecurityMapping | undefined): string | null {
  if (!m || m === "custom") return null;
  const symbol = mappingSymbol(isin, m);
  if (ISIN_RE.test(symbol) && symbol !== isin) return `mapped to another ISIN (${symbol})`;
  if (!name) return null;
  const target = [m.shortName, m.longName].filter(Boolean).join(" ");
  const ours = leverage(name);
  const theirs = leverage(target);
  if (ours && theirs && ours !== theirs) return `leverage differs (${ours}x here, ${theirs}x at ${symbol})`;
  if (target && directions(name) !== directions(target)) return `long/short differs from ${m.shortName || symbol}`;
  return null;
}

// What an activity of this mapping is booked under in Wealthfolio.
export function mappingAsset(isin: string, name: string, m: SecurityMapping): AssetResolutionInput {
  if (m === "custom") return { symbol: isin, name: name || undefined };
  return {
    id: m.existingAssetId,
    symbol: m.canonicalSymbol || m.symbol,
    exchangeMic: m.canonicalExchangeMic || m.exchangeMic,
    name: m.shortName,
    quoteCcy: m.currency,
    instrumentType: m.quoteType === "EQUITY" ? "EQUITY" : m.quoteType === "ETF" ? "FUND" : undefined,
    providerId: m.providerId,
    providerSymbol: m.providerSymbol,
  } as AssetResolutionInput;
}

// Activities of the given (securities) accounts booked on the asset `m` points to.
// They can belong to other ISINs mapped to the same asset - the user picks.
export function activitiesOnMapping(
  activities: ActivityDetails[],
  isin: string,
  m: SecurityMapping,
  accountIds: string[],
): ActivityDetails[] {
  const symbol = mappingSymbol(isin, m);
  const assetId = m === "custom" ? undefined : m.existingAssetId;
  return activities
    .filter(
      (a) =>
        accountIds.includes(a.accountId) &&
        ASSET_TYPES.has(a.activityType) &&
        ((!!assetId && a.assetId === assetId) || a.assetSymbol === symbol || a.assetId === symbol),
    )
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// Whether an activity was most likely imported for this security: the addon's
// comments start with the security name from the broker's file.
export function likelyOfSecurity(a: ActivityDetails, name: string): boolean {
  return !!name && (a.comment ?? "").toLowerCase().includes(name.toLowerCase());
}

// The same activity on another asset; everything else (comment, amounts, group) unchanged.
export function remapPayload(a: ActivityDetails, asset: AssetResolutionInput): ActivityUpdate {
  return {
    id: a.id,
    accountId: a.accountId,
    activityType: a.activityType,
    subtype: a.subtype,
    activityDate: new Date(a.date).toISOString(),
    asset,
    quantity: a.quantity,
    unitPrice: a.unitPrice,
    amount: a.amount,
    currency: a.currency,
    fee: a.fee,
    tax: a.tax,
    fxRate: a.fxRate,
    comment: a.comment,
    needsReview: a.needsReview,
  };
}

export interface RemapRun {
  moved: number;
  failed: { activity: ActivityDetails; error: string }[];
}

// Moves the activities one at a time; a failure doesn't stop the others.
export async function remapActivities(
  api: Pick<AddonContext["api"]["activities"], "update">,
  activities: ActivityDetails[],
  asset: AssetResolutionInput,
  onProgress?: (done: number, total: number) => void,
): Promise<RemapRun> {
  const run: RemapRun = { moved: 0, failed: [] };
  for (let i = 0; i < activities.length; i++) {
    try {
      await api.update(remapPayload(activities[i], asset));
      run.moved++;
    } catch (e) {
      run.failed.push({ activity: activities[i], error: errorMessage(e) });
    }
    onProgress?.(i + 1, activities.length);
  }
  return run;
}
