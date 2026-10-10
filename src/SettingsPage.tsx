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
  }, []);

  if (!settings) {
    return <div className="text-muted-foreground p-6 text-sm">Loading settings…</div>;
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
      setError(
        "Select both the cash and the securities account for each broker you import from (Trade Republic, Scalable Capital and/or DKB).",
      );
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
        <h1 className="text-2xl font-semibold">Broker Importer — Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Configure once; settings are saved securely and pre-filled on every import.
        </p>
      </div>

      {/* Accounts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trade Republic accounts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-xs">
            Trade Republic does not separate cash from securities — everything lives in one account.
            Wealthfolio tracks them separately so you can monitor spending, interest, and investment
            performance independently. Select the two Wealthfolio accounts that represent your TR
            balance below.
          </p>
          <div className="space-y-1">
            <Label>Trade Republic cash account</Label>
            <AccountSelect
              accounts={accounts}
              value={settings.cashAccountId}
              onChange={(v) => {
                const acc = accounts.find((a) => a.id === v);
                set({ cashAccountId: v, cashCurrency: acc?.currency ?? "EUR" });
              }}
              placeholder="Select cash account…"
              filterType="CASH"
            />
            <p className="text-muted-foreground text-xs">
              Receives deposits, withdrawals, card transactions, interest, and saveback rewards.
            </p>
          </div>
          <div className="space-y-1">
            <Label>Trade Republic securities account</Label>
            <AccountSelect
              accounts={accounts}
              value={settings.portfolioAccountId}
              onChange={(v) => set({ portfolioAccountId: v })}
              placeholder="Select securities account…"
              filterType="SECURITIES"
            />
            <p className="text-muted-foreground text-xs">
              Receives buy/sell trades and dividends. The importer automatically creates internal
              transfers between the two accounts to keep balances correct.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Scalable Capital accounts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scalable Capital accounts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-xs">
            Scalable Capital exports are imported into their own pair of accounts, so they never
            mix with Trade Republic. Leave empty if you don't use Scalable Capital.
          </p>
          <div className="space-y-1">
            <Label>Scalable Capital cash account</Label>
            <AccountSelect
              accounts={accounts}
              value={settings.scalableCashAccountId}
              onChange={(v) => {
                const acc = accounts.find((a) => a.id === v);
                set({ scalableCashAccountId: v, scalableCashCurrency: acc?.currency ?? "EUR" });
              }}
              placeholder="Select cash account…"
              filterType="CASH"
            />
            <p className="text-muted-foreground text-xs">
              Receives deposits, withdrawals, interest, fees and taxes (e.g. Vorabpauschale).
            </p>
          </div>
          <div className="space-y-1">
            <Label>Scalable Capital securities account</Label>
            <AccountSelect
              accounts={accounts}
              value={settings.scalablePortfolioAccountId}
              onChange={(v) => set({ scalablePortfolioAccountId: v })}
              placeholder="Select securities account…"
              filterType="SECURITIES"
            />
            <p className="text-muted-foreground text-xs">
              Receives buy/sell trades and dividends, with internal transfers to the cash account.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* DKB accounts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">DKB accounts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-xs">
            DKB has no CSV import; its PDF trade and dividend statements are imported into this pair.
            Trade Republic and Scalable Capital PDFs use the accounts above. Leave empty if you don't
            use DKB.
          </p>
          <div className="space-y-1">
            <Label>DKB cash account</Label>
            <AccountSelect
              accounts={accounts}
              value={settings.dkbCashAccountId}
              onChange={(v) => set({ dkbCashAccountId: v })}
              placeholder="Select cash account…"
              filterType="CASH"
            />
            <p className="text-muted-foreground text-xs">
              The Girokonto the trades are settled with; receives the cash side of trades and dividends.
            </p>
          </div>
          <div className="space-y-1">
            <Label>DKB securities account</Label>
            <AccountSelect
              accounts={accounts}
              value={settings.dkbPortfolioAccountId}
              onChange={(v) => set({ dkbPortfolioAccountId: v })}
              placeholder="Select securities account…"
              filterType="SECURITIES"
            />
            <p className="text-muted-foreground text-xs">
              Receives buy/sell trades and dividends, with internal transfers to the cash account.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Transfer patterns */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transfer patterns</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-xs">
            Outbound transfers matching a pattern are recorded as <code>TRANSFER_OUT</code> instead
            of <code>WITHDRAWAL</code>. Each pattern requires at least one of:
          </p>
          <ul className="text-muted-foreground list-inside list-disc text-xs">
            <li>
              <strong>IBAN</strong> — matched against the counterparty IBAN field, or as a substring
              of the description (Trade Republic sometimes embeds the IBAN there instead).
            </li>
            <li>
              <strong>Keyword</strong> — matched as a case-insensitive substring of the description.
            </li>
          </ul>
          <p className="text-muted-foreground text-xs">
            IBAN is tried first (more precise). You can set both on the same pattern. Scalable
            Capital exports have no counterparty IBAN, so their withdrawals are matched against the
            note (<code>Notiz</code>) only.
          </p>
          {settings.transferPatterns.length === 0 && (
            <p className="text-muted-foreground text-xs italic">No transfer patterns configured.</p>
          )}
          {settings.transferPatterns.map((p, i) => (
            <PatternRow key={i} onRemove={() => removePattern(i)}>
              <Input
                placeholder="IBAN (e.g. ES36…)"
                value={p.iban ?? ""}
                onChange={(e) => updatePattern(i, { iban: e.target.value.trim() || undefined })}
                className="font-mono text-xs"
              />
              <Input
                placeholder="Keyword (e.g. INDEXA)"
                value={p.keyword ?? ""}
                onChange={(e) => updatePattern(i, { keyword: e.target.value || undefined })}
              />
              <Input
                placeholder="Label (e.g. Indexa pensiones)"
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
                  <SelectValue placeholder="Destination…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={noDestOption}>No destination</SelectItem>
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
            Add pattern
          </Button>
        </CardContent>
      </Card>

      {/* Security mappings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Security mappings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-xs">
            Once an ISIN is mapped to a ticker (or marked custom) during import, it's remembered
            here so future imports of the same security skip the mapping step. Remove an entry to
            be asked again next time it's imported. <strong>Change</strong> corrects a wrong mapping
            and can move the activities already booked onto the right asset.
          </p>
          {Object.keys(settings.securityMappings).length === 0 ? (
            <p className="text-muted-foreground text-xs italic">No security mappings saved yet.</p>
          ) : (
            <>
              <div className="space-y-1">
                {Object.entries(settings.securityMappings).map(([isin, mapping]) => {
                  const name = settings.securityNames[isin] ?? "";
                  const warning = mappingWarning(isin, name, mapping);
                  return (
                    <div key={isin} className="space-y-1">
                      <PatternRow onRemove={() => removeSecurityMapping(isin)}>
                        <span className="w-32 shrink-0 font-mono text-xs font-bold">{isin}</span>
                        <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs" title={name}>
                          {mappingLabel(mapping)}
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
                          Change
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
                Clear all
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
        {saved && (
          <span className="text-muted-foreground flex items-center gap-1 text-sm">
            <Icons.Check className="h-4 w-4 text-green-600" />
            Saved
          </span>
        )}
      </div>
    </div>
  );
}
