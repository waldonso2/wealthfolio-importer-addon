import React, { useEffect, useState } from "react";
import type { Account, AddonContext } from "@wealthfolio/addon-sdk";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Icons,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
} from "@wealthfolio/ui";
import { rich, useT } from "./i18n";
import { RemapPanel } from "./RemapPanel";
import { mappingLabel, mappingWarning } from "./remap";
import { loadSettings, saveSettings } from "./settings";
import type { AddonSettings, SecurityMapping, TransferPattern } from "./types";

function AccountSelect({
  accounts,
  value,
  onChange,
  placeholder,
  filterType,
}: {
  accounts: Account[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  filterType?: Account["accountType"];
}) {
  const filtered = filterType ? accounts.filter((a) => a.accountType === filterType) : accounts;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {filtered.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.name} <span className="text-muted-foreground">({a.currency})</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PatternRow({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-2">
      {children}
      <Button type="button" variant="ghost" size="icon" onClick={onRemove} className="shrink-0">
        <Icons.Trash className="text-muted-foreground h-4 w-4" />
      </Button>
    </div>
  );
}

export function SettingsPage({ ctx }: { ctx: AddonContext }) {
  const { t } = useT();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [settings, setSettings] = useState<AddonSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  // ISIN whose mapping is being changed (#41).
  const [remapping, setRemapping] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([ctx.api.accounts.getAll(), loadSettings(ctx)]).then(([accs, s]) => {
      setAccounts(accs.filter((a) => a.isActive && !a.isArchived));
      setSettings(s);
    });
  }, [ctx]);

  if (!settings) {
    return <div className="text-muted-foreground p-6 text-sm">{t("settings.loading")}</div>;
  }

  const set = (patch: Partial<AddonSettings>) => {
    setSaved(false);
    setSettings((s) => ({ ...s!, ...patch }));
  };

  const updatePattern = (i: number, patch: Partial<TransferPattern>) =>
    set({
      transferPatterns: settings.transferPatterns.map((p, idx) =>
        idx === i ? { ...p, ...patch } : p,
      ),
    });

  const removePattern = (i: number) =>
    set({ transferPatterns: settings.transferPatterns.filter((_, idx) => idx !== i) });

  const addPattern = () => set({ transferPatterns: [...settings.transferPatterns, { label: "" }] });

  const removeSecurityMapping = (isin: string) => {
    const { [isin]: _removed, ...rest } = settings.securityMappings;
    set({ securityMappings: rest });
  };

  const clearAllSecurityMappings = () => set({ securityMappings: {} });

  // A changed mapping is saved at once (activities may have been moved to it),
  // on top of the stored settings so unsaved edits elsewhere on the page stay unsaved.
  const saveMapping = async (isin: string, mapping: SecurityMapping) => {
    const stored = await loadSettings(ctx);
    await saveSettings(ctx, { ...stored, securityMappings: { ...stored.securityMappings, [isin]: mapping } });
    setSettings((s) => ({ ...s!, securityMappings: { ...s!.securityMappings, [isin]: mapping } }));
  };

  const securitiesAccounts = [
    settings.portfolioAccountId,
    settings.scalablePortfolioAccountId,
    settings.dkbPortfolioAccountId,
  ].filter(Boolean);
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;

  const handleSave = async () => {
    const tr = [settings.cashAccountId, settings.portfolioAccountId];
    const sc = [settings.scalableCashAccountId, settings.scalablePortfolioAccountId];
    const dkb = [settings.dkbCashAccountId, settings.dkbPortfolioAccountId];
    const complete = (pair: string[]) => pair.every(Boolean);
    const partial = (pair: string[]) => pair.some(Boolean) && !complete(pair);
    if ([tr, sc, dkb].some(partial) || ![tr, sc, dkb].some(complete)) {
      setError(t("settings.incomplete"));
      return;
    }
    setError("");
    setSaving(true);
    try {
      await saveSettings(ctx, settings);
      setSaved(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const noDestOption = "—";

  return (
    <div className="max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t("settings.intro")}</p>
      </div>

      {/* Accounts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.tr.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-xs">{t("settings.tr.intro")}</p>
          <div className="space-y-1">
            <Label>{t("settings.tr.cash")}</Label>
            <AccountSelect
              accounts={accounts}
              value={settings.cashAccountId}
              onChange={(v) => {
                const acc = accounts.find((a) => a.id === v);
                set({ cashAccountId: v, cashCurrency: acc?.currency ?? "EUR" });
              }}
              placeholder={t("settings.selectCash")}
              filterType="CASH"
            />
            <p className="text-muted-foreground text-xs">{t("settings.tr.cashHelp")}</p>
          </div>
          <div className="space-y-1">
            <Label>{t("settings.tr.securities")}</Label>
            <AccountSelect
              accounts={accounts}
              value={settings.portfolioAccountId}
              onChange={(v) => set({ portfolioAccountId: v })}
              placeholder={t("settings.selectSecurities")}
              filterType="SECURITIES"
            />
            <p className="text-muted-foreground text-xs">{t("settings.tr.securitiesHelp")}</p>
          </div>
        </CardContent>
      </Card>

      {/* Scalable Capital accounts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.sc.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-xs">{t("settings.sc.intro")}</p>
          <div className="space-y-1">
            <Label>{t("settings.sc.cash")}</Label>
            <AccountSelect
              accounts={accounts}
              value={settings.scalableCashAccountId}
              onChange={(v) => {
                const acc = accounts.find((a) => a.id === v);
                set({ scalableCashAccountId: v, scalableCashCurrency: acc?.currency ?? "EUR" });
              }}
              placeholder={t("settings.selectCash")}
              filterType="CASH"
            />
            <p className="text-muted-foreground text-xs">{t("settings.sc.cashHelp")}</p>
          </div>
          <div className="space-y-1">
            <Label>{t("settings.sc.securities")}</Label>
            <AccountSelect
              accounts={accounts}
              value={settings.scalablePortfolioAccountId}
              onChange={(v) => set({ scalablePortfolioAccountId: v })}
              placeholder={t("settings.selectSecurities")}
              filterType="SECURITIES"
            />
            <p className="text-muted-foreground text-xs">{t("settings.securitiesHelpPair")}</p>
          </div>
        </CardContent>
      </Card>

      {/* DKB accounts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.dkb.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-xs">{t("settings.dkb.intro")}</p>
          <div className="space-y-1">
            <Label>{t("settings.dkb.cash")}</Label>
            <AccountSelect
              accounts={accounts}
              value={settings.dkbCashAccountId}
              onChange={(v) => set({ dkbCashAccountId: v })}
              placeholder={t("settings.selectCash")}
              filterType="CASH"
            />
            <p className="text-muted-foreground text-xs">{t("settings.dkb.cashHelp")}</p>
          </div>
          <div className="space-y-1">
            <Label>{t("settings.dkb.securities")}</Label>
            <AccountSelect
              accounts={accounts}
              value={settings.dkbPortfolioAccountId}
              onChange={(v) => set({ dkbPortfolioAccountId: v })}
              placeholder={t("settings.selectSecurities")}
              filterType="SECURITIES"
            />
            <p className="text-muted-foreground text-xs">{t("settings.securitiesHelpPair")}</p>
          </div>
        </CardContent>
      </Card>

      {/* Transfer patterns */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.patterns.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-xs">{rich(t("settings.patterns.intro"))}</p>
          <ul className="text-muted-foreground list-inside list-disc text-xs">
            <li>{rich(t("settings.patterns.iban"))}</li>
            <li>{rich(t("settings.patterns.keyword"))}</li>
          </ul>
          <p className="text-muted-foreground text-xs">{rich(t("settings.patterns.note"))}</p>
          {settings.transferPatterns.length === 0 && (
            <p className="text-muted-foreground text-xs italic">{t("settings.patterns.none")}</p>
          )}
          {settings.transferPatterns.map((p, i) => (
            <PatternRow key={i} onRemove={() => removePattern(i)}>
              <Input
                placeholder={t("settings.patterns.ibanPlaceholder")}
                value={p.iban ?? ""}
                onChange={(e) => updatePattern(i, { iban: e.target.value.trim() || undefined })}
                className="font-mono text-xs"
              />
              <Input
                placeholder={t("settings.patterns.keywordPlaceholder")}
                value={p.keyword ?? ""}
                onChange={(e) => updatePattern(i, { keyword: e.target.value || undefined })}
              />
              <Input
                placeholder={t("settings.patterns.labelPlaceholder")}
                value={p.label}
                onChange={(e) => updatePattern(i, { label: e.target.value })}
              />
              <Select
                value={p.destinationAccountId ?? noDestOption}
                onValueChange={(v) =>
                  updatePattern(i, { destinationAccountId: v === noDestOption ? undefined : v })
                }
              >
                <SelectTrigger className="w-44 shrink-0">
                  <SelectValue placeholder={t("settings.patterns.destination")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={noDestOption}>{t("settings.patterns.noDestination")}</SelectItem>
                  <Separator />
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PatternRow>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addPattern}>
            <Icons.Plus className="mr-1 h-4 w-4" />
            {t("settings.patterns.add")}
          </Button>
        </CardContent>
      </Card>

      {/* Security mappings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.mappings.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-xs">{rich(t("settings.mappings.intro"))}</p>
          {Object.keys(settings.securityMappings).length === 0 ? (
            <p className="text-muted-foreground text-xs italic">{t("settings.mappings.none")}</p>
          ) : (
            <>
              <div className="space-y-1">
                {Object.entries(settings.securityMappings).map(([isin, mapping]) => {
                  const name = settings.securityNames[isin] ?? "";
                  const warning = mappingWarning(isin, name, mapping, t);
                  return (
                    <div key={isin} className="space-y-1">
                      <PatternRow onRemove={() => removeSecurityMapping(isin)}>
                        <span className="w-32 shrink-0 font-mono text-xs font-bold">{isin}</span>
                        <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs" title={name}>
                          {mappingLabel(mapping, t)}
                          {warning && (
                            <span className="ml-2 text-amber-700 dark:text-amber-300">
                              <Icons.AlertTriangle className="mr-0.5 inline h-3 w-3" />
                              {warning}
                            </span>
                          )}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 shrink-0 px-2 text-xs"
                          onClick={() => setRemapping(remapping === isin ? null : isin)}
                        >
                          <Icons.Pencil className="mr-1 h-3 w-3" />
                          {t("settings.mappings.change")}
                        </Button>
                      </PatternRow>
                      {remapping === isin && (
                        <RemapPanel
                          ctx={ctx}
                          isin={isin}
                          name={name}
                          current={mapping}
                          accountIds={securitiesAccounts}
                          accountName={accountName}
                          onDone={(m) => void saveMapping(isin, m).catch((e) => setError(String(e)))}
                          onCancel={() => setRemapping(null)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={clearAllSecurityMappings}>
                <Icons.Trash className="mr-1 h-4 w-4" />
                {t("settings.mappings.clearAll")}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? t("settings.saving") : t("settings.save")}
        </Button>
        {saved && (
          <span className="text-muted-foreground flex items-center gap-1 text-sm">
            <Icons.Check className="h-4 w-4 text-green-600" />
            {t("settings.saved")}
          </span>
        )}
      </div>
    </div>
  );
}
