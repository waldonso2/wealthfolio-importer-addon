// The wizard's review page: what will be imported, what is already there, what the file leaves out (#78).
import type { ActivityImport } from "@wealthfolio/addon-sdk";
import { Button, Card, CardContent, Icons, Tabs, TabsContent, TabsList, TabsTrigger } from "@wealthfolio/ui";
import { FORMAT_LABEL } from "../formats";
import { activityStatus, importButtonLabel } from "../importer";
import { rich, useT } from "../i18n";
import { reconcile } from "../reconcile";
import { mappingWarning } from "../remap";
import type { SecurityInfo } from "../SecurityMappingStep";
import type { BrokerAccounts } from "../types";
import type { Action, WizardState } from "../wizard";
import { ActivityRow, HoldingsTable, ReconcileSummary, SkippedTable, TableHead } from "./parts";

export function ConfirmStep({
  state,
  accounts,
  accountName,
  dispatch,
  onImport,
}: {
  state: WizardState;
  // The broker's account pair, for the reconciliation.
  accounts: BrokerAccounts;
  accountName: (id: string) => string;
  dispatch: (action: Action) => void;
  onImport: () => void;
}) {
  const { t } = useT();
  const { parsed, checked, excluded, existing, duplicatesOnly, securities, mappings, matchError, checkError } = state;
  if (!parsed || !checked) return null;
  const toggleLines = (lines: number[]) => dispatch({ type: "toggleLines", lines });
  const isExcluded = (a: ActivityImport) => a.lineNumber != null && excluded.has(a.lineNumber);
  const isExisting = (a: ActivityImport) => a.lineNumber != null && existing.has(a.lineNumber);
  const valid = checked.filter((a) => activityStatus(a) === "valid");
  const duplicates = checked.filter((a) => activityStatus(a) === "duplicate");
  const errors = checked.filter((a) => activityStatus(a) === "error");
  const existingLines = [...existing.keys()];
  // Transactions (not activities) already in Wealthfolio: one per group.
  const existingCount = new Set(existing.values()).size;
  const toNewCount = valid.filter((a) => !isExcluded(a)).length;
  const toUpdateCount = duplicates.filter((a) => !isExcluded(a)).length;
  const toImportCount = toNewCount + toUpdateCount;
  const unsupported = parsed.result.skipped ?? [];
  const notImported = unsupported.filter((r) => r.kind !== "netted").length;
  const nettedOut = unsupported.length - notImported;
  // Mapping as in the file (Wealthfolio symbols change only the symbol, not the
  // quantities), so ISINs are used for the holdings.
  const rec = reconcile(parsed.result.activities, accounts, parsed.brokerCash ?? undefined);

  const suspicious = securities
    .map((s) => ({ s, warning: mappingWarning(s.isin, s.name, mappings.get(s.isin), t) }))
    .filter((x): x is { s: SecurityInfo; warning: string } => !!x.warning);

  const visibleActivities = duplicatesOnly
    ? checked.filter((a) => activityStatus(a) === "duplicate")
    : checked;

  return (
    <div className="max-w-5xl space-y-4 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("review.title")}</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {[
              t("review.ready", { count: valid.filter((a) => !isExisting(a)).length }),
              existingCount > 0 && t("review.alreadyIn", { count: existingCount }),
              t("review.duplicates", { count: duplicates.length }),
              t("review.errors", { count: errors.length }),
              notImported > 0 && t("review.notImported", { count: notImported }),
              nettedOut > 0 && t("review.netted", { count: nettedOut }),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {matchError && <p className="text-destructive mt-1 text-xs">{t("review.matchError", { error: matchError })}</p>}
          {checkError && <p className="text-destructive mt-1 text-xs">{t("review.checkError", { error: checkError })}</p>}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => dispatch({ type: "backFromReview" })}
          >
            {t("common.back")}
          </Button>
          <Button onClick={onImport} disabled={toImportCount === 0}>
            {importButtonLabel(toNewCount, toUpdateCount, t)}
          </Button>
        </div>
      </div>

      <ReconcileSummary rec={rec} broker={FORMAT_LABEL[parsed.format]} notImported={notImported} fromPdf={parsed.fromPdf} />

      {/* Already in Wealthfolio from another source */}
      {existingCount > 0 && (
        <div className="flex items-center justify-between rounded-lg bg-blue-50 px-4 py-3 text-sm dark:bg-blue-900/20">
          <span>{rich(t("review.existingBanner", { count: existingCount }))}</span>
          <button
            onClick={() => toggleLines(existingLines)}
            className="bg-primary text-primary-foreground hover:bg-primary/90 ml-4 shrink-0 rounded px-2 py-1 text-xs font-medium transition-colors"
          >
            {existingLines.every((ln) => excluded.has(ln)) ? t("common.includeAll") : t("common.skipAll")}
          </button>
        </div>
      )}

      {/* Mappings that look wrong (#41) */}
      {suspicious.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200">
          <p className="flex items-center gap-1.5 font-medium">
            <Icons.AlertTriangle className="h-4 w-4" />
            {t("review.suspicious", { count: suspicious.length })}
          </p>
          <ul className="mt-1 list-inside list-disc text-xs">
            {suspicious.map(({ s, warning }) => (
              <li key={s.isin}>
                <span className="font-mono">{s.isin}</span> {s.name}: {warning}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs">{t("review.suspiciousText")}</p>
        </div>
      )}

      {/* Duplicate banner */}
      {duplicates.length > 0 && (
        <div className="bg-muted flex items-center justify-between rounded-lg px-4 py-3 text-sm">
          <span>{rich(t("review.duplicateBanner", { count: duplicates.length }))}</span>
          <button
            onClick={() => toggleLines(duplicates.filter((a) => a.lineNumber != null).map((a) => a.lineNumber as number))}
            className="bg-primary text-primary-foreground hover:bg-primary/90 ml-4 shrink-0 rounded px-2 py-1 text-xs font-medium transition-colors"
          >
            {duplicates.every((a) => a.lineNumber != null && excluded.has(a.lineNumber))
              ? t("common.includeAll")
              : t("common.skipAll")}
          </button>
        </div>
      )}

      {/* Activities + Unsupported tabs */}
      <Card>
        <CardContent className="p-0">
          <Tabs defaultValue="activities">
            <div className="flex items-center justify-between px-3 pt-3">
              <TabsList>
                <TabsTrigger value="activities">{t("review.tabActivities", { count: checked.length })}</TabsTrigger>
                <TabsTrigger value="unsupported">{t("review.tabSkipped", { count: unsupported.length })}</TabsTrigger>
                <TabsTrigger value="holdings">{t("review.tabHoldings", { count: rec.holdings.length })}</TabsTrigger>
              </TabsList>
              {duplicates.length > 0 && (
                <button
                  onClick={() => dispatch({ type: "toggleDuplicatesOnly" })}
                  className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                    duplicatesOnly
                      ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t(duplicatesOnly ? "review.showingDuplicates" : "review.showDuplicates", {
                    count: duplicates.length,
                  })}
                </button>
              )}
            </div>

            <TabsContent value="activities" className="mt-0">
              <div className="max-h-[500px] overflow-auto">
                <table className="w-full text-xs">
                  <TableHead
                    columns={["col.date", "col.account", "col.type", "col.symbol", "col.amount", "col.status"]}
                    t={t}
                  />
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
                          toggleLines(existing.get(a.lineNumber) ?? [a.lineNumber]);
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
            <TabsContent value="holdings" className="mt-0">
              <HoldingsTable rec={rec} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
