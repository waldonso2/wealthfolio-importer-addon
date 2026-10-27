import { useCallback, useEffect, useReducer, useState } from "react";
import type { Account, ActivityImport, AddonContext } from "@wealthfolio/addon-sdk";
import { Card, CardContent, Icons, Progress } from "@wealthfolio/ui";
import { loadSettings, saveSettings } from "./settings";
import { SecurityMappingStep } from "./SecurityMappingStep";
import type { SecurityMapping } from "./SecurityMappingStep";
import { configuredAccount, FORMAT_LABEL, FORMATS, formatAccounts, isFormatConfigured, parseAndTransform } from "./formats";
import {
  accountsToMatch,
  applySecurityMappings,
  groupIdsByLine,
  keepExternal,
  matchExisting,
  runImport,
  selectCandidates,
} from "./importer";
import { rich, useT, type Params, type T } from "./i18n";
import { parsePdfFiles } from "./pdf";
import { rememberNames } from "./remap";
import type { ActivityImportEx, AddonSettings } from "./types";
import { INITIAL, securitiesOf, wizard, type Parsed, type UiText } from "./wizard";
import { ConfirmStep } from "./import/ConfirmStep";
import { DoneStep } from "./import/DoneStep";
import { UploadStep } from "./import/UploadStep";

// The import wizard (#78): its state is the reducer in wizard.ts, each step a page in src/import/. This
// component loads the settings, runs the async work (reading, Wealthfolio's check, the import) and dispatches
// what happened.

const uiText = (t: T, key: string, params?: Params): UiText => ({ text: t(key, params), key, params });

