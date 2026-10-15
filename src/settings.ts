import type { AddonSettings, BrokerAccounts } from "./types";
import type { AddonContext } from "@wealthfolio/addon-sdk";
import { FORMATS, type ImportFormat } from "./formats";

const SECRETS_KEY = "config";

const EMPTY: BrokerAccounts = { cashAccountId: "", portfolioAccountId: "", cashCurrency: "EUR" };

export const DEFAULT_SETTINGS: AddonSettings = {
  brokers: Object.fromEntries(FORMATS.map((f) => [f, { ...EMPTY }])) as Record<ImportFormat, BrokerAccounts>,
  transferPatterns: [],
  securityMappings: {},
  securityNames: {},
};

// The named fields of settings saved before 3.9.4, per broker (#79).
const LEGACY: Record<ImportFormat, [string, string, string?]> = {
  "trade-republic": ["cashAccountId", "portfolioAccountId", "cashCurrency"],
  scalable: ["scalableCashAccountId", "scalablePortfolioAccountId", "scalableCashCurrency"],
  dkb: ["dkbCashAccountId", "dkbPortfolioAccountId"],
};

// Settings as stored - this version's or an older one's - as this version's: nothing the user chose is lost.
export function migrateSettings(raw: Record<string, unknown>): AddonSettings {
  const stored = (raw.brokers ?? {}) as Partial<Record<ImportFormat, Partial<BrokerAccounts>>>;
  const brokers = {} as Record<ImportFormat, BrokerAccounts>;
  for (const f of FORMATS) {
    const [cash, portfolio, currency] = LEGACY[f];
    const legacy = {
      cashAccountId: (raw[cash] as string) || "",
      portfolioAccountId: (raw[portfolio] as string) || "",
      cashCurrency: (currency && (raw[currency] as string)) || "EUR",
    };
    brokers[f] = { ...EMPTY, ...(stored[f] ? {} : legacy), ...stored[f] };
  }
  return {
    brokers,
    transferPatterns: (raw.transferPatterns as AddonSettings["transferPatterns"]) ?? [],
    securityMappings: (raw.securityMappings as AddonSettings["securityMappings"]) ?? {},
    securityNames: (raw.securityNames as AddonSettings["securityNames"]) ?? {},
  };
}

export async function loadSettings(ctx: AddonContext): Promise<AddonSettings> {
  try {
    const raw = await ctx.api.secrets.get(SECRETS_KEY);
    if (!raw) return migrateSettings({});
    return migrateSettings(JSON.parse(raw));
  } catch {
    return migrateSettings({});
  }
}

export async function saveSettings(ctx: AddonContext, settings: AddonSettings): Promise<void> {
  await ctx.api.secrets.set(SECRETS_KEY, JSON.stringify(settings));
}
