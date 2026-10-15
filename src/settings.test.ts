import { describe, expect, it } from "vitest";
import { brokerConfig, FORMATS } from "./formats";
import { DEFAULT_SETTINGS, migrateSettings } from "./settings";

// Settings saved before 3.9.4 had named fields per broker; they are taken over without the user doing anything (#79).
describe("settings migration", () => {
  it("takes over the account pairs of an older version", () => {
    const s = migrateSettings({
      cashAccountId: "tr-cash",
      cashCurrency: "CHF",
      portfolioAccountId: "tr-depot",
      scalableCashAccountId: "sc-cash",
      scalableCashCurrency: "EUR",
      scalablePortfolioAccountId: "sc-depot",
      dkbCashAccountId: "dkb-cash",
      dkbPortfolioAccountId: "dkb-depot",
      transferPatterns: [{ label: "Tagesgeld", keyword: "Spar" }],
      securityMappings: { IE00B4L5Y983: "custom" },
      securityNames: { IE00B4L5Y983: "World" },
    });
    expect(s.brokers).toEqual({
      "trade-republic": { cashAccountId: "tr-cash", portfolioAccountId: "tr-depot", cashCurrency: "CHF" },
      scalable: { cashAccountId: "sc-cash", portfolioAccountId: "sc-depot", cashCurrency: "EUR" },
      dkb: { cashAccountId: "dkb-cash", portfolioAccountId: "dkb-depot", cashCurrency: "EUR" },
    });
    expect(s.transferPatterns).toHaveLength(1);
    expect(s.securityMappings).toEqual({ IE00B4L5Y983: "custom" });
    expect(s.securityNames).toEqual({ IE00B4L5Y983: "World" });
    expect(Object.keys(s)).toEqual(Object.keys(DEFAULT_SETTINGS)); // the old fields are gone
  });

  it("keeps what this version saved, and fills a broker added since", () => {
    const saved = JSON.parse(JSON.stringify(migrateSettings({ cashAccountId: "a", portfolioAccountId: "b" })));
    delete saved.brokers.dkb;
    const s = migrateSettings(saved);
    expect(s.brokers["trade-republic"].cashAccountId).toBe("a");
    expect(s.brokers.dkb).toEqual({ cashAccountId: "", portfolioAccountId: "", cashCurrency: "EUR" });
    expect(Object.keys(s.brokers)).toEqual(FORMATS);
  });

  it("gives each transformer its broker's pair and the patterns", () => {
    const s = migrateSettings({ scalableCashAccountId: "sc", scalablePortfolioAccountId: "sp", transferPatterns: [] });
    expect(brokerConfig("scalable", s)).toEqual({
      cashAccountId: "sc",
      portfolioAccountId: "sp",
      cashCurrency: "EUR",
      transferPatterns: [],
    });
  });
});