export function ImportPage({ ctx }: { ctx: AddonContext }) {
  const { t } = useT();
  const [state, dispatch] = useReducer(wizard, INITIAL);
  const [settings, setSettings] = useState<AddonSettings | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    Promise.all([loadSettings(ctx), ctx.api.accounts.getAll()]).then(([s, accs]) => {
      setSettings(s);
      setAccounts(accs.filter((a) => a.isActive && !a.isArchived));
    });
  }, [ctx]);

  const remember = useCallback(
    (next: AddonSettings) => {
      setSettings(next);
      void saveSettings(ctx, next);
    },
    [ctx],
  );

  // The Wealthfolio account's own name; a generic label only when it is unknown.
  const accountName = useCallback(
    (id: string): string => {
      const account = accounts.find((a) => a.id === id);
      if (account) return account.name;
      const configured = settings && id ? configuredAccount(settings, id) : null;
      if (configured) return t(`account.${configured.side}`, { broker: FORMAT_LABEL[configured.broker] });
      return id;
    },
    [settings, accounts, t],
  );

  // Wealthfolio's check, then the activities already there from another source (CSV vs. PDF): checkImport
  // doesn't count those as duplicates.
  const runCheckImport = useCallback(
    async (activities: ActivityImportEx[]) => {
      dispatch({ type: "checking" });
      let validated: ActivityImport[];
      let checkError = "";
      try {
        validated = keepExternal(await ctx.api.activities.checkImport(activities), activities);
      } catch (e) {
        checkError = String(e);
        validated = activities;
      }
      let existing = new Map<number, number[]>();
      let matchError = "";
      try {
        const listed = (await Promise.all(accountsToMatch(validated).map((id) => ctx.api.activities.getAll(id)))).flat();
        existing = matchExisting(validated, listed, groupIdsByLine(activities));
      } catch (e) {
        matchError = String(e);
      }
      dispatch({ type: "checked", checked: validated, existing, checkError, matchError });
    },
    [ctx],
  );

  const handleMappingsComplete = useCallback(
    (resolved: Map<string, SecurityMapping>) => {
      if (!state.parsed) return;
      void runCheckImport(applySecurityMappings(state.parsed.result.activities, resolved));
      if (settings) {
        const merged = { ...settings.securityMappings };
        for (const [isin, m] of resolved) merged[isin] = m;
        remember({ ...settings, securityMappings: merged, securityNames: rememberNames(settings, state.securities) });
      }
    },
    [state.parsed, state.securities, runCheckImport, settings, remember],
  );

  // One CSV export, or any number of PDF statements of one broker.
  const readFiles = useCallback(
    async (files: File[]): Promise<Parsed | UiText> => {
      if (!settings) return uiText(t, "upload.settingsLoading");
      const isPdf = (f: File) => f.name.toLowerCase().endsWith(".pdf");
      const isCsv = (f: File) => f.name.toLowerCase().endsWith(".csv");
      let outcome;
      let fileName = files[0]?.name ?? "";
      if (files.every(isPdf)) {
        dispatch({ type: "reading", text: t("upload.reading", { count: files.length }) });
        try {
          const data = await Promise.all(files.map(async (f) => ({ name: f.name, data: await f.arrayBuffer() })));
          outcome = await parsePdfFiles(data, settings);
          if (files.length > 1) fileName = t("upload.pdfStatements", { count: files.length });
        } finally {
          dispatch({ type: "reading", text: "" });
        }
      } else if (files.length === 1 && isCsv(files[0])) {
        try {
          outcome = parseAndTransform(await files[0].text(), settings);
        } catch {
          return uiText(t, "upload.unreadable");
        }
      } else {
        return uiText(t, files.some(isCsv) ? "upload.oneCsv" : "upload.wrongType");
      }
      if (!outcome.ok) return { text: outcome.error, key: outcome.errorKey, params: outcome.errorParams };
      return {
        result: outcome.result,
        format: outcome.format,
        brokerCash: outcome.brokerCash ?? null,
        fileName,
        fromPdf: files.every(isPdf),
      };
    },
    [settings, t],
  );

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (!settings) return;
      dispatch({ type: "fileError", error: null });
      const read = await readFiles(files);
      if (!("result" in read)) {
        dispatch({ type: "fileError", error: read });
        return;
      }
      const securities = securitiesOf(read.result);
      // Mappings resolved in a previous import, so recurring securities don't need to be mapped again.
      const known = new Map<string, SecurityMapping>();
      for (const s of securities) {
        const m = settings.securityMappings[s.isin];
        if (m) known.set(s.isin, m);
      }
      dispatch({ type: "parsed", parsed: read, securities, mappings: known });
      if (securities.length === 0) {
        await runCheckImport(read.result.activities);
      } else if (securities.every((s) => known.has(s.isin))) {
        // Every security is known from a previous import: no review step.
        const names = rememberNames(settings, securities);
        if (JSON.stringify(names) !== JSON.stringify(settings.securityNames)) remember({ ...settings, securityNames: names });
        await runCheckImport(applySecurityMappings(read.result.activities, known));
      } else {
        dispatch({ type: "review" });
      }
    },
    [settings, readFiles, runCheckImport, remember],
  );

  const refreshPortfolio = useCallback(async () => {
    try {
      await ctx.api.portfolio.update();
      ctx.api.query.invalidateQueries([]);
    } catch {
      // non-critical
    }
  }, [ctx]);

  const handleImport = useCallback(async () => {
    if (!state.checked) return;
    const groupIdByLine = groupIdsByLine(state.parsed?.result.activities ?? []);
    const { candidates, userSkipped } = selectCandidates(state.checked, state.excluded);
    dispatch({ type: "importing" });
    try {
      const run = await runImport(ctx.api.activities, candidates, groupIdByLine, (done, total) =>
        dispatch({ type: "progress", value: Math.round((done / total) * 95) + 2 }),
      );
      dispatch({
        type: "imported",
        outcome: { total: candidates.length + userSkipped, ...run, userSkipped, groupIdByLine },
      });
      await refreshPortfolio();
    } catch (e) {
      dispatch({ type: "importFailed", error: String(e) });
    }
  }, [state.checked, state.excluded, state.parsed, ctx, refreshPortfolio]);

  // Sends only the activities that failed, with their original sourceGroupId.
  const retryFailed = useCallback(async () => {
    const outcome = state.outcome;
    if (!outcome || outcome.failed.length === 0) return;
    dispatch({ type: "retrying" });
    let next = null;
    try {
      const run = await runImport(ctx.api.activities, outcome.failed.map((f) => f.activity), outcome.groupIdByLine);
      next = {
        ...outcome,
        imported: outcome.imported + run.imported,
        updated: outcome.updated + run.updated,
        failed: run.failed,
      };
      if (run.imported > 0) await refreshPortfolio();
    } finally {
      dispatch({ type: "retried", outcome: next });
    }
  }, [ctx, state.outcome, refreshPortfolio]);

  if (settings && !FORMATS.some((f) => isFormatConfigured(f, settings))) {
    return (
      <div className="max-w-lg p-6">
        <Card>
          <CardContent className="space-y-3 p-6 text-center">
            <Icons.Settings className="text-muted-foreground mx-auto h-8 w-8" />
            <p className="font-medium">{t("notConfigured.title")}</p>
            <p className="text-muted-foreground text-sm">{rich(t("notConfigured.text"))}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  switch (state.step) {
    case "upload":
      return (
        <UploadStep
          state={state}
          onFiles={handleFiles}
          onContinue={() =>
            state.securities.length > 0
              ? dispatch({ type: "review" })
              : state.parsed && void runCheckImport(state.parsed.result.activities)
          }
          onOtherFile={() => dispatch({ type: "reset" })}
        />
      );
    case "asset-review":
      return (
        <SecurityMappingStep
          securities={state.securities}
          ctx={ctx}
          mappings={state.mappings}
          onMappingsChange={(mappings) => dispatch({ type: "mappings", mappings })}
          onComplete={handleMappingsComplete}
          onBack={() => dispatch({ type: "backToUpload" })}
        />
      );
    case "checking":
    case "importing": {
      const checking = state.step === "checking";
      return (
        <div className="max-w-md space-y-4 p-6">
          <h1 className="text-2xl font-semibold">{t(checking ? "checking.title" : "importing.title")}</h1>
          {checking ? <Progress value={null} className="animate-pulse" /> : <Progress value={state.progress} />}
          <p className="text-muted-foreground text-sm">
            {checking ? t("checking.text", { count: state.parsed?.result.activities.length ?? 0 }) : t("importing.text")}
          </p>
        </div>
      );
    }
    case "confirm":
      return state.parsed && settings ? (
        <ConfirmStep
          state={state}
          accounts={formatAccounts(state.parsed.format, settings)}
          accountName={accountName}
          dispatch={dispatch}
          onImport={handleImport}
        />
      ) : null;
    case "done":
      return state.outcome ? (
        <DoneStep
          outcome={state.outcome}
          retrying={state.retrying}
          accountName={accountName}
          onRetry={() => void retryFailed()}
          onAnother={() => dispatch({ type: "reset" })}
        />
      ) : null;
  }
}
