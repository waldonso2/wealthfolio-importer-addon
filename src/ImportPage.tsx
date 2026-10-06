import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Account, ActivityImport, AddonContext } from "@wealthfolio/addon-sdk";
import {
  Button,
  Card,
  CardContent,
  Icons,
  Progress,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@wealthfolio/ui";
import { loadSettings, saveSettings } from "./settings";
import { SecurityMappingStep } from "./SecurityMappingStep";
import type { SecurityInfo, SecurityMapping } from "./SecurityMappingStep";
import { isCashSymbol } from "./common";
import {
  FORMAT_LABEL,
  formatAccounts,
  isFormatConfigured,
  parseAndTransform,
  type ImportFormat,
  type ParseOutcome,
} from "./formats";
import {
  activityStatus,
  applySecurityMappings,
  failedAsCsv,
  firstError,
  accountsToMatch,
  groupIdsByLine,
  importButtonLabel,
  matchExisting,
  runImport,
  selectCandidates,
  type FailedActivity,
} from "./importer";
import { parsePdfFiles } from "./pdf";
import { cashDifference, reconcile, type Reconciliation } from "./reconcile";
import type { ActivityImportEx, AddonSettings, SkippedRow, TransformResult } from "./types";

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return String(iso).replace("T", " ").slice(0, 16);
}

function truncate(s: string | null | undefined, n = 60): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function displayAmount(a: ActivityImport): string {
  const ccy = a.currency ?? "EUR";
  if (a.amount != null && a.amount !== "") return `${Number(a.amount).toFixed(2)} ${ccy}`;
  if (a.quantity != null && a.unitPrice != null) {
    return `${(parseFloat(String(a.quantity)) * parseFloat(String(a.unitPrice))).toFixed(2)} ${ccy}`;
  }
  return "—";
}

// ─── UploadZone ─────────────────────────────────────────────────────────────

