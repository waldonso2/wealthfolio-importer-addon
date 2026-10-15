// The wizard's last page: what the import did, the activities that failed and a retry (#11, #78).
import { Button, Card, CardContent, Icons } from "@wealthfolio/ui";
import { failedAsCsv } from "../importer";
import { useT } from "../i18n";
import type { ImportOutcome } from "../wizard";
import { FailedTable } from "./parts";

export function DoneStep({
  outcome,
  retrying,
  accountName,
  onRetry,
  onAnother,
}: {
  outcome: ImportOutcome;
  retrying: boolean;
  accountName: (id: string) => string;
  onRetry: () => void;
  onAnother: () => void;
}) {
  const { t } = useT();
  const { total, imported, updated, userSkipped, failed } = outcome;
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
          <h1 className="text-2xl font-semibold">{ok ? t("done.complete") : t("done.issues")}</h1>
          <p className="text-muted-foreground text-sm">
            {t("done.created", { count: created })}
            {updated > 0 && t("done.updated", { count: updated })}.
          </p>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{total}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">{t("done.total")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{created}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">{t("done.new")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{updated}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">{t("done.updatedTile")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-muted-foreground text-2xl font-bold">{userSkipped}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">{t("done.skipped")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className={`text-2xl font-bold ${ok ? "text-muted-foreground" : "text-destructive"}`}>{failed.length}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">{t("done.failed")}</p>
          </CardContent>
        </Card>
      </div>

      {!ok && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm">{t("done.failedText", { count: failed.length })}</p>
              <Button onClick={onRetry} disabled={retrying} className="shrink-0">
                {retrying ? t("done.retrying") : t("done.retry", { count: failed.length })}
              </Button>
            </div>
            <FailedTable failed={failed} accountName={accountName} />
            <details>
              <summary className="text-muted-foreground cursor-pointer text-xs">{t("done.copyCsv")}</summary>
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

      <Button variant="outline" onClick={onAnother}>
        {t("done.another")}
      </Button>
    </div>
  );
}
