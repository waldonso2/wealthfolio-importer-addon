// Performance report (docs/KENNZAHLEN.md): measured, compared with the reference values, never failing.
// `pnpm perf` (vitest.perf.config.ts) after `pnpm build`; the CI step runs with continue-on-error. The table goes
// to $GITHUB_STEP_SUMMARY (the run's summary page) and to perf-report.md.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { afterAll, expect, it } from "vitest";
import { parseAndTransform } from "./formats";
import { findExistingMatches, type ExistingLike, type IncomingLike } from "./importer";
import { parsePdfText } from "./pdf/parse";
import { migrateSettings } from "./settings";

const rows: string[][] = [];

function record(area: string, measure: string, value: number, unit: string, good?: number, source = "") {
  const verdict = good === undefined ? "–" : value <= good ? "✅" : "⚠️";
  const reference = good === undefined ? "" : `≤ ${good} ${unit} (${source})`;
  rows.push([area, measure, `${value.toLocaleString("en", { maximumFractionDigits: 1 })} ${unit}`, reference, verdict]);
}

function median(times: number[]): number {
  const s = [...times].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function timed(fn: () => unknown, runs = 5): number {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    times.push(performance.now() - t);
  }
  return median(times);
}

afterAll(() => {
  const text = [
    "## Performance (nur Bericht, hält die CI nicht an)",
    "",
    "| Bereich | Messung | Wert | Referenz | |",
    "|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.join(" | ")} |`),
    "",
  ].join("\n");
  console.log(text);
  writeFileSync(process.env.PERF_REPORT ?? "perf-report.md", text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
});

const settings = migrateSettings({
  cashAccountId: "cash",
  portfolioAccountId: "depot",
  scalableCashAccountId: "sc-cash",
  scalablePortfolioAccountId: "sc-depot",
});

// A CSV of `n` data rows: the fixture's rows repeated, each copy with its own transaction ids.
function bigCsv(path: string, n: number): string {
  const [header, ...body] = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  const out = [header];
  for (let i = 0; out.length <= n; i++) out.push(...body.map((l) => l.replace(/(0000-0000-0000-|ORDER|_)(\d+)/g, `$1${i}$2`)));
  return out.slice(0, n + 1).join("\n");
}

const ROWS = 10_000;

it("CSV import", () => {
  for (const [label, path] of [
    ["Trade Republic", "src/__fixtures__/tr-sample.csv"],
    ["Scalable", "src/__fixtures__/scalable-sample.csv"],
  ]) {
    const csv = bigCsv(path, ROWS);
    let ok = false;
    const ms = timed(() => (ok = parseAndTransform(csv, settings).ok), 3);
    expect(ok).toBe(true); // the measurement is of a real import; how fast is only reported
    // Nielsen: up to 1 s the user's flow of thought stays uninterrupted.
    record("Import", `${label}: CSV mit ${ROWS.toLocaleString("de")} Zeilen einlesen`, ms, "ms", 1000, "Nielsen 1 s");
  }
});

it("PDF statements (text already extracted)", () => {
  const texts = ["tr-kauf", "tr-dividende", "sc-kauf", "sc-dividende", "dkb-kauf"].map((f) =>
    readFileSync(`src/__fixtures__/pdf/${f}.txt`, "utf8"),
  );
  const n = 500;
  const ms = timed(() => {
    for (let i = 0; i < n; i++) parsePdfText(texts[i % texts.length]);
  });
  record("Import", `${n} PDF-Belege auswerten (ohne pdf.js)`, ms, "ms", 1000, "Nielsen 1 s");
});

it("duplicate matching", () => {
  const n = 3000;
  const base = Date.UTC(2026, 0, 1);
  const existing: ExistingLike[] = Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    accountId: "cash",
    activityType: "DEPOSIT",
    date: new Date(base + i * 3_600_000).toISOString(),
    amount: String(1000 + i),
    currency: "EUR",
  }));
  const incoming: IncomingLike[] = Array.from({ length: n }, (_, i) => ({
    key: i,
    accountId: "cash",
    activityType: "DEPOSIT",
    date: new Date(base + i * 3_600_000).toISOString(),
    amount: String(1000 + i),
    currency: "EUR",
  }));
  const ms = timed(() => findExistingMatches(incoming, existing), 3);
  record("Duplikat-Erkennung", `${n} neue gegen ${n} vorhandene Buchungen (stündlich, ~4 Monate)`, ms, "ms", 1000, "Nielsen 1 s");
});

it("bundle size", () => {
  let bundle: Buffer;
  try {
    bundle = readFileSync("dist/addon.js");
  } catch {
    return; // `pnpm build` first
  }
  const gzip = gzipSync(bundle).length;
  record("Paket", "dist/addon.js", bundle.length / 1024, "KiB", 3072, "eigenes Budget");
  record("Paket", "dist/addon.js, gzip", gzip / 1024, "KiB", 1024, "eigenes Budget");
});
