// The English and German bundles (#74): same keys, interpolation, plurals, fallback.
import { afterEach, describe, expect, it } from "vitest";
import type { AddonTranslationBundle } from "@wealthfolio/addon-sdk";
import { enT, msg, resources, setFallbackLanguage, textOf, translate } from "./i18n";
import { importButtonLabel } from "./importer";
import { mappingLabel, mappingWarning } from "./remap";

function keys(bundle: AddonTranslationBundle, prefix = ""): string[] {
  return Object.entries(bundle).flatMap(([k, v]) =>
    typeof v === "string" ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`),
  );
}

function values(bundle: AddonTranslationBundle): string[] {
  return Object.values(bundle).flatMap((v) => (typeof v === "string" ? [v] : values(v)));
}

const placeholders = (s: string) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

afterEach(() => setFallbackLanguage("en"));

describe("bundles", () => {
  it("German has exactly the keys of English, plural variants included", () => {
    expect(keys(resources.de).sort()).toEqual(keys(resources.en).sort());
  });

  it("every German text is filled and uses the same markup", () => {
    for (const key of keys(resources.en)) {
      const de = translate("de", key);
      expect(de, key).not.toBe("");
      const tags = (s: string) => (s.match(/<\/?(strong|code)>/g) ?? []).join("");
      expect(tags(de), key).toBe(tags(translate("en", key)));
    }
  });

  it("German uses no variable English doesn't define for the same key", () => {
    // German may use extra params the code passes (e.g. rawType), but every
    // placeholder must be one the code passes for that key in English or as an extra.
    const extras = new Set(["rawType"]);
    for (const key of keys(resources.en)) {
      const en = new Set(placeholders(translate("en", key)));
      for (const p of placeholders(translate("de", key))) expect(en.has(p) || extras.has(p), `${key}: ${p}`).toBe(true);
    }
  });

  it("has no empty values", () => {
    expect(values(resources.en).filter((v) => !v.trim())).toEqual([]);
  });
});

describe("translate", () => {
  it("interpolates values", () => {
    expect(translate("en", "remap.moving", { done: 2, total: 5 })).toBe("Moving 2 of 5…");
    expect(translate("de", "remap.moving", { done: 2, total: 5 })).toBe("2 von 5 werden verschoben…");
  });

  it("picks the plural form by count", () => {
    expect(translate("en", "mapping.remaining", { count: 1 })).toMatch(/^1 security remaining/);
    expect(translate("en", "mapping.remaining", { count: 3 })).toMatch(/^3 securities remaining/);
    expect(translate("de", "done.created", { count: 1 })).toBe("1 neue Aktivität importiert");
    expect(translate("de", "done.created", { count: 0 })).toBe("0 neue Aktivitäten importiert");
  });

  it("translates params named <name>Key into <name>", () => {
    const params = { type: "dividend", rawType: "DIVIDEND", whenKey: "skip.when.date", date: "2024-03-01" };
    expect(translate("en", "skip.tr.reversal", params)).toBe(
      "Reversal of the dividend of 2024-03-01; the two rows cancel out.",
    );
    expect(translate("de", "skip.tr.reversal", { ...params, whenKey: "skip.when.sameDay" })).toBe(
      "Storno von DIVIDEND, gebucht am selben Tag; beide Zeilen heben sich auf.",
    );
  });

  it("falls back to English for a missing key, and to the key itself", () => {
    (resources.de as Record<string, unknown>).only = undefined;
    (resources.en as Record<string, unknown>).only = { en: "Only English" };
    try {
      expect(translate("de", "only.en")).toBe("Only English");
    } finally {
      delete (resources.en as Record<string, unknown>).only;
      delete (resources.de as Record<string, unknown>).only;
    }
    expect(translate("de", "no.such.key")).toBe("no.such.key");
  });

  it("msg keeps the English text with its key and params", () => {
    expect(msg("upload.noRows", { broker: "DKB" })).toEqual({
      text: "No rows found in the DKB export.",
      key: "upload.noRows",
      params: { broker: "DKB" },
    });
    expect(textOf(enT, "raw text")).toBe("raw text");
    expect(textOf((k) => `translated ${k}`, "raw text", "a.key")).toBe("translated a.key");
  });
});

describe("logic module texts in German", () => {
  const deT = (key: string, params?: Record<string, string | number | undefined>) => translate("de", key, params);

  it("import button", () => {
    expect(importButtonLabel(1, 0, deT)).toBe("1 Aktivität importieren");
    expect(importButtonLabel(3, 6, deT)).toBe("3 neue importieren · 6 vorhandene aktualisieren");
  });

  it("mapping label and warning", () => {
    expect(mappingLabel("custom", deT)).toBe("Eigenes (ISIN als Symbol)");
    const other = { symbol: "DE000A0AAAA1", shortName: "Other", exchange: "", score: 0, typeDisplay: "", quoteType: "" };
    expect(mappingWarning("IE00B4L5Y983", "Fund", other as never, deT)).toBe("einer anderen ISIN zugeordnet (DE000A0AAAA1)");
  });
});
