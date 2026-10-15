// The pieces of the import wizard's pages (#78): tables, the reconciliation summary, an activity's row.
import type { ActivityImport } from "@wealthfolio/addon-sdk";
import { Card, CardContent } from "@wealthfolio/ui";
import { isCashSymbol } from "../common";
import { activityStatus, firstError, type FailedActivity } from "../importer";
import { textOf, useT, type T } from "../i18n";
import { cashDifference, type Reconciliation } from "../reconcile";
import type { SkippedRow } from "../types";

// ─── helpers ────────────────────────────────────────────────────────────────

export function fmtDate(iso: string): string {
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

// ─── SkippedTable ────────────────────────────────────────────────────────────

// Rows Wealthfolio will be missing come first; rows that were netted out on
// purpose need no action.
const SKIP_STATUS: Record<NonNullable<SkippedRow["kind"]>, { label: string; className: string }> = {
  missing: { label: "skipped.missing", className: "text-destructive font-medium" },
  netted: { label: "skipped.netted", className: "text-muted-foreground" },
};

// Column headers: translation keys.
export function TableHead({ columns, t }: { columns: string[]; t: T }) {
  return (
    <thead className="bg-background sticky top-0 border-b">
      <tr>
        {columns.map((h) => (
          <th key={h} className="text-muted-foreground whitespace-nowrap px-2 py-1.5 text-left font-medium">
            {t(h)}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export function SkippedTable({ rows }: { rows: SkippedRow[] }) {
  const { t } = useT();
  if (rows.length === 0)
    return <p className="text-muted-foreground p-3 text-xs">{t("skipped.none")}</p>;
  const ordered = [...rows].sort((a, b) => Number(a.kind === "netted") - Number(b.kind === "netted"));
  return (
    <div className="max-h-96 overflow-auto">
      <table className="w-full text-xs">
        <TableHead columns={["col.date", "col.type", "col.description", "col.status", "col.reason"]} t={t} />
        <tbody>
          {ordered.map((r, i) => (
            <tr key={i} className="border-border/50 border-b align-top">
              <td className="whitespace-nowrap px-2 py-1 font-mono">{fmtDate(r.datetime)}</td>
              <td className="whitespace-nowrap px-2 py-1 font-mono">{textOf(t, r.type, r.typeKey, r.params)}</td>
              <td className="text-muted-foreground px-2 py-1">{truncate(r.description, 80)}</td>
              <td className={`whitespace-nowrap px-2 py-1 ${r.kind ? SKIP_STATUS[r.kind].className : "text-muted-foreground"}`}>
                {r.kind ? t(SKIP_STATUS[r.kind].label) : "—"}
              </td>
              <td className="px-2 py-1">
                <span className="text-muted-foreground">{textOf(t, r.reason, r.reasonKey, r.params)}</span>
                {r.hint && <span className="mt-0.5 block">{textOf(t, r.hint, r.hintKey, r.params)}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FailedTable({ failed, accountName }: { failed: FailedActivity[]; accountName: (id: string) => string }) {
  const { t } = useT();
  return (
    <div className="max-h-96 overflow-auto">
      <table className="w-full text-xs">
        <TableHead columns={["col.date", "col.account", "col.type", "col.symbol", "col.amount", "col.error"]} t={t} />
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
export function ReconcileSummary({
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
  const { t } = useT();
  const diff = cashDifference(rec);
  const negativeList = rec.negative
    .map((n) => t("reconcile.negativeItem", { name: n.name || n.symbol, shares: fmtShares(n.quantity), date: n.date }))
    .join(", ");
  const cashEntries = Object.entries(rec.cash);
  const leftover = Object.entries(rec.portfolioCash);
  const ok = "text-green-700 dark:text-green-400";
  return (
    <Card>
      <CardContent className="space-y-2 p-4 text-sm">
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          <div>
            <p className="text-muted-foreground text-xs">
              {fromPdf ? t("reconcile.cashChangePdf") : t("reconcile.cashAfter")}
            </p>
            <p className="font-medium">
              {cashEntries.length === 0 ? "0.00" : cashEntries.map(([c, v]) => fmtMoney(v, c)).join(" · ")}
            </p>
            {rec.brokerCash &&
              (diff === 0 ? (
                <p className={`text-xs ${ok}`}>{t("reconcile.matches", { broker })}</p>
              ) : (
                <p className="text-destructive text-xs">
                  {t("reconcile.differs", {
                    broker,
                    balance: fmtMoney(rec.brokerCash.amount, rec.brokerCash.currency),
                    diff: fmtMoney(diff, rec.brokerCash.currency),
                  })}
                  {notImported > 0 && ` ${t("reconcile.differsNotImported", { count: notImported })}`}
                </p>
              ))}
          </div>
          <div>
            <p className="text-muted-foreground text-xs">{t("reconcile.leftover")}</p>
            {leftover.length === 0 ? (
              <p className={`font-medium ${ok}`}>{t("reconcile.leftoverNone")}</p>
            ) : (
              <p className="text-destructive font-medium">
                {t("reconcile.shouldBeZero", { amounts: leftover.map(([c, v]) => fmtMoney(v, c)).join(" · ") })}
              </p>
            )}
          </div>
          <div>
            <p className="text-muted-foreground text-xs">{t("reconcile.positions")}</p>
            <p className="font-medium">{t("reconcile.positionsCount", { count: rec.holdings.length })}</p>
          </div>
        </div>
        {rec.negative.length > 0 &&
          (fromPdf ? (
            <p className="text-muted-foreground text-xs">{t("reconcile.soldWithoutPurchase", { list: negativeList })}</p>
          ) : (
            <p className="text-destructive text-xs">{t("reconcile.negative", { list: negativeList })}</p>
          ))}
        <p className="text-muted-foreground text-xs">
          {t(fromPdf ? "reconcile.footPdf" : "reconcile.footCsv", { broker })}
        </p>
      </CardContent>
    </Card>
  );
}

export function HoldingsTable({ rec }: { rec: Reconciliation }) {
  const { t } = useT();
  if (rec.holdings.length === 0) return <p className="text-muted-foreground p-3 text-xs">{t("reconcile.noPositions")}</p>;
  return (
    <div className="max-h-96 overflow-auto">
      <table className="w-full text-xs">
        <TableHead columns={["col.security", "col.isinSymbol", "col.shares"]} t={t} />
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

export function ActivityRow({
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
  const { t } = useT();
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
      {included ? t("common.skip") : t("common.include")}
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
        {status === "valid" && !existing && <span className="text-muted-foreground text-[10px]">{t("review.statusReady")}</span>}
        {status === "valid" && existing && (
          <div className="flex items-center gap-1.5">
            <span
              className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
              title={t("review.statusExistingTitle")}
            >
              {t("review.statusExisting")}
            </span>
            {toggle}
          </div>
        )}
        {status === "duplicate" && (
          <div className="flex items-center gap-1.5">
            <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] font-medium text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
              {t("review.statusDuplicate")}
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