function UploadZone({ onFiles, error, busy }: { onFiles: (f: File[]) => void; error: string; busy: string }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) onFiles(files);
    },
    [onFiles],
  );
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`cursor-pointer rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
        dragging
          ? "border-primary bg-primary/5"
          : "border-muted-foreground/30 hover:border-primary/50"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onFiles(files);
          e.target.value = "";
        }}
      />
      <Icons.Upload className="text-muted-foreground mx-auto mb-3 h-8 w-8" />
      <p className="text-sm font-medium">Drop a CSV export or any number of PDF statements here</p>
      <p className="text-muted-foreground mt-1 text-xs">or click to browse</p>
      {busy && <p className="text-muted-foreground mt-3 text-xs">{busy}</p>}
      {error && <p className="text-destructive mt-3 text-xs">{error}</p>}
    </div>
  );
}

// ─── SkippedTable ────────────────────────────────────────────────────────────

// Rows Wealthfolio will be missing come first; rows that were netted out on
// purpose need no action.
const SKIP_STATUS: Record<NonNullable<SkippedRow["kind"]>, { label: string; className: string }> = {
  missing: { label: "Not imported", className: "text-destructive font-medium" },
  netted: { label: "No action needed", className: "text-muted-foreground" },
};

function SkippedTable({ rows }: { rows: SkippedRow[] }) {
  if (rows.length === 0)
    return <p className="text-muted-foreground p-3 text-xs">No rows were skipped.</p>;
  const ordered = [...rows].sort((a, b) => Number(a.kind === "netted") - Number(b.kind === "netted"));
  return (
    <div className="max-h-96 overflow-auto">
      <table className="w-full text-xs">
        <thead className="bg-background sticky top-0 border-b">
          <tr>
            {["Date", "Type", "Description", "Status", "Reason"].map((h) => (
              <th key={h} className="text-muted-foreground px-2 py-1.5 text-left font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.map((r, i) => (
            <tr key={i} className="border-border/50 border-b align-top">
              <td className="whitespace-nowrap px-2 py-1 font-mono">{fmtDate(r.datetime)}</td>
              <td className="whitespace-nowrap px-2 py-1 font-mono">{r.type}</td>
              <td className="text-muted-foreground px-2 py-1">{truncate(r.description, 80)}</td>
              <td className={`whitespace-nowrap px-2 py-1 ${r.kind ? SKIP_STATUS[r.kind].className : "text-muted-foreground"}`}>
                {r.kind ? SKIP_STATUS[r.kind].label : "—"}
              </td>
              <td className="px-2 py-1">
                <span className="text-muted-foreground">{r.reason}</span>
                {r.hint && <span className="mt-0.5 block">{r.hint}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Import outcome (#11) ───────────────────────────────────────────────────

interface ImportOutcome {
  total: number;
  imported: number;
  // Of `imported`: existing activities that were updated.
  updated: number;
  userSkipped: number;
  failed: FailedActivity[];
  // Kept so a retry sends the failed activities with their sourceGroupId.
  groupIdByLine: Map<number, string>;
}

function FailedTable({ failed, accountName }: { failed: FailedActivity[]; accountName: (id: string) => string }) {
  return (
    <div className="max-h-96 overflow-auto">
      <table className="w-full text-xs">
        <thead className="bg-background sticky top-0 border-b">
          <tr>
            {["Date", "Account", "Type", "Symbol", "Amount", "Error"].map((h) => (
              <th key={h} className="text-muted-foreground px-2 py-1.5 text-left font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {failed.map(({ activity: a, error }, i) => (
            <tr key={i} className="border-border/50 border-b align-top">
              <td className="whitespace-nowrap px-2 py-1 font-mono">{fmtDate(String(a.date))}</td>
              <td className="whitespace-nowrap px-2 py-1">{accountName(a.accountId ?? "")}</td>
              <td className="whitespace-nowrap px-2 py-1 font-mono">{a.activityType}</td>
              <td className="px-2 py-1 font-mono">{isCashSymbol(a.symbol) ? "" : a.symbol}</td>
              <td className="whitespace-nowrap px-2 py-1 text-right font-mono">{displayAmount(a)}</td>
              <td className="text-destructive px-2 py-1">{error}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Reconciliation (#10) ───────────────────────────────────────────────────

const fmtMoney = (amount: number, currency: string) =>
  `${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
const fmtShares = (q: number) => q.toLocaleString(undefined, { maximumFractionDigits: 6 });

// What the broker's two accounts will look like after the import, from the file
// alone - so mapping errors show up before anything reaches Wealthfolio.
function ReconcileSummary({
  rec,
  broker,
  notImported,
  fromPdf,
}: {
  rec: Reconciliation;
  broker: string;
  notImported: number;
  fromPdf: boolean;
}) {
  const diff = cashDifference(rec);
  const cashEntries = Object.entries(rec.cash);
  const leftover = Object.entries(rec.portfolioCash);
  const ok = "text-green-700 dark:text-green-400";
  return (
    <Card>
      <CardContent className="space-y-2 p-4 text-sm">
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          <div>
            <p className="text-muted-foreground text-xs">
              {fromPdf ? "Cash account change from these statements" : "Cash account after import"}
            </p>
            <p className="font-medium">
              {cashEntries.length === 0 ? "0.00" : cashEntries.map(([c, v]) => fmtMoney(v, c)).join(" · ")}
            </p>
            {rec.brokerCash &&
              (diff === 0 ? (
                <p className={`text-xs ${ok}`}>Matches the {broker} balance in the file</p>
              ) : (
                <p className="text-destructive text-xs">
                  {broker} balance in the file: {fmtMoney(rec.brokerCash.amount, rec.brokerCash.currency)} — differs by{" "}
                  {fmtMoney(diff, rec.brokerCash.currency)}
                  {notImported > 0 && ` (see the ${notImported} not imported rows under Skipped)`}
                </p>
              ))}
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Cash left on the securities account</p>
            {leftover.length === 0 ? (
              <p className={`font-medium ${ok}`}>None</p>
            ) : (
              <p className="text-destructive font-medium">
                {leftover.map(([c, v]) => fmtMoney(v, c)).join(" · ")} — should be 0
              </p>
            )}
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Positions after import</p>
            <p className="font-medium">{rec.holdings.length} (see Holdings)</p>
          </div>
        </div>
        {rec.negative.length > 0 &&
          (fromPdf ? (
            <p className="text-muted-foreground text-xs">
              Sold without a purchase in these statements - fine if the position is already in
              Wealthfolio:{" "}
              {rec.negative.map((n) => `${n.name || n.symbol} (${fmtShares(n.quantity)} on ${n.date})`).join(", ")}
            </p>
          ) : (
            <p className="text-destructive text-xs">
              Negative holdings — rows are missing or mapped wrongly:{" "}
              {rec.negative.map((n) => `${n.name || n.symbol} (${fmtShares(n.quantity)} on ${n.date})`).join(", ")}
            </p>
          ))}
        <p className="text-muted-foreground text-xs">
          {fromPdf
            ? `Computed from these statements only. They hold trades and dividends but no deposits or withdrawals, so the cash account doesn't show your ${broker} balance.`
            : `Computed from this file only. Compare with your ${broker} app; if the file doesn't cover the full history, the balance and holdings differ.`}
        </p>
      </CardContent>
    </Card>
  );
}

function HoldingsTable({ rec }: { rec: Reconciliation }) {
  if (rec.holdings.length === 0) return <p className="text-muted-foreground p-3 text-xs">No positions.</p>;
  return (
    <div className="max-h-96 overflow-auto">
      <table className="w-full text-xs">
        <thead className="bg-background sticky top-0 border-b">
          <tr>
            {["Security", "ISIN / symbol", "Shares"].map((h) => (
              <th key={h} className="text-muted-foreground px-2 py-1.5 text-left font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rec.holdings.map((h) => (
            <tr key={h.symbol} className="border-border/50 border-b">
              <td className="px-2 py-1">{h.name || "—"}</td>
              <td className="px-2 py-1 font-mono">{h.symbol}</td>
              <td className={`px-2 py-1 text-right font-mono ${h.quantity < 0 ? "text-destructive" : ""}`}>
                {fmtShares(h.quantity)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── ActivityRow ─────────────────────────────────────────────────────────────

function ActivityRow({
  activity,
  accountName,
  included,
  existing,
  onToggleInclude,
}: {
  activity: ActivityImport;
  accountName: (id: string) => string;
  included: boolean;
  // Already in Wealthfolio from another source (matchExisting).
  existing: boolean;
  onToggleInclude: () => void;
}) {
  const status = activityStatus(activity);
  const toggle = (
    <button
      onClick={onToggleInclude}
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
        included
          ? "text-muted-foreground hover:text-foreground"
          : "bg-primary text-primary-foreground hover:bg-primary/90"
      }`}
    >
      {included ? "Skip" : "Include"}
    </button>
  );
  return (
    <tr className="border-border/50 hover:bg-muted/30 border-b">
      <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs">
        {fmtDate(String(activity.date))}
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 text-xs">{accountName(activity.accountId)}</td>
      <td className="whitespace-nowrap px-2 py-1.5">
        <span className="bg-muted rounded px-1 py-0.5 font-mono text-[10px]">
          {activity.activityType}
        </span>
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs">{activity.symbol ?? "—"}</td>
      <td className="whitespace-nowrap px-2 py-1.5 text-right text-xs">
        {displayAmount(activity)}
      </td>
      <td className="px-2 py-1.5 text-xs">
        {status === "valid" && !existing && <span className="text-muted-foreground text-[10px]">Ready</span>}
        {status === "valid" && existing && (
          <div className="flex items-center gap-1.5">
            <span
              className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
              title="The same transaction is already in Wealthfolio, imported from another source (e.g. CSV vs. PDF)"
            >
              In Wealthfolio
            </span>
            {toggle}
          </div>
        )}
        {status === "duplicate" && (
          <div className="flex items-center gap-1.5">
            <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] font-medium text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
              Duplicate
            </span>
            {toggle}
          </div>
        )}
        {status === "error" && (
          <span className="text-destructive text-[10px]" title={firstError(activity)}>
            {truncate(firstError(activity), 50)}
          </span>
        )}
      </td>
    </tr>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

type Step = "upload" | "asset-review" | "checking" | "confirm" | "importing" | "done";

export function ImportPage({ ctx }: { ctx: AddonContext }) {
  const [step, setStep] = useState<Step>("upload");
  const [settings, setSettings] = useState<AddonSettings | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const [parseResult, setParseResult] = useState<TransformResult | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [fromPdf, setFromPdf] = useState(false);
  const [reading, setReading] = useState("");
  const [format, setFormat] = useState<ImportFormat | null>(null);
  const [brokerCash, setBrokerCash] = useState<{ currency: string; amount: number } | null>(null);
  const [securities, setSecurities] = useState<SecurityInfo[]>([]);
  const [mappings, setMappings] = useState<Map<string, SecurityMapping>>(new Map());
  const [checked, setChecked] = useState<ActivityImport[] | null>(null);
  const [excludedLines, setExcludedLines] = useState<Set<number>>(new Set());
  // Lines already in Wealthfolio from another source (e.g. CSV vs. PDF), each
  // mapped to all lines of its transaction; skipped unless the user includes them.
  const [existingMatches, setExistingMatches] = useState<Map<number, number[]>>(new Map());
  const [matchError, setMatchError] = useState("");
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false);

  const [fileError, setFileError] = useState("");
  const [checkError, setCheckError] = useState("");
  const [importProgress, setImportProgress] = useState(0);
  const [importResult, setImportResult] = useState<ImportOutcome | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    Promise.all([loadSettings(ctx), ctx.api.accounts.getAll()]).then(([s, accs]) => {
      setSettings(s);
      setAccounts(accs.filter((a) => a.isActive && !a.isArchived));
    });
  }, []);

  const accountName = useCallback(
    (id: string): string => {
      if (!settings) return id;
      if (id === settings.cashAccountId) return "TR Cash";
      if (id === settings.portfolioAccountId) return "TR Portfolio";
      if (id === settings.scalableCashAccountId) return "Scalable Cash";
      if (id === settings.scalablePortfolioAccountId) return "Scalable Portfolio";
      if (id === settings.dkbCashAccountId) return "DKB Cash";
      if (id === settings.dkbPortfolioAccountId) return "DKB Portfolio";
      return accounts.find((a) => a.id === id)?.name ?? id;
    },
    [settings, accounts],
  );

  // ── Apply symbol mappings and run checkImport ─────────────────────────────

  const runCheckImport = useCallback(
    async (activities: ActivityImportEx[]) => {
      setStep("checking");
      let validated: ActivityImport[];
      try {
        validated = await ctx.api.activities.checkImport(activities);
        setCheckError("");
      } catch (e) {
        setCheckError(String(e));
        validated = activities;
      }
      // Trades and dividends already imported from another source (CSV vs. PDF)
      // aren't duplicates for checkImport; find them in the existing activities.
      let matches = new Map<number, number[]>();
      setMatchError("");
      try {
        const existing = (
          await Promise.all(accountsToMatch(validated).map((id) => ctx.api.activities.getAll(id)))
        ).flat();
        matches = matchExisting(validated, existing, groupIdsByLine(activities));
      } catch (e) {
        setMatchError(String(e));
      }
      setExistingMatches(matches);
      setExcludedLines(new Set(matches.keys()));
      setChecked(validated);
      setStep("confirm");
    },
    [ctx],
  );

  const handleMappingsComplete = useCallback(
    (resolvedMappings: Map<string, SecurityMapping>) => {
      if (!parseResult) return;
      void runCheckImport(applySecurityMappings(parseResult.activities, resolvedMappings));

      if (settings) {
        const merged = { ...settings.securityMappings };
        for (const [isin, m] of resolvedMappings) merged[isin] = m;
        const next = { ...settings, securityMappings: merged };
        setSettings(next);
        void saveSettings(ctx, next);
      }
    },
    [parseResult, runCheckImport, settings, ctx],
  );

  // ── Upload & transform ────────────────────────────────────────────────────

  // One CSV export, or any number of PDF statements of one broker.
  const readFiles = useCallback(
    async (files: File[]): Promise<{ outcome: ParseOutcome; name: string; pdf: boolean } | string> => {
      if (!settings) return "Settings are still loading.";
      const isPdf = (f: File) => f.name.toLowerCase().endsWith(".pdf");
      const isCsv = (f: File) => f.name.toLowerCase().endsWith(".csv");
      if (files.every(isPdf)) {
        setReading(`Reading ${files.length} PDF${files.length === 1 ? "" : "s"}…`);
        try {
          const data = await Promise.all(files.map(async (f) => ({ name: f.name, data: await f.arrayBuffer() })));
          const outcome = await parsePdfFiles(data, settings);
          const name = files.length === 1 ? files[0].name : `${files.length} PDF statements`;
          return { outcome, name, pdf: true };
        } finally {
          setReading("");
        }
      }
      if (files.length === 1 && isCsv(files[0])) {
        try {
          return { outcome: parseAndTransform(await files[0].text(), settings), name: files[0].name, pdf: false };
        } catch {
          return "Could not read the file.";
        }
      }
      return files.some(isCsv)
        ? "Upload one CSV export at a time, without PDFs."
        : "Please upload a .csv export (Trade Republic, Scalable Capital) or .pdf statements (Trade Republic, Scalable Capital, DKB).";
    },
    [settings],
  );

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (!settings) return;
      setFileError("");

      const read = await readFiles(files);
      if (typeof read === "string") {
        setFileError(read);
        return;
      }
      const { outcome } = read;
      if (!outcome.ok) {
        setFileError(outcome.error);
        return;
      }

      const { result } = outcome;
      setParseResult(result);
      setFormat(outcome.format);
      setBrokerCash(outcome.brokerCash ?? null);
      setFileName(read.name);
      setFromPdf(read.pdf);
      setChecked(null);
      setExcludedLines(new Set());
      setShowDuplicatesOnly(false);
      setCheckError("");

      // Collect unique securities (non-cash symbols)
      const secMap = new Map<string, SecurityInfo>();
      for (const a of result.activities) {
        if (!a.symbol || isCashSymbol(a.symbol)) continue;
        const existing = secMap.get(a.symbol);
        if (existing) {
          existing.count += 1;
          // Activities are sorted oldest first, so this keeps the most recent
          // name — exports may carry outdated names for older rows.
          if (a.symbolName) existing.name = a.symbolName;
        } else {
          secMap.set(a.symbol, { isin: a.symbol, name: a.symbolName ?? "", count: 1 });
        }
      }
      const secs = Array.from(secMap.values());
      setSecurities(secs);

      // Pre-fill mappings already resolved in a previous import, so recurring
      // securities don't need to be mapped again.
      const prefilled = new Map<string, SecurityMapping>();
      for (const s of secs) {
        const known = settings.securityMappings[s.isin];
        if (known) prefilled.set(s.isin, known);
      }
      setMappings(prefilled);

      if (secs.length === 0) {
        await runCheckImport(result.activities);
      } else if (secs.every((s) => prefilled.has(s.isin))) {
        // Every security is already known from a previous import — skip the
        // review step entirely.
        await runCheckImport(applySecurityMappings(result.activities, prefilled));
      } else {
        setStep("asset-review");
      }
    },
    [settings, readFiles, runCheckImport],
  );

  const toggleExclude = useCallback((lineNumber: number) => {
    setExcludedLines((prev) => {
      const next = new Set(prev);
      if (next.has(lineNumber)) next.delete(lineNumber);
      else next.add(lineNumber);
      return next;
    });
  }, []);

  // Skips or includes several lines together (a transaction and its legs).
  const toggleLines = useCallback((lines: number[]) => {
    setExcludedLines((prev) => {
      const next = new Set(prev);
      const allExcluded = lines.every((ln) => next.has(ln));
      for (const ln of lines) {
        if (allExcluded) next.delete(ln);
        else next.add(ln);
      }
      return next;
    });
  }, []);

  const toggleAllDuplicates = useCallback(
    (duplicates: ActivityImport[]) =>
      toggleLines(duplicates.filter((a) => a.lineNumber != null).map((a) => a.lineNumber as number)),
    [toggleLines],
  );

  // ── Import ────────────────────────────────────────────────────────────────

  const refreshPortfolio = useCallback(async () => {
    try {
      await ctx.api.portfolio.update();
      ctx.api.query.invalidateQueries([]);
    } catch {
      // non-critical
    }
  }, [ctx]);

  const handleImport = useCallback(async () => {
    if (!checked) return;
    const groupIdByLine = groupIdsByLine(parseResult?.activities ?? []);
    const { candidates, userSkipped } = selectCandidates(checked, excludedLines);

    setImportProgress(0);
    setStep("importing");
    try {
      const run = await runImport(ctx.api.activities, candidates, groupIdByLine, (done, total) =>
        setImportProgress(Math.round((done / total) * 95) + 2),
      );
      setImportProgress(100);
      setImportResult({
        total: candidates.length + userSkipped,
        imported: run.imported,
        updated: run.updated,
        userSkipped,
        failed: run.failed,
        groupIdByLine,
      });
      setStep("done");
      await refreshPortfolio();
    } catch (e) {
      setCheckError(String(e));
      setStep("confirm");
    }
  }, [checked, excludedLines, ctx, parseResult, refreshPortfolio]);

  // Sends only the activities that failed, with their original sourceGroupId.
  const retryFailed = useCallback(async () => {
    if (!importResult || importResult.failed.length === 0) return;
    setRetrying(true);
    try {
      const run = await runImport(
        ctx.api.activities,
        importResult.failed.map((f) => f.activity),
        importResult.groupIdByLine,
      );
      setImportResult({
        ...importResult,
        imported: importResult.imported + run.imported,
        updated: importResult.updated + run.updated,
        failed: run.failed,
      });
      if (run.imported > 0) await refreshPortfolio();
    } finally {
      setRetrying(false);
    }
  }, [ctx, importResult, refreshPortfolio]);

  // ── Reset ─────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    setStep("upload");
    setParseResult(null);
    setFileName("");
    setFromPdf(false);
    setFormat(null);
    setBrokerCash(null);
    setSecurities([]);
    setMappings(new Map());
    setChecked(null);
    setExcludedLines(new Set());
    setExistingMatches(new Map());
    setShowDuplicatesOnly(false);
    setFileError("");
    setCheckError("");
    setImportResult(null);
    setImportProgress(0);
  }, []);

  // Goes back to upload without wiping parse results — keeps file data intact.
  const goBackToUpload = useCallback(() => {
    setStep("upload");
    setChecked(null);
    setCheckError("");
  }, []);

  // ────────────────────────────────────────────────────────────────────────────

  // Not configured
  if (
    settings &&
    !isFormatConfigured("trade-republic", settings) &&
    !isFormatConfigured("scalable", settings) &&
    !isFormatConfigured("dkb", settings)
  ) {
    return (
      <div className="max-w-lg p-6">
        <Card>
          <CardContent className="space-y-3 p-6 text-center">
            <Icons.Settings className="text-muted-foreground mx-auto h-8 w-8" />
            <p className="font-medium">Settings not configured</p>
            <p className="text-muted-foreground text-sm">
              Please go to the <strong>Settings</strong> tab and select the Cash and Portfolio
              accounts for Trade Republic, Scalable Capital and/or DKB before importing.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Upload ───────────────────────────────────────────────────────────────

  if (step === "upload") {
    const continueToNextStep = securities.length > 0 ? "asset-review" : undefined;
    return (
      <div className="max-w-xl space-y-4 p-6">
        <div>
          <h1 className="text-2xl font-semibold">Import broker CSV or PDF statements</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            CSV: Trade Republic (Settings → Documents → Transaction history) or Scalable Capital
            (transaction export). PDF: trade and dividend statements from Trade Republic, Scalable
            Capital or DKB - select as many of one broker as you like. The broker is detected
            automatically.
          </p>
        </div>
        {parseResult && fileName ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-lg border p-4">
              <Icons.FileText className="text-muted-foreground h-8 w-8 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{fileName}</p>
                <p className="text-muted-foreground text-xs">
                  {format ? `${FORMAT_LABEL[format]} · ` : ""}
                  {parseResult.activities.length} activities parsed
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() =>
                  continueToNextStep
                    ? setStep(continueToNextStep)
                    : void runCheckImport(parseResult.activities)
                }
              >
                Continue
              </Button>
              <Button variant="outline" onClick={reset}>
                Upload different file
              </Button>
            </div>
            {fileError && <p className="text-destructive text-xs">{fileError}</p>}
          </div>
        ) : (
          <UploadZone onFiles={handleFiles} error={fileError} busy={reading} />
        )}
      </div>
    );
  }

  // ── Asset Review ─────────────────────────────────────────────────────────

  if (step === "asset-review") {
    return (
      <SecurityMappingStep
        securities={securities}
        ctx={ctx}
        mappings={mappings}
        onMappingsChange={setMappings}
        onComplete={handleMappingsComplete}
        onBack={goBackToUpload}
      />
    );
  }

  // ── Checking ─────────────────────────────────────────────────────────────

  if (step === "checking") {
    const total = parseResult?.activities.length ?? 0;
    return (
      <div className="max-w-md space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Validating…</h1>
        <Progress value={undefined} className="animate-pulse" />
        <p className="text-muted-foreground text-sm">
          Checking {total} activities for duplicates and errors…
        </p>
      </div>
    );
  }

  // ── Confirm ───────────────────────────────────────────────────────────────

  if (step === "confirm" && checked) {
    const isExcluded = (a: ActivityImport) => a.lineNumber != null && excludedLines.has(a.lineNumber);
    const isExisting = (a: ActivityImport) => a.lineNumber != null && existingMatches.has(a.lineNumber);
    const valid = checked.filter((a) => activityStatus(a) === "valid");
    const duplicates = checked.filter((a) => activityStatus(a) === "duplicate");
    const errors = checked.filter((a) => activityStatus(a) === "error");
    const existingLines = [...existingMatches.keys()];
    // Transactions (not activities) already in Wealthfolio: one per group.
    const existingCount = new Set(existingMatches.values()).size;
    const toNewCount = valid.filter((a) => !isExcluded(a)).length;
    const toUpdateCount = duplicates.filter((a) => !isExcluded(a)).length;
    const toImportCount = toNewCount + toUpdateCount;
    const unsupported = parseResult?.skipped ?? [];
    const notImported = unsupported.filter((r) => r.kind !== "netted").length;
    const nettedOut = unsupported.length - notImported;
    // Mapping as in the file (Wealthfolio symbols change only the symbol, not the
    // quantities), so ISINs are used for the holdings.
    const rec =
      parseResult && format && settings
        ? reconcile(parseResult.activities, formatAccounts(format, settings), brokerCash ?? undefined)
        : null;

    const visibleActivities = showDuplicatesOnly
      ? checked.filter((a) => activityStatus(a) === "duplicate")
      : checked;

    return (
      <div className="max-w-5xl space-y-4 p-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Review activities</h1>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {valid.filter((a) => !isExisting(a)).length} ready
              {existingCount > 0 && ` · ${existingCount} already in Wealthfolio`} · {duplicates.length} duplicates ·{" "}
              {errors.length} errors
              {notImported > 0 && ` · ${notImported} not imported`}
              {nettedOut > 0 && ` · ${nettedOut} netted out`}
            </p>
            {matchError && (
              <p className="text-destructive mt-1 text-xs">
                Could not compare with the activities already in Wealthfolio: {matchError} — check for
                double entries yourself.
              </p>
            )}
            {checkError && (
              <p className="text-destructive mt-1 text-xs">
                Validation warning: {checkError} — review manually.
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setStep(securities.length > 0 ? "asset-review" : "upload")}
            >
              Back
            </Button>
            <Button onClick={handleImport} disabled={toImportCount === 0}>
              {importButtonLabel(toNewCount, toUpdateCount)}
            </Button>
          </div>
        </div>

        {rec && format && (
          <ReconcileSummary rec={rec} broker={FORMAT_LABEL[format]} notImported={notImported} fromPdf={fromPdf} />
        )}

        {/* Already in Wealthfolio from another source */}
        {existingCount > 0 && (
          <div className="flex items-center justify-between rounded-lg bg-blue-50 px-4 py-3 text-sm dark:bg-blue-900/20">
            <span>
              <span className="font-medium">
                {existingCount} transaction{existingCount !== 1 ? "s" : ""}
              </span>{" "}
              already in Wealthfolio from another import (e.g. CSV instead of PDF) — <strong>skipped</strong>{" "}
              unless included.
            </span>
            <button
              onClick={() => toggleLines(existingLines)}
              className="bg-primary text-primary-foreground hover:bg-primary/90 ml-4 shrink-0 rounded px-2 py-1 text-xs font-medium transition-colors"
            >
              {existingLines.every((ln) => excludedLines.has(ln)) ? "Include all" : "Skip all"}
            </button>
          </div>
        )}

        {/* Duplicate banner */}
        {duplicates.length > 0 && (
          <div className="bg-muted flex items-center justify-between rounded-lg px-4 py-3 text-sm">
            <span>
              <span className="font-medium">{duplicates.length} duplicate</span>
              {duplicates.length !== 1 ? "s" : ""} already exist in Wealthfolio — will be{" "}
              <strong>updated</strong> unless skipped.
            </span>
            <button
              onClick={() => toggleAllDuplicates(duplicates)}
              className="bg-primary text-primary-foreground hover:bg-primary/90 ml-4 shrink-0 rounded px-2 py-1 text-xs font-medium transition-colors"
            >
              {duplicates.every((a) => a.lineNumber != null && excludedLines.has(a.lineNumber))
                ? "Include all"
                : "Skip all"}
            </button>
          </div>
        )}

        {/* Activities + Unsupported tabs */}
        <Card>
          <CardContent className="p-0">
            <Tabs defaultValue="activities">
              <div className="flex items-center justify-between px-3 pt-3">
                <TabsList>
                  <TabsTrigger value="activities">Activities ({checked.length})</TabsTrigger>
                  <TabsTrigger value="unsupported">Skipped ({unsupported.length})</TabsTrigger>
                  {rec && <TabsTrigger value="holdings">Holdings ({rec.holdings.length})</TabsTrigger>}
                </TabsList>
                {duplicates.length > 0 && (
                  <button
                    onClick={() => setShowDuplicatesOnly((v) => !v)}
                    className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                      showDuplicatesOnly
                        ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {showDuplicatesOnly
                      ? `Showing duplicates only (${duplicates.length})`
                      : `Show duplicates only (${duplicates.length})`}
                  </button>
                )}
              </div>

              <TabsContent value="activities" className="mt-0">
                <div className="max-h-[500px] overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-background sticky top-0 border-b">
                      <tr>
                        {["Date", "Account", "Type", "Symbol", "Amount", "Status"].map((h) => (
                          <th
                            key={h}
                            className="text-muted-foreground whitespace-nowrap px-2 py-1.5 text-left font-medium"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleActivities.map((a, i) => (
                        <ActivityRow
                          key={i}
                          activity={a}
                          accountName={accountName}
                          included={!isExcluded(a)}
                          existing={isExisting(a)}
                          onToggleInclude={() => {
                            if (a.lineNumber == null) return;
                            const group = existingMatches.get(a.lineNumber);
                            if (group) toggleLines(group);
                            else toggleExclude(a.lineNumber);
                          }}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </TabsContent>

              <TabsContent value="unsupported" className="mt-0">
                <SkippedTable rows={unsupported} />
              </TabsContent>
              {rec && (
                <TabsContent value="holdings" className="mt-0">
                  <HoldingsTable rec={rec} />
                </TabsContent>
              )}
            </Tabs>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Importing ─────────────────────────────────────────────────────────────

  if (step === "importing") {
    return (
      <div className="max-w-md space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Importing…</h1>
        <Progress value={importProgress} />
        <p className="text-muted-foreground text-sm">Saving activities to Wealthfolio…</p>
      </div>
    );
  }

  // ── Done ─────────────────────────────────────────────────────────────────

  if (step === "done" && importResult) {
    const { total, imported, updated, userSkipped, failed } = importResult;
    const created = imported - updated;
    const ok = failed.length === 0;

    return (
      <div className="max-w-4xl space-y-4 p-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          {ok ? (
            <Icons.CheckCircle className="h-8 w-8 shrink-0 text-green-600" />
          ) : (
            <Icons.AlertCircle className="text-destructive h-8 w-8 shrink-0" />
          )}
          <div>
            <h1 className="text-2xl font-semibold">{ok ? "Import complete" : "Import finished with issues"}</h1>
            <p className="text-muted-foreground text-sm">
              {created} new {created === 1 ? "activity" : "activities"} imported
              {updated > 0 && `, ${updated} existing updated`}.
            </p>
          </div>
        </div>

        {/* Summary tiles */}
        <div className="grid grid-cols-5 gap-3">
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold">{total}</p>
              <p className="text-muted-foreground mt-0.5 text-xs">Total</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{created}</p>
              <p className="text-muted-foreground mt-0.5 text-xs">New</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold">{updated}</p>
              <p className="text-muted-foreground mt-0.5 text-xs">Updated</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-muted-foreground text-2xl font-bold">{userSkipped}</p>
              <p className="text-muted-foreground mt-0.5 text-xs">Skipped</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className={`text-2xl font-bold ${ok ? "text-muted-foreground" : "text-destructive"}`}>{failed.length}</p>
              <p className="text-muted-foreground mt-0.5 text-xs">Failed</p>
            </CardContent>
          </Card>
        </div>

        {!ok && (
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm">
                  {failed.length} activit{failed.length === 1 ? "y" : "ies"} could not be saved. Wealthfolio's reason is
                  shown per row; fix the cause (e.g. the security mapping) and retry, or add them manually.
                </p>
                <Button onClick={() => void retryFailed()} disabled={retrying} className="shrink-0">
                  {retrying ? "Retrying…" : `Retry ${failed.length} failed`}
                </Button>
              </div>
              <FailedTable failed={failed} accountName={accountName} />
              <details>
                <summary className="text-muted-foreground cursor-pointer text-xs">Copy as CSV</summary>
                <textarea
                  readOnly
                  className="bg-muted mt-2 h-32 w-full rounded p-2 font-mono text-xs"
                  value={failedAsCsv(failed, accountName)}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </details>
            </CardContent>
          </Card>
        )}

        <Button variant="outline" onClick={reset}>
          Import another file
        </Button>
      </div>
    );
  }

  return null;
}
