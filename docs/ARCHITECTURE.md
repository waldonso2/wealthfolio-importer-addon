# Architektur – Broker Importer Addon (Trade Republic & Scalable Capital)

Dieses Dokument beschreibt den Aufbau des Addons so, dass Änderungen gezielt und
ohne Seiteneffekte vorgenommen werden können. Es ergänzt `CLAUDE.md` (Kurzreferenz
für Konventionen) und `CONTRIBUTING.md` (Beitragsprozess).

> Stand: Version 2.6.0 (`manifest.json` / `package.json`).
> Abschnitte 1–13 beschreiben den Aufbau und den Trade-Republic-Kern; **Abschnitt 14**
> beschreibt den Scalable-Capital-Import und markiert alle Unterschiede zu Trade Republic;
> **Abschnitt 15** listet alle Änderungen seit Version 1.3.3; **Abschnitt 16** beschreibt,
> wie die zunächst nicht unterstützten Trade-Republic-Typen (Ausschüttungen, Steuern,
> Kapitalmaßnahmen) in drei Stufen dazukamen.
> Zeilenangaben sind Orientierung, keine Garantie – bei Abweichungen gilt der Code.

---

## 1. Zweck und Kontext

Das Addon läuft **innerhalb von Wealthfolio** (Desktop-App für Portfolio-Tracking)
und importiert CSV-Transaktionsexporte von Brokern als Wealthfolio-Aktivitäten
(`BUY`, `SELL`, `DEPOSIT`, `DIVIDEND`, `TRANSFER_IN/OUT`, …). Unterstützt werden
**Trade Republic (TR)** und **Scalable Capital**; das Format wird automatisch an der
Kopfzeile der Datei erkannt.

```mermaid
flowchart LR
    U[Nutzer] -->|CSV-Datei| UI
    subgraph WF[Wealthfolio Host-App]
      subgraph SB[Addon-Sandbox iframe]
        UI[React-Seiten<br/>ImportPage / SettingsPage]
        F[formats.ts<br/>Formaterkennung]
        T[transform.ts<br/>Trade Republic]
        SC[scalable.ts<br/>Scalable Capital]
        UI --> F
        F --> T
        F --> SC
      end
      API[(Addon-SDK API<br/>ctx.api.*)]
      DB[(Wealthfolio DB)]
      UI -->|accounts, activities,<br/>market, secrets, portfolio| API
      API --> DB
    end
```

Es gibt **kein eigenes Backend** und **keinen eigenen Speicher**. Alles, was persistiert
wird (Konfiguration, Aktivitäten), geht über die vom Host bereitgestellte
`AddonContext`-API (`@wealthfolio/addon-sdk`).

### Kernidee: Zwei-Konten-Modell

Beide Broker führen Geld und Wertpapiere in *einem* Konto; Wealthfolio trennt sie. Der
Nutzer wählt daher **pro Broker** zwei Wealthfolio-Konten (für Scalable Capital
`scalableCashAccountId` / `scalablePortfolioAccountId`, siehe 8.1):

| Konto | Typ in Wealthfolio | Erhält |
|---|---|---|
| **Cash-Konto** (`cashAccountId`) | `CASH` | Einzahlungen, Auszahlungen, Kartenzahlungen, Zinsen, Saveback, Gebühren |
| **Portfolio-Konto** (`portfolioAccountId`) | `SECURITIES` | Käufe, Verkäufe, Dividenden, Einlieferungen, Kapitalmaßnahmen (Wertpapierwechsel, Splits, Aktiendividenden) |

Damit die Salden beider Konten stimmen, erzeugt das Addon für jede Geldbewegung
zwischen ihnen ein **TRANSFER_OUT/TRANSFER_IN-Paar** (Details in Abschnitt 5). Am Ende
hält das Portfolio-Konto **kein Bargeld** (5.5 Nr. 10): Was dort an Geld ankommt
(Verkauf, Dividende), wird vollständig zum Cash-Konto umgebucht, und alles, was dort
bezahlt wird (Kauf), kommt vorher vom Cash-Konto.

---

## 2. Technologie-Stack und Build

| Bereich | Technologie | Hinweis |
|---|---|---|
| Sprache | TypeScript 6 (`strict`, `noUnusedLocals/Parameters`) | `tsconfig.json` |
| UI | React 19 + `@wealthfolio/ui` (shadcn-artige Komponenten) + Tailwind 4 | React/UI kommen **vom Host** |
| CSV-Parsing | `papaparse` | einzige echte Laufzeit-Abhängigkeit, wird gebündelt |
| Build | Vite 8 (Library-Mode, ES-Modul) | `vite.config.ts` |
| Tests | Vitest 4 | getestet sind die Transformer (`transform.ts`, `scalable.ts`), `formats.ts` und `common.ts`; die UI nicht |
| Runtime | Node 24, pnpm 11 | `.tool-versions` |

**Build-Ausgabe:** genau eine Datei `dist/addon.js`. Host-Abhängigkeiten werden in
`vite.config.ts` als `external` markiert und **nicht** gebündelt:

```
@wealthfolio/addon-sdk, @wealthfolio/ui, react, react-dom, react-dom/client,
react/jsx-runtime, react/jsx-dev-runtime
```

Diese stehen zusätzlich als `peerDependencies` in `package.json` und als
`hostDependencies` in `manifest.json`. **Wer eine neue Host-Bibliothek nutzt, muss
alle drei Stellen synchron halten.** Neue npm-Pakete, die nicht vom Host kommen,
werden automatisch in `addon.js` gebündelt (→ `dependencies`).

`pnpm bundle` zippt `manifest.json`, `dist/addon.js` und `README.md` zu
`dist/broker-importer-addon.zip` – das installierbare Paket.

---

## 3. Modulübersicht

```
src/
├── addon.tsx               Einstiegspunkt: Sidebar, Routen, React-Root, Navigation
├── formats.ts              Formaterkennung (Kopfzeile) + Parsen + Weiterleitung an den Transformer
├── common.ts               Gemeinsame Helfer beider Transformer (makeCashAct, matchPattern, …)
├── scalable.ts             Scalable Capital: ScRow[] → ActivityImportEx[] (Abschnitt 14)
├── ImportPage.tsx          Import-Wizard (Zustandsautomat, SDK-Aufrufe, Import-Schleife, Tabelle der übersprungenen Zeilen)
├── UpdateBanner.tsx        Hinweis auf neue Version (über Import und Settings)
├── updateCheck.ts          Prüft GitHub-Releases auf eine neuere Version (4.2)
├── SecurityMappingStep.tsx UI-Schritt: ISIN → Ticker zuordnen
├── SettingsPage.tsx        Einstellungen: Konten, Transfer-Patterns, Security-Mappings
├── settings.ts             Laden/Speichern der Konfiguration (ctx.api.secrets)
├── transform.ts            ★ Trade Republic: TrRow[] → ActivityImportEx[] (inkl. Vorlauf planSpecialRows)
├── types.ts                Gemeinsame Typen (TrRow, ScRow, AddonSettings, SkippedRow/SkipKind, …)
├── transform.test.ts       Unit- und Fixture-Tests für transform() (73 Tests)
├── scalable.test.ts        Tests für scalable.ts, formats.ts, tradeFinalCash (31 Tests)
├── updateCheck.test.ts     Tests für die Update-Prüfung (8 Tests)
└── __fixtures__/
    ├── tr-sample.csv       26 Zeilen, deckt alle unterstützten TR-Typen ab
    └── scalable-sample.csv 26 erfundene Zeilen im Scalable-Format (Abschnitt 14)
```

### Abhängigkeitsgraph

```mermaid
flowchart TD
    addon[addon.tsx] --> IP[ImportPage.tsx]
    addon --> SP[SettingsPage.tsx]
    IP --> SMS[SecurityMappingStep.tsx]
    IP --> FO[formats.ts]
    IP --> CM[common.ts]
    FO --> TR[transform.ts]
    FO --> SC[scalable.ts]
    TR --> CM
    SC --> CM
    IP --> ST[settings.ts]
    SP --> ST
    IP --> TY[types.ts]
    SP --> TY
    SMS --> TY
    TR --> TY
    SC --> TY
    ST --> TY
    TEST[transform.test.ts] --> TR
    TEST --> FIX[__fixtures__/tr-sample.csv]
    TEST2[scalable.test.ts] --> SC
    TEST2 --> FO
    TEST2 --> FIX2[__fixtures__/scalable-sample.csv]
```

### Schichten

| Schicht | Dateien | Regeln |
|---|---|---|
| **Domänenlogik** | `transform.ts`, `scalable.ts`, `common.ts`, `formats.ts`, `types.ts` | Rein, synchron, kein React, kein `ctx`. Vollständig unit-testbar. `formats.ts` ist die einzige Stelle, die CSV parst. |
| **Persistenz** | `settings.ts` | Einzige Stelle, die `ctx.api.secrets` nutzt. |
| **Orchestrierung + UI** | `ImportPage.tsx` | Ruft `parseAndTransform()`, SDK-APIs, steuert den Wizard. Enthält noch Logik (Mapping-Anwendung, Import-Schleife). |
| **Update-Hinweis** | `updateCheck.ts`, `UpdateBanner.tsx` | Einzige Stelle mit Netzwerkzugriff (`ctx.api.network`) und Addon-Speicher (`ctx.api.storage`), siehe 4.2. |
| **Reine UI** | `SecurityMappingStep.tsx`, `SettingsPage.tsx` | Formulare / Darstellung; Mapping-Step ist zustandslos bzgl. Persistenz (Callbacks). |
| **Bootstrap** | `addon.tsx` | Registrierung beim Host; keine Fachlogik. |

**Leitprinzip:** Neue *Mapping-Regeln* gehören in den Transformer des jeweiligen Brokers
(`transform.ts` bzw. `scalable.ts`, mit Tests), broker-übergreifende Helfer nach
`common.ts`, neue Broker-Formate über `formats.ts` (Rezept 12.6) – nicht in die
React-Komponenten.

---

## 4. Laufzeit: Lebenszyklus des Addons (`addon.tsx`)

Wealthfolio lädt `dist/addon.js` in einer Sandbox (iframe) und ruft den
Default-Export `enable(ctx)` auf.

1. **Sidebar-Eintrag** `ctx.sidebar.addItem({ id: "broker-importer", label: "Broker Import", icon: "bank", route: "/addon/broker-importer" })`.
2. **Drei Routen** über `ctx.router.add({ path, render })`:
   - `/addon/broker-importer` → Import
   - `/addon/broker-importer/import` → Import
   - `/addon/broker-importer/settings` → Settings
3. **Ein gemeinsamer React-Root.** Der Host übergibt *allen* Routen denselben
   DOM-Knoten. Deshalb wird `createRoot` nur einmal aufgerufen (`root ??= createRoot(...)`)
   und danach nur `root.render(...)`. Mehrere Roots auf demselben Knoten brechen das
   Rendering (siehe CHANGELOG 1.3.1). **Bei neuen Routen dieses Muster beibehalten.**
4. **`Nav`**: einfache Tab-Leiste, navigiert über `ctx.api.navigation.navigate(path)`.
   Darunter steht auf beiden Seiten `UpdateBanner` (4.2).
5. **`ctx.onDisable`**: Root unmounten, Sidebar-Eintrag entfernen.

Jede Seite bekommt `ctx` als Prop; es gibt keinen globalen State/Context-Provider.

### 4.1 Addon-ID und Namen

| Merkmal | Wert | Bedeutung |
|---|---|---|
| `manifest.json` → `id` | `broker-importer` | Schlüssel, unter dem Wealthfolio das Addon, seine Routen und seine `secrets` führt |
| `ADDON_ID` in `addon.tsx` | `broker-importer` | muss mit der `id` übereinstimmen; bildet die Routen `/addon/broker-importer/…` |
| `package.json` → `name` | `broker-importer-addon` | npm-Paketname |
| Release-Paket | `dist/broker-importer-addon.zip` | Name in `package.json` (`bundle`) und `.github/workflows/release.yml` |

Bis einschließlich 1.4.0 lautete die `id` `trade-republic-importer`. **Eine Änderung der `id`
ist ein Bruch:** Wealthfolio behandelt das Addon dann als neues Addon. Das alte muss
deinstalliert werden, und die Einstellungen (Konten, Transfer-Patterns, Security-Mappings)
müssen neu eingerichtet werden, weil `secrets` an die `id` gebunden sind.

### 4.2 Updates und Update-Hinweis

**Wie Wealthfolio Addons aktualisiert** (geprüft am Wealthfolio-Quellcode,
`crates/core/src/addons/service.rs`):
- Update-Prüfung und -Installation laufen **nur** über den Wealthfolio-Store
  (`https://wealthfolio.app/api/addons/update-check?addonId=…`). Eine eigene
  Update-Adresse kann ein Addon nicht angeben, und es kann sich nicht selbst ersetzen.
  Dieses Addon ist dort nicht gelistet; Aufnahme laut Wealthfolio-Doku über
  support@wealthfolio.app.
- **„Install from File"** ersetzt nur den Ordner `addons/<id>/` (mit Sicherung während des
  Austauschs). Ein Addon mit gleicher `id` wird überschrieben, Deinstallieren ist nicht nötig.
- Die **Einstellungen** liegen im Schlüsselbund des Betriebssystems unter
  `addon:<id>:config` (`ctx.api.secrets`) und bleiben bei „Install from File" erhalten.
  `ctx.api.storage` (Update-Cache, siehe unten) übersteht Updates und wird beim
  Deinstallieren gelöscht.

**Update-Hinweis im Addon (seit 2.1.0):**
- `updateCheck.ts` fragt `https://api.github.com/repos/waldonso2/wealthfolio-importer-addon/releases/latest`
  über `ctx.api.network.request` ab – **höchstens einmal pro 24 h**; das Ergebnis liegt
  in `ctx.api.storage` unter `update-check`.
- Ist `tag_name` neuer als die installierte Version (`version` aus `manifest.json`, beim
  Build eingebunden), zeigt `UpdateBanner` Version, Download-Adresse der ZIP-Datei und
  Release-Seite.
- Die Sandbox des Addons (`<iframe sandbox="allow-scripts">`) erlaubt weder neue Fenster
  noch das Öffnen externer Seiten. Die Adresse wird deshalb **zum Kopieren** in einem
  Textfeld angezeigt, nicht als Link.
- Fehler (keine Freigabe für `api.github.com`, kein Netz, GitHub-Fehler) führen nie zu
  einer Fehlermeldung, sondern nur dazu, dass kein Hinweis erscheint.
- Voraussetzung im Manifest: Berechtigung `network` → `request` und
  `"network": { "allowedHosts": ["api.github.com"] }`. Der Nutzer gibt den Host bei der
  Installation frei. Wird das Repo umbenannt oder verschoben, `RELEASES_API_URL` in
  `updateCheck.ts` anpassen; der Name des ZIP-Assets steht dort ebenfalls.

---

## 5. Domänenlogik Trade Republic: `transform.ts` (Scalable: Abschnitt 14)

### 5.1 Signatur

```ts
transform(rows: TrRow[], config: AddonSettings): TransformResult
// TransformResult = { activities: ActivityImportEx[]; skipped: SkippedRow[] }
```

- `TrRow` = eine CSV-Zeile als String-Map (Spalten wie im TR-Export, siehe `types.ts`).
- `ActivityImportEx` = SDK-Typ `ActivityImport` **plus** optionales `transferGroupId`.
- `SkippedRow` = Zeilen, die bewusst oder mangels Regel nicht importiert werden:
  `{ datetime, type, category, description, reason, kind?, hint? }`. `kind` ist
  `netted` (absichtlich übersprungen, Wirkung ist abgedeckt – z. B. Storno und
  stornierte Zeile) oder `missing` (nicht importiert, Wealthfolio weicht vom Broker ab);
  `hint` sagt bei `missing`, was der Nutzer von Hand ergänzen kann. Texte auf Englisch,
  weil sie in der Addon-UI erscheinen.

Die Funktion ist **rein**: keine I/O, kein Zufall, keine Uhrzeit. Gleicher Input → gleicher Output.

### 5.2 Ablauf

```mermaid
flowchart TD
    A[rows] --> P[Vorlauf planSpecialRows:<br/>Stornos, Kapitalmaßnahmen,<br/>FIFO-Bestände]
    P --> B[Vorlauf: STOCKPERK-Zeilen<br/>passenden BUYs zuordnen]
    B --> C{für jede Zeile:<br/>vorgeplant?<br/>sonst category / type}
    C -->|vorgeplant| V[Aktivitäten bzw.<br/>skipped aus dem Vorlauf]
    C -->|TRADING/BUY| D[BUY-Regel]
    C -->|TRADING/SELL| E[SELL-Regel]
    C -->|DELIVERY/*| F[FREE_RECEIPT / MIGRATION]
    C -->|CASH/*| G[CASH-Unterregeln]
    C -->|sonst| H[skipped: missing]
    V & D & E & F & G & H --> I[activities / skipped]
    I --> J[nach date sortieren]
    J --> K[lineNumber = Index+1 vergeben]
```

1. **Vorlauf `planSpecialRows` (seit 2.5.0, vorher `dividendCorrections` +
   `mapCorporateActions`):** Zeilen, deren Bedeutung von *anderen* Zeilen abhängt, werden
   vorab entschieden und unter ihrer `transaction_id` abgelegt – entweder als fertige
   Aktivitäten (auch eine leere Liste, wenn eine andere Zeile die Wirkung bucht) oder als
   `skipped` mit Grund:
   - **Dividenden-Stornos:** negative Dividende + Gegenstück (gleiche ISIN, gleicher
     Betrag und gleiche Steuer mit umgekehrtem Vorzeichen; das zeitlich nächste) → beide
     `netted`.
   - **Aktiendividenden-Umbuchung:** −n hebt das zeitlich nächste +n derselben ISIN auf.
   - **FIFO-Bestände:** chronologischer Durchlauf über `BUY`, `SELL`, `FREE_RECEIPT` und
     die Kapitalmaßnahmen selbst; daraus Einstandswert bei Wertpapierwechseln und
     Verhältnis bei Splits (Details 16.2, 16.3).
   - **Wiederanlage:** `DIVIDEND_REINVESTMENT` + negative Dividendenzeile → finanzierter
     `BUY`.
   Die Hauptschleife prüft zuerst, ob eine Zeile vorgeplant ist.
2. **Vorlauf STOCKPERK:** Für jede `STOCKPERK`-Zeile wird ein `BUY` mit gleichem
   `symbol`, `date` und Betrag (auf Cent gerundet) gesucht. Dessen `transaction_id`
   landet in `stockperkFundedBuyIds` – diese Käufe sind von TR geschenkt und werden
   nicht aus dem Cash-Konto finanziert.
3. **Hauptschleife:** Eine lange `if`-Kaskade nach `category` + `type`. Jeder Zweig
   endet mit `continue`. Was durchfällt, landet in `skipped` (`missing`, mit Hinweis
   auf die Bargeldwirkung der Zeile, `moneyHint`).
4. **Sortierung** nach `date` (aufsteigend, stabil) und anschließend **Vergabe von
   `lineNumber`** (1-basiert). `lineNumber` ist der Schlüssel, über den die UI
   Aktivitäten nach `checkImport` wiedererkennt (siehe 6.3).

### 5.3 Hilfsfunktionen

Seit 1.4.0 liegen diese Helfer in `src/common.ts` und werden von `transform.ts` und
`scalable.ts` gemeinsam genutzt (`num` bleibt in `transform.ts`, Scalable hat `deNum`).

| Funktion | Zweck |
|---|---|
| `num(s)` (nur `transform.ts`) | `parseFloat` mit `""`/`null` → `0` |
| `fmtAmt(n)` | Absolutwert, max. 6 Nachkommastellen, ohne Trailing Zeros, als String |
| `addSec(iso, s)` | Zeitstempel um *s* Sekunden verschieben (Reihenfolge innerhalb eines Vorgangs) |
| `timeTag(dt)` | Hängt ` [HH:MM:SS.ffffff]` an Kommentare. Wealthfolios Duplikat-Fingerabdruck berücksichtigt nur den **Tag**, nicht die Uhrzeit, wohl aber den Kommentar (siehe 6.4) – so bleiben gleichartige Buchungen am selben Tag unterscheidbar |
| `matchPattern(iban, desc, patterns)` | Transfer-Pattern suchen: (1) IBAN exakt auf `counterparty_iban`, (2) IBAN als Teilstring in `description`, (3) Keyword in `description` (case-insensitiv) |
| `makeCashAct(currency)` | Fabrik für Cash-Aktivitäten: `symbol = "$CASH-<Währung>"`, `quantity = unitPrice = "1"`, `amount` gesetzt |
| `isCashSymbol(symbol)` | `true` für jedes `$CASH-…`-Symbol, unabhängig von der Währung – von `ImportPage` genutzt, um Cash- von Wertpapier-Aktivitäten zu trennen (seit 1.3.4) |
| `sortAndNumber(activities)` | Sortiert nach `date` und vergibt `lineNumber` (einzige Stelle dafür, siehe 5.5 Nr. 5) |
| `tradeFinalCash(type, qty, price, fee, tax?)` | Exakter `amount` für `BUY`/`SELL`: `qty × price + fee + tax` bzw. `− fee − tax`, mit BigInt statt Float (seit 2.0.2, `tax` seit 2.6.0; siehe 5.5 Nr. 7 und 6.4) |

Nur in `transform.ts`:

| Name | Zweck |
|---|---|
| `DIVIDEND_LIKE` | Typen, die wie eine Dividende gebucht werden, mit Kommentar-Präfix (`DIVIDEND`, `DISTRIBUTION`, `EXCHANGE`) |
| `TAX_ONLY` | Typen, die nur Steuer bewegen (Vorabpauschale, Steuerkorrekturen), mit Kommentartext |
| `SECURITY_EXCHANGE` | Kapitalmaßnahmen, bei denen eine ISIN gegen eine andere getauscht wird, mit Bezeichnung |
| `planSpecialRows(rows, config)` | Vorlauf für Zeilen, die von anderen Zeilen abhängen (5.2 Nr. 1) |
| `fmtPrice(n)` | wie `fmtAmt`, aber 10 Nachkommastellen (Stückpreise und Stückzahlen bei Kapitalmaßnahmen) |
| `moneyHint(r)` | Hinweistext für eine nicht unterstützte Zeile: um wie viel sie das TR-Bargeld verändert hat |

### 5.4 Mapping-Tabelle (Ist-Zustand)

`C` = Cash-Konto, `P` = Portfolio-Konto, `D` = `destinationAccountId` eines Patterns,
`t` = `datetime` der Zeile. Gruppen-ID = `transferGroupId`.

| TR `category` / `type` | Erzeugte Aktivitäten | Gruppen-ID |
|---|---|---|
| `TRADING/BUY` (normal) | C `TRANSFER_OUT` (t−2s, Betrag+Gebühr+Steuer) → P `TRANSFER_IN` (t−1s) → P `BUY` (t, `fee` = Gebühr, `tax` = Steuer, `amount` = `tradeFinalCash`) | `buy-<txid>` |
| `TRADING/BUY` (STOCKPERK-finanziert) | P `CREDIT`/`BONUS` (t−1s) → P `BUY` (t, `fee`/`tax` getrennt, `amount` = `tradeFinalCash`) | – |
| `TRADING/SELL` | P `SELL` (t, `fee` = Gebühr, `tax` = einbehaltene Steuer, `amount` = `tradeFinalCash` = Erlös − Gebühr − Steuer) → P `TRANSFER_OUT` (t+1s, Geldfluss) → C `TRANSFER_IN` (t+2s). Steuer**erstattung** (positive `tax`): zusätzlich P `CREDIT`/`TAX_REFUND`, mit umgebucht | `sell-<txid>` |
| `DELIVERY/FREE_RECEIPT` | P `TRANSFER_IN` (Wertpapier, Depotübertrag) | – |
| `DELIVERY/MIGRATION` | → `skipped` (`netted`, technischer ISIN-Wechsel) | – |
| `CASH/STOCKPERK` | ignoriert (im BUY-Zweig verarbeitet), **nicht** in `skipped` | – |
| `CASH/CUSTOMER_INBOUND`, `CUSTOMER_INPAYMENT` | C `DEPOSIT` | – |
| `CASH/TRANSFER_INBOUND`, `TRANSFER_INSTANT_INBOUND` | C `DEPOSIT` (bzw. `WITHDRAWAL` bei negativem Betrag) | – |
| `CASH/CUSTOMER_OUTBOUND_REQUEST`, `TRANSFER_OUTBOUND`, `TRANSFER_INSTANT_OUTBOUND`, `TRANSFER_DIRECT_DEBIT_INBOUND` | ohne Pattern: C `WITHDRAWAL`; Pattern ohne Ziel: C `TRANSFER_OUT`; Pattern mit Ziel: C `TRANSFER_OUT` + D `TRANSFER_IN` | `xfer-<txid>` (nur mit Ziel) |
| `CASH/CARD_TRANSACTION`, `CARD_TRANSACTION_INTERNATIONAL` | C `WITHDRAWAL` (Betrag inkl. Gebühr) bzw. `DEPOSIT` bei Erstattung | – |
| `CASH/CARD_ORDERING_FEE` | C `FEE` | – |
| `CASH/BENEFITS_SAVEBACK` | C `CREDIT`/`BONUS` (netto nach Steuer) | – |
| `CASH/DIVIDEND`, `DISTRIBUTION`, `EXCHANGE` | **eine** P `DIVIDEND` in der Auszahlungswährung mit `amount` = Nettobetrag und `tax` = Quellensteuer (Wealthfolio weist Ertrag brutto = `amount + tax` und die Steuer aus; seit 2.6.0, vorher eigene `TAX`-Zeile); bei Fremdwährung steht der Originalbetrag nur im Kommentar („… (8.01 USD)“) → P `TRANSFER_OUT` (t+1s, netto) → C `TRANSFER_IN` (t+2s). Kommentar-Präfix je Typ: „Dividend" / „Distribution" / „Exchange distribution" (Tabelle `DIVIDEND_LIKE`) | `div-<txid>` |
| `CASH/DIVIDEND`, `DISTRIBUTION`, `EXCHANGE` mit **negativem** Betrag | Storno: hebt die zeitlich nächste Zeile derselben ISIN mit gleichem Betrag und gleicher Steuer (umgekehrtes Vorzeichen) auf, beide → `skipped` (`netted`, `planSpecialRows`). Gehört sie zu einem `DIVIDEND_REINVESTMENT`, finanziert sie dessen BUY (siehe unten). Sonst → `skipped` (`missing`) | – |
| `CASH/EARNINGS`, `PRE_DETERMINED_TAX_BASE` (Vorabpauschale), `SEC_ACCOUNT`, `TAX_OPTIMIZATION` | Betrag = `amount + tax` (meist nur `tax`): negativ → C `TAX`, positiv → C `CREDIT`/`TAX_REFUND`, 0 → `skipped` (`netted`) (Tabelle `TAX_ONLY`) | – |
| `CASH/REFERRAL` | C `CREDIT`/`BONUS` (netto nach Steuer) | – |
| `CORPORATE_ACTION/SHARE_EXCHANGE`, `ADR_DISCONTINUATION`, `REORGANISATION`, `REVERSE_SPLIT` | P `TRANSFER_OUT` alte ISIN (t) + P `TRANSFER_IN` neue ISIN (t+1s), beide mit `unitPrice` = Einstandswert ÷ Stück (FIFO aus derselben Datei, `planSpecialRows`); Einstandswert unbekannt → beide Zeilen `skipped` (`missing`) | – (absichtlich ungepaart, siehe 16.2) |
| `CORPORATE_ACTION/WORTHLESS` | P `SELL` zu 0 (`fee` 0, `amount` 0), keine Cash-Umbuchung | – |
| `CORPORATE_ACTION/SPLIT` (gleiche ISIN, ±n Stück) | P `SPLIT` mit `amount` = Verhältnis (Bestand + n) ÷ Bestand, Bestand FIFO aus der Datei; ohne Bestand → `skipped` (`missing`) | – |
| `CORPORATE_ACTION/STOCK_DIVIDEND` | P `DIVIDEND`/`DIVIDEND_IN_KIND` (`quantity` n, `unitPrice` = `price`, `amount` = n × `price`) – Wealthfolio bucht Ertrag + Zugang, ohne Bargeld. +n/−n-Umbuchung derselben ISIN → beide `skipped` (`netted`); ohne Preis → `skipped` (`missing`) | – |
| `CORPORATE_ACTION/DIVIDEND_REINVESTMENT` + negative `CASH/DIVIDEND` derselben ISIN (≤ 7 Tage) | C `TRANSFER_OUT` (t−2s) → P `TRANSFER_IN` (t−1s) über den abgebuchten Betrag → P `BUY` n Stück; die negative Dividendenzeile erzeugt selbst nichts. Ohne Abbuchung → `skipped` (`missing`) | `buy-<txid>` |
| anderer `CORPORATE_ACTION`-Typ | → `skipped` (`missing`, mit Stückänderung und Hinweis) | – |
| `CASH/INTEREST_PAYMENT`, `MANUAL_CASH_TRANSFER` | **eine** C `INTEREST` mit `amount` = Nettobetrag und `tax` = Quellensteuer (seit 2.6.0, vorher eigene `TAX`-Zeile) | – |
| anderer `CASH`-Typ | → `skipped` (`missing`, Hinweis nennt die Bargeldwirkung) | – |
| andere `category` | → `skipped` (`missing`) | – |

Weitere Konventionen:
- `instrumentType`: `asset_class === "STOCK"` → `EQUITY`, sonst `FUND`.
- Wertpapier-Aktivitäten verwenden zunächst die **ISIN als `symbol`**; die Auflösung
  auf echte Ticker passiert erst in der UI (Abschnitt 6.2).
- **Gebühr und Steuer stehen in eigenen Feldern** (`fee`, `tax`; seit 2.6.0, vorher bei
  BUY/SELL zu `fee` zusammengefasst). In Wealthfolio ist `amount` immer der tatsächliche
  Geldfluss; Gebühr und Steuer werden daraus getrennt ausgewiesen
  (`portfolio-engine/compile.rs`: Ertrag = `amount + fee + tax`, SELL-Erlös =
  `amount + fee + tax`, BUY-Kosten = `amount − fee − tax`). Das Feld `tax` nimmt nur
  Belastungen auf; eine Erstattung wird eine eigene `CREDIT`/`TAX_REFUND`. Eigene
  `TAX`-Zeilen gibt es nur für Steuern ohne zugehörige Buchung (Vorabpauschale,
  Steuerkorrekturen).

### 5.5 Invarianten (bei Änderungen unbedingt einhalten)

1. **Jedes interne TRANSFER_OUT/TRANSFER_IN-Paar braucht eine gemeinsame, eindeutige
   `transferGroupId`.** Sonst zählt Wealthfolio die Bewegung als Ausgabe (Spending).
   Schema: `<präfix>-<transaction_id>`.
2. **Outbound vs. Inbound:** Nur *ausgehende* CASH-Typen prüfen `transferPatterns`.
   Eingehende Typen sind immer `DEPOSIT` – absichtlich ohne Pattern-Matching.
3. **Zeitversatz** über `addSec` bestimmt die Reihenfolge innerhalb eines Vorgangs
   (Geld kommt vor dem Kauf an, verlässt das Depot nach dem Verkauf).
4. **Kommentare mit `timeTag`**, damit gleichartige Buchungen am selben Tag nicht
   als Duplikat zusammenfallen.
5. **`lineNumber` wird ausschließlich am Ende von `transform()` vergeben** und muss
   eindeutig bleiben.
6. Unbekanntes wird **nie stillschweigend verworfen**, sondern in `skipped` mit
   `reason` gemeldet (Ausnahmen: `CASH/STOCKPERK`, das im BUY-Zweig steckt, und die
   negative Dividendenzeile, die eine Wiederanlage finanziert). Jede `SkippedRow` trägt
   `kind`: `netted` (absichtlich, Wirkung ist abgedeckt – kein Handlungsbedarf) oder
   `missing` (nicht importiert – Wealthfolio weicht ab), bei `missing` mit `hint`, was
   der Nutzer tun kann. Die UI zeigt das als Spalte „Status“ und sortiert `missing` nach
   oben.
7. **`BUY`/`SELL` tragen immer `amount = tradeFinalCash(...)`** (`common.ts`): exakt
   `Menge × Stückpreis + Gebühr + Steuer` (BUY) bzw. `− Gebühr − Steuer` (SELL), mit BigInt statt Float
   berechnet. Wealthfolio bildet den Duplikat-Fingerabdruck (`idempotencyKey`) aus dem
   exakten `amount`. Fehlt er, leitet Wealthfolio ihn beim Anlegen genau so ab und
   speichert ihn – `checkImport` hasht aber den eingereichten Wert. Ohne `amount`
   würden Trades bei einem erneuten Import nie als Duplikat erkannt und doppelt angelegt.
8. **Kommentare bestehender Typen nicht ändern.** Der Kommentar geht in den
   Duplikat-Fingerabdruck ein (6.4). Wer z. B. „Dividend …" umformuliert, lässt alle
   früher importierten Dividenden beim nächsten Import als neu erscheinen. Neue Typen
   bekommen deshalb eigene Präfixe (`DIVIDEND_LIKE`), statt bestehende anzufassen.
9. **Wertpapierwechsel nie mit `transferGroupId`.** Wealthfolio lehnt Übertrags-Paare
   zwischen zwei verschiedenen Wertpapieren ab („security transfer legs use different
   assets"). Der Einstandswert reist deshalb über `unitPrice` des ungepaarten
   `TRANSFER_IN` (16.2).
10. **Auf dem Portfolio-Konto bleibt kein Bargeld.** Jede Bargeld-Buchung dort (Dividende,
    Steuer, Kauf, Verkauf) muss in der Cash-Währung erfolgen und vollständig zum oder vom
    Cash-Konto umgebucht werden. Wealthfolio führt Bargeld pro Währung: eine `DIVIDEND`
    in USD neben `TAX` und Umbuchung in EUR ließ bis 2.3.1 USD-Guthaben und ein
    EUR-Minus auf dem Portfolio-Konto stehen.

---

## 6. Import-Wizard: `ImportPage.tsx`

### 6.1 Zustandsautomat

```mermaid
stateDiagram-v2
    [*] --> NotConfigured: für keinen Broker Konten gesetzt
    [*] --> upload
    upload --> asset_review: unbekannte ISINs vorhanden
    upload --> checking: keine Wertpapiere ODER alle ISINs bekannt
    asset_review --> checking: Continue (alle aufgelöst)
    asset_review --> upload: Back
    checking --> confirm: checkImport ok / Fehler (Warnung)
    confirm --> asset_review: Back (wenn Wertpapiere)
    confirm --> upload: Back (sonst)
    confirm --> importing: Import N activities
    importing --> done
    importing --> confirm: unerwarteter Fehler
    done --> upload: reset
```

`type Step = "upload" | "asset-review" | "checking" | "confirm" | "importing" | "done"`.
Der gesamte Zustand liegt in `useState`-Hooks der Komponente (kein Store).

### 6.2 Datenfluss eines Imports

```mermaid
sequenceDiagram
    participant U as Nutzer
    participant IP as ImportPage
    participant T as formats.ts → transform() / transformScalable()
    participant S as settings.ts
    participant API as ctx.api

    IP->>S: loadSettings()
    IP->>API: accounts.getAll()
    U->>IP: CSV hochladen
    IP->>T: parseAndTransform(text, settings)
    T->>T: detectFormat (Kopfzeile), Papa.parse, Transformer wählen
    T-->>IP: {activities, skipped}
    IP->>IP: ISINs sammeln, mit settings.securityMappings vorbefüllen
    alt unbekannte ISINs
        U->>IP: SecurityMappingStep (searchTicker / custom)
        IP->>S: saveSettings(+ neue Mappings)
    end
    IP->>IP: applySecurityMappings()
    IP->>API: activities.checkImport(activities)
    API-->>IP: validierte Aktivitäten (Duplikate, Fehler)
    U->>IP: Duplikate ein-/ausschließen, Import starten
    loop pro Aktivität
        IP->>API: activities.create() oder .update() (bei Duplikat)
    end
    IP->>API: portfolio.update(), query.invalidateQueries([])
```

**Schritte im Detail:**

1. **Upload (`handleFile`)**: Dateiendung `.csv` prüfen, `file.text()`.
2. **Parsen + Transform**: `parseAndTransform(text, settings)` (`formats.ts`) erkennt das
   Format an der Kopfzeile, prüft, ob für diesen Broker Konten gesetzt sind, parst mit
   dem passenden Trennzeichen und ruft `transform()` bzw. `transformScalable()` auf.
   Fehler (unbekanntes Format, fehlende Konten, leere Datei) erscheinen als `fileError`.
   Das erkannte Format wird angezeigt.
3. **Wertpapiere ermitteln**: alle Aktivitäten, deren `symbol` kein Cash-Symbol ist
   (`isCashSymbol`) → `SecurityInfo { isin, name, count }`. Als `name` wird der
   **jüngste** Name aus der Datei verwendet (seit 2.0.1).
4. **Vorbefüllung** aus `settings.securityMappings`. Sind *alle* ISINs bekannt, wird
   `SecurityMappingStep` übersprungen.
5. **`applySecurityMappings`**: ersetzt ISIN durch Ticker-Daten aus `SymbolSearchResult`
   (`symbol`, `exchangeMic`, `quoteCcy`, `instrumentType`, `providerId`, `assetId`, …).
   `"custom"` lässt die ISIN als Symbol stehen. Ist die ISIN eine Aktie (irgendeine Zeile
   dieser ISIN hat `instrumentType: "EQUITY"`), bekommen alle ihre Zeilen
   `quoteMode: "MANUAL"`, das `handleImport` als `asset.quoteMode` weiterreicht:
   Wealthfolio lehnt Aktien ohne Marktdaten und ohne Börse sonst ab („Could not find '…'
   in market data", z. B. delistete Werte wie nach einer Insolvenz). Fonds bleiben
   unverändert, weil ein angefragter `quoteMode` auch ein vorhandenes Wertpapier
   umstellt und Fonds diese Prüfung nicht haben.
6. **`checkImport`**: Host validiert und markiert Duplikate (`duplicateOfId`, siehe 6.4)
   und Fehler. Bei Exception wird mit den ungeprüften Daten weitergemacht und eine
   Warnung gezeigt.
7. **Confirm**: Status je Aktivität über `activityStatus()`:
   - `duplicate` ⇔ `duplicateOfId` gesetzt (existiert bereits in der DB).
     `duplicateOfLineNumber` (Duplikat innerhalb der Datei) wird **bewusst ignoriert** –
     TRANSFER-Paare sehen sich zwangsläufig ähnlich.
   - `error` ⇔ `!isValid` oder `errors` nicht leer → wird nicht importiert.
   - sonst `valid`.
   Duplikate werden standardmäßig **aktualisiert**; der Nutzer kann sie per
   `excludedLines` (Set von `lineNumber`) überspringen.
   Der Reiter **„Skipped“** (bis 2.4.0 „Unsupported“) zeigt die `skipped`-Zeilen des
   Transformers mit Spalte **Status** („Not imported“ rot und oben, „No action needed“)
   und dem `hint` unter der Begründung; die Kopfzeile zählt „not imported“ und „netted
   out“ getrennt.
8. **Import (`handleImport`)**: sequenziell, eine Aktivität pro SDK-Aufruf:
   - Duplikat → `ctx.api.activities.update({ id: duplicateOfId, … })`
   - sonst → `ctx.api.activities.create({ … })`
   - `asset`-Objekt wird aus den Symbolfeldern gebaut (Host legt Assets bei Bedarf an).
   - `fee` und `tax` werden getrennt übergeben (`tax` seit 2.6.0; vorher schickte
     `handleImport` das Feld nicht mit).
   - Fehler einzelner Aufrufe werden gezählt (`skippedCount`), nicht abgebrochen.
   - Danach `portfolio.update()` + `query.invalidateQueries([])` (Fehler hier sind unkritisch).
   - Ergebnis wird als synthetisches `ImportActivitiesResult` angezeigt.

### 6.3 `transferGroupId` → `sourceGroupId` (wichtigster Fallstrick)

- `ActivityImport` kennt kein `sourceGroupId`; `checkImport` **verwirft unbekannte Felder**.
- Daher wird vor dem Import eine Map `lineNumber → transferGroupId` aus dem
  **ursprünglichen** `parseResult.activities` gebaut (`lineNumber` überlebt `checkImport`).
- Beim `create`/`update` wird daraus `sourceGroupId` gesetzt.
- Weil das Addon Aktivitäten einzeln anlegt (nicht über die Bulk-Import-Pipeline),
  läuft Wealthfolios automatische Transfer-Verknüpfung nie – die explizite
  `sourceGroupId` ist die einzige Verknüpfung.

**Konsequenz:** Wer `lineNumber`-Vergabe, Sortierung oder Filterung *zwischen*
`transform()` und `handleImport` ändert, muss diese Zuordnung mitprüfen.

### 6.4 Duplikaterkennung durch Wealthfolio (`idempotencyKey`)

Die Erkennung passiert nicht im Addon, sondern in Wealthfolio (Rust-Kern,
`crates/core/src/activities/idempotency.rs` und `activities_service.rs`, geprüft am
Wealthfolio-Quellcode vom 04.10.2026). `checkImport` bildet je Aktivität einen
SHA-256-Fingerabdruck und sucht ihn unter den gespeicherten Aktivitäten:

| Feld im Fingerabdruck | Hinweis |
|---|---|
| Konto, Aktivitätstyp | – |
| Datum | **nur der Tag**, ohne Uhrzeit |
| Wertpapier | Asset-UUID, falls das Asset existiert, sonst `symbol@MIC` bzw. `symbol` |
| Menge, Stückpreis, `amount`, Gebühr (wenn ≠ 0) | **exakte** Dezimalwerte (Absolutbeträge, ohne Rundung). **`tax` ist nicht enthalten** |
| Währung | – |
| Kommentar | Leerzeichen normalisiert |

Folgen für das Addon:
- **Kommentar mit `timeTag`** (5.3): sonst würden gleichartige Buchungen am selben Tag
  zusammenfallen.
- **`amount` bei `BUY`/`SELL`** (5.5 Nr. 7): Fehlt er, leitet Wealthfolio ihn beim
  Anlegen ab und speichert ihn im Fingerabdruck – `checkImport` hasht aber den
  eingereichten (leeren) Wert. Bis 2.0.1 wurden Trades deshalb bei einem erneuten Import
  **nicht** als Duplikat erkannt und doppelt angelegt. Seit 2.0.2 schickt das Addon genau
  den Wert, den Wealthfolio ableiten würde (`tradeFinalCash`); damit werden auch Trades
  aus älteren Versionen erkannt.
- Jede Änderung an Menge, Preis, Gebühr, Betrag, Kommentar oder Zeitstempel-Tag einer
  bestehenden Mapping-Regel ändert den Fingerabdruck: Bereits importierte Aktivitäten
  werden dann beim nächsten Import **nicht** mehr als Duplikat erkannt. Solche
  Änderungen sind deshalb verhaltensändernd und im CHANGELOG zu vermerken. Beispiel:
  2.4.0 bucht Fremdwährungs-Dividenden in EUR statt USD – die mit älteren Versionen
  importierten müssen vor dem Neuimport gelöscht werden (CHANGELOG „Upgrade note“).
  Ebenso 2.6.0: Steuer in `tax` statt in `fee` bzw. als eigene Zeile ändert `fee` bei
  Verkäufen mit Steuer und `amount` (netto statt brutto) bei Dividenden und Zinsen mit
  Steuer.

---

## 7. Security-Mapping: `SecurityMappingStep.tsx`

Kontrollierte Komponente – der Zustand (`Map<isin, SecurityMapping>`) liegt in `ImportPage`.

- `SecurityMapping = SymbolSearchResult | "custom"` (`types.ts`).
- `TickerSearchInput`: debounced (350 ms) `ctx.api.market.searchTicker(query)`,
  vorbelegt mit dem Wertpapiernamen (jüngster Name aus der Datei; ohne Namen die ISIN), zeigt max. 8 Treffer, markiert bereits existierende Assets.
- Pro Zeile: Ticker wählen, „Custom" (ISIN bleibt Symbol) oder Zuordnung löschen.
- „Mark All Custom" und „Continue" (erst aktiv, wenn alles aufgelöst).
- Callbacks: `onMappingsChange`, `onComplete(mappings)`, `onBack`.
  Persistenz macht `ImportPage.handleMappingsComplete` (merge in `settings.securityMappings` + `saveSettings`).

---

## 8. Konfiguration: `settings.ts` und `SettingsPage.tsx`

### 8.1 Datenmodell (`AddonSettings`)

```ts
{
  cashAccountId: string;          // Wealthfolio-Konto vom Typ CASH
  cashCurrency: string;           // Währung des Cash-Kontos (Default "EUR")
  portfolioAccountId: string;     // Wealthfolio-Konto vom Typ SECURITIES
  scalableCashAccountId: string;      // seit 1.4.0: eigenes Kontenpaar für Scalable Capital
  scalableCashCurrency: string;
  scalablePortfolioAccountId: string;
  transferPatterns: TransferPattern[];            // { iban?, keyword?, label, destinationAccountId? }
  securityMappings: Record<string, SecurityMapping>; // ISIN → Ticker | "custom"
}
```

### 8.2 Persistenz

- Gespeichert als **ein JSON-String** unter dem Schlüssel `"config"` via
  `ctx.api.secrets.get/set`.
- `loadSettings` merged gespeicherte Werte über `DEFAULT_SETTINGS`
  (`{ ...DEFAULT_SETTINGS, ...JSON.parse(raw) }`) – **neue Felder brauchen daher nur
  einen Default in `DEFAULT_SETTINGS`**, ältere Konfigurationen bleiben kompatibel.
  Achtung: Das Merge ist flach; verschachtelte Objekte werden nicht gemerged.
- Bei Lese-/Parsefehlern werden still die Defaults verwendet.

### 8.3 SettingsPage

- Lädt Konten (`accounts.getAll()`, nur aktive/nicht archivierte) und Settings.
- Zwei Karten für Konten: **Trade Republic** und **Scalable Capital**, jeweils gefiltert
  nach `accountType` (`CASH` / `SECURITIES`); beim Wählen eines Cash-Kontos wird
  `cashCurrency` bzw. `scalableCashCurrency` aus der Kontowährung übernommen.
- Editor für Transfer-Patterns (IBAN, Keyword, Label, Zielkonto).
- Liste gespeicherter Security-Mappings mit Einzel-Löschen und „Clear all"
  (nötig, weil der Skip-Pfad im Import keinen „Clear"-Button zeigt).
- Speichern erst nach Klick auf „Save settings". Pflicht: Für **mindestens einen** Broker
  sind beide Konten gesetzt, und kein Broker ist nur halb konfiguriert.
- Hinweis bei den Transfer-Patterns: Scalable-Exporte haben keine Gegen-IBAN, Patterns
  greifen dort nur über den Text in `Notiz`.

---

## 9. Berechtigungen (`manifest.json`)

Das Addon muss jede genutzte SDK-Funktion im Manifest deklarieren. Aktuelle Nutzung:

| Kategorie | Funktionen | Genutzt in |
|---|---|---|
| `accounts` | `getAll` | ImportPage, SettingsPage |
| `activities` | `checkImport`, `create`, `update` (`saveMany` deklariert, derzeit ungenutzt) | ImportPage |
| `assets` | `create` (deklariert; Assets entstehen implizit über `asset` im Create/Update) | – |
| `secrets` | `get`, `set` | settings.ts |
| `ui` | `sidebar.addItem`, `navigation.navigate`, `router.add`, `onDisable` | addon.tsx |
| `query` | `invalidateQueries` | ImportPage |
| `portfolio` | `update` | ImportPage |
| `market-data` | `searchTicker` | SecurityMappingStep |
| `network` | `request` (nur Host `api.github.com`, `manifest.network.allowedHosts`) | updateCheck.ts (seit 2.1.0) |

`ctx.api.storage` (Update-Cache) ist eine Grundfunktion und braucht keine Berechtigung.

**Neue SDK-Aufrufe ⇒ Eintrag in `permissions` ergänzen** (und Versions-Bump, da Manifest-Änderung).

---

## 10. Tests

- 112 Tests in drei Dateien; die UI (`*.tsx`) ist nicht getestet.
- **`src/transform.test.ts`** (73 Tests, Trade Republic): Unit-Tests erzeugen Zeilen über
  `row({...overrides})` mit einer festen `CONFIG`. Der Fixture-Test liest
  `src/__fixtures__/tr-sample.csv` und prüft Gesamtanzahl (26 Zeilen → 34 Aktivitäten +
  1 skipped) und einzelne Fälle, inkl. der Invariante „jedes interne Paar teilt eine
  `transferGroupId`" und des exakten `amount` bei `BUY`/`SELL`.
- **`src/scalable.test.ts`** (31 Tests, Scalable Capital): Zahlen- und Zeitzonen-Parser
  (Sommer/Winter), jeder Typ, Storno, Depotumzug, `SWAP_OUT`, Rückzahlung,
  Formaterkennung, `tradeFinalCash`, Fixture-Test mit
  `src/__fixtures__/scalable-sample.csv` (26 Zeilen → 33 Aktivitäten + 9 skipped,
  Endbestände). Die Tests laufen unabhängig von der Zeitzone des Rechners.
- **`src/updateCheck.test.ts`** (8 Tests): Versionsvergleich, Auswertung der GitHub-Antwort,
  Cache (frisch/abgelaufen), Verhalten bei blockierter oder fehlerhafter Anfrage – mit
  einem nachgebauten `ctx`.
- `CONFIG` in `transform.test.ts` und `scalable.test.ts` muss alle Felder von
  `AddonSettings` enthalten.
- Neue Transaktionstypen: **Fixture-Zeile ergänzen** (fiktive Daten, echtes Spaltenformat)
  und die Zähler im Fixture-Test anpassen (siehe `CONTRIBUTING.md`).

---

## 11. CI/CD und Release

| Workflow | Trigger | Schritte |
|---|---|---|
| `ci.yml` | PR auf `main` (außer Label `skip-ci`) | install → `type-check` → `test` → `build` |
| `release.yml` | Push auf `main` (außer `[skip-release]` in Commit-Message) | install → `type-check` → `test` → `bundle` → falls Tag `v<manifest.version>` fehlt: GitHub-Release mit CHANGELOG-Abschnitt, ZIP und `addon.js` |

**Release-Gate:** Ein Release entsteht nur durch Versions-Bump. Bei Logikänderungen
(`src/`, Manifest-Berechtigungen/Metadaten) Version in **`manifest.json` und
`package.json`** erhöhen und `CHANGELOG.md` (`## [x.y.z] - YYYY-MM-DD`) ergänzen.
Die Überschrift muss exakt diesem Format folgen, sonst findet der `awk`-Extraktor
keine Release-Notes.

---

## 12. Änderungsleitfaden (Rezepte)

### 12.1 Neuen TR-Transaktionstyp unterstützen

1. In `transform.ts` einen Zweig im passenden `category`-Block **vor** dem
   „Unknown …"-Fallback einfügen, mit `continue` abschließen.
2. Cash-Buchungen über `cashAct(...)` erzeugen, Kommentare mit `+ timeTag(dt)`.
3. Bewegt der Vorgang Geld **zwischen eigenen Konten** → TRANSFER-Paar mit
   gemeinsamer `transferGroupId` (`<präfix>-${r.transaction_id}`), Zeitversatz via `addSec`.
4. Ausgehend? → `matchPattern` wie bei den bestehenden Outbound-Typen.
   Eingehend? → schlicht `DEPOSIT`, kein Pattern-Matching.
5. Hängt die Bedeutung von **anderen Zeilen** ab (Storno, Gegenbuchung, Bestand vor
   einer Kapitalmaßnahme), gehört die Regel in `planSpecialRows` statt in die
   Hauptschleife.
6. Bargeld auf dem Portfolio-Konto nur in der Cash-Währung und vollständig umbuchen
   (5.5 Nr. 10); Kommentare bestehender Typen nicht ändern (5.5 Nr. 8).
7. Was nicht importiert wird, mit `kind` und – bei `missing` – `hint` melden (5.5 Nr. 6).
8. Unit-Test in `transform.test.ts` + Zeile in `tr-sample.csv`, Fixture-Zähler anpassen.
   Mit einem echten Export prüfen, dass das Cash-Konto auf den TR-Saldo kommt (Summe aus
   `amount + fee + tax` aller Zeilen) und das Portfolio-Konto kein Bargeld hält –
   der Export selbst kommt nicht ins Repo.
9. Versions-Bump (meist *minor*) + CHANGELOG.

### 12.2 Neues Einstellungsfeld

1. Feld in `AddonSettings` (`types.ts`) ergänzen.
2. Default in `DEFAULT_SETTINGS` (`settings.ts`) – sorgt für Rückwärtskompatibilität.
3. UI in `SettingsPage.tsx` (über `set({ … })`).
4. Nutzung in `transform.ts` (über `config`) bzw. `ImportPage.tsx`.
5. `CONFIG` in `transform.test.ts` **und** `scalable.test.ts` ergänzen (sonst Typfehler).

### 12.3 Neue Seite / Route

1. Komponente `XyPage({ ctx })` anlegen.
2. In `addon.tsx` per `ctx.router.add({ path: \`/addon/${ADDON_ID}/xy\`, render: (c) => renderInto(<Wrapper/>, c) })`
   registrieren – **immer `renderInto` nutzen** (gemeinsamer Root).
3. Link in `Nav` ergänzen.
4. Neue SDK-Funktionen im Manifest deklarieren.

### 12.4 Neuer SDK-Aufruf

1. Funktion in `manifest.json` → `permissions` (passende `category`) eintragen.
2. Bei neuem Host-Paket: `vite.config.ts` (`external`), `package.json`
   (`peerDependencies` + `devDependencies`), `manifest.json` (`hostDependencies`).

### 12.5 Import-Verhalten ändern (Duplikate, Batch, Fortschritt)

- Alles in `ImportPage.handleImport`. Die `lineNumber → transferGroupId`-Zuordnung
  (6.3) muss erhalten bleiben.
- Ein Umstieg auf `activities.saveMany` / Bulk-Import würde Wealthfolios eigenen
  Transfer-Linker aktivieren – dann `sourceGroupId`-Logik neu bewerten.
- Duplikaterkennung hängt am Fingerabdruck aus 6.4 – Felder, die in ihn eingehen,
  nicht nebenbei ändern.

### 12.6 Neuen Broker (neues CSV-Format) anbinden

1. **Zeilentyp** in `types.ts` (wie `ScRow`), **Transformer** `src/<broker>.ts` mit
   Signatur `(rows, config) => TransformResult`; Helfer aus `common.ts` nutzen
   (`makeCashAct`, `matchPattern`, `addSec`, `timeTag`, `sortAndNumber`,
   `tradeFinalCash`).
2. **Alle Invarianten aus 5.5** einhalten, insbesondere eigene Präfixe für
   `transferGroupId` (z. B. `xy-buy-`), stabile IDs ohne Zeilennummer, `amount` bei Trades,
   Zeitstempel in UTC.
3. **`formats.ts`:** neuen Wert in `ImportFormat` und `FORMAT_LABEL`, Erkennung in
   `detectFormat` (eindeutiges Merkmal der Kopfzeile), Kontenpaar in `formatAccounts`,
   Parsen + Aufruf in `parseAndTransform`.
4. **Einstellungen:** eigenes Kontenpaar in `AddonSettings` + `DEFAULT_SETTINGS`
   (Rezept 12.2), Karte in `SettingsPage.tsx`, Speicherprüfung und
   „Settings not configured"-Prüfung in `ImportPage.tsx` um den Broker erweitern,
   Kontonamen in `accountName`.
5. **Tests + Fixture** mit erfundenen Daten im echten Format; Doku (diese Datei,
   README, `CLAUDE.md`), CHANGELOG, Minor-Bump.

---

## 13. Bekannte Schwachstellen / Refactoring-Kandidaten

Diese Punkte sind **beobachtet, nicht behoben** – relevant als Ausgangspunkt für Änderungen:

1. **Dreifach duplizierter Outbound-Pattern-Block** (`CUSTOMER_OUTBOUND_REQUEST`,
   `TRANSFER_DIRECT_DEBIT_INBOUND`, `TRANSFER_OUTBOUND/INSTANT`) – Kandidat für eine
   Hilfsfunktion `outboundTransfer(r, …)`. Leichte Unterschiede beim Kommentar
   (mit/ohne `cpname`) beachten.
2. **`transform()` als lange `if`-Kaskade** – für viele neue Typen wäre eine
   Handler-Tabelle `Record<string, (row) => Activity[]>` übersichtlicher.
3. **`ImportPage.tsx` (~900 Zeilen)** mischt UI und Logik; `applySecurityMappings`,
   `activityStatus` und der Payload-Bau in `handleImport` ließen sich in ein
   testbares Modul (z. B. `importer.ts`) auslagern.
4. **Sequenzieller Import**: ein SDK-Aufruf pro Aktivität – langsam bei großen
   Dateien; Fehler pro Aktivität werden nur gezählt, nicht angezeigt (Backlog #11).
5. **`saveMany` und `assets.create`** sind deklariert, aber ungenutzt.
6. **Keine UI-Tests**; abgesichert sind nur die Transformer, `formats.ts` und
   `tradeFinalCash`. Insbesondere die Zusammenarbeit mit Wealthfolio (`checkImport`,
   Anlegen von Aktivitäten) ist nur am echten Addon prüfbar.
7. **STOCKPERK-Zuordnung** ist O(n·m) und matcht nur über Symbol/Datum/Betrag –
   bei zwei identischen Käufen am selben Tag gewinnt der erste.
8. ~~**`opencode.yml`** war kein gültiges YAML~~ – erledigt: der Workflow wurde
   entfernt (nach 2.2.0, ohne Versionssprung).
9. **Doppelte Trades aus Versionen ≤ 2.0.1:** Wer eine Datei damals erneut importiert hat,
   hat doppelte `BUY`/`SELL` in Wealthfolio (siehe 6.4). Das Addon bereinigt sie nicht.
10. **Scalable-Annahmen** (14.3, „Offene Einzelfälle") sind nur an einem echten Export
    geprüft.
11. **Kein echtes Auto-Update:** Ohne Listung im Wealthfolio-Store kann das Addon neue
    Versionen nur anzeigen (4.2); Download und „Install from File" bleiben manuell.
    `UpdateBanner` ist nur im echten Addon prüfbar (Netzwerkfreigabe, Sandbox).
12. **TR-Kapitalmaßnahmen:** Bestand und Einstandswert für Wertpapierwechsel und Splits
    (Stufen 2 und 3) stammen aus der importierten Datei – bei unvollständiger Historie werden die
    Zeilen übersprungen; ein späterer Import mit längerer Historie kann einen anderen
    `unitPrice` ergeben und wird dann nicht als Duplikat erkannt.
13. **Nur am Wealthfolio-Quellcode geprüft, nicht im echten Wealthfolio:** `SPLIT` mit
    dem Verhältnis in `amount`, `DIVIDEND_IN_KIND`, `SELL` zu 0 (`WORTHLESS`) und
    `quoteMode: "MANUAL"` für „custom“-Aktien. Erst ein echter Import zeigt, ob
    `checkImport` sie annimmt. Dasselbe gilt für das Feld `tax` (seit 2.6.0).
14. **Scalable Capital fasst Gebühr und Steuer bei Trades noch zu `fee` zusammen** und
    bucht Dividenden ohne Steueraufteilung (14.3). Eine Angleichung an 2.6.0 würde dort
    ebenfalls Duplikat-Fingerabdrücke ändern.

---

## 14. Scalable-Capital-CSV als Eingangsformat

> **Status: umgesetzt in Version 1.4.0.** Dieser Abschnitt wurde vor der Umsetzung als
> Plan geschrieben und beschreibt alle Änderungen, um zusätzlich Transaktionsexporte von **Scalable Capital**
> (Datei `scalable_transactions_export_<Datum>_de.csv`) zu importieren.
> Grundlage ist ein echter Export mit 240 Zeilen (2020–2026), dessen Struktur
> unten zusammengefasst ist. Personenbezogene Daten aus diesem Export (Depot-IDs,
> Order-IDs, Referenznummern) dürfen **nicht** in Fixture oder Tests landen.

**Legende:** **[Δ]** = Unterschied zum Trade-Republic-Format bzw. zum heutigen Verhalten,
**[=]** = identisch / wiederverwendbar, **[NEU]** = Konzept, das es heute nicht gibt,
**[?]** = Annahme, die vor der Umsetzung bestätigt werden sollte.

### 14.1 Entscheidungen vor der Umsetzung

Alle vier Empfehlungen wurden bestätigt und so umgesetzt.

| # | Frage | Empfehlung | Begründung |
|---|---|---|---|
| A | Trade Republic **ersetzen** oder Scalable **zusätzlich** unterstützen? | **Zusätzlich**, Format wird automatisch an der Kopfzeile erkannt | Bestehende TR-Imports und Tests bleiben unverändert; kein Bruch für bestehende Installationen. |
| B | Gleiche Wealthfolio-Konten für beide Broker oder **eigenes Kontenpaar** pro Broker? | **Eigenes Kontenpaar** für Scalable (Cash + Depot) | Wer beide Broker nutzt, würde sonst Scalable-Buchungen in die TR-Konten importieren. |
| C | Depotumzug-/Storno-Buchungen ohne Nettoeffekt (siehe 14.4) | **Paarweise verrechnen und als `skipped` melden** | Sonst entstehen künstliche Ein-/Ausbuchungen, die den Einstandswert verfälschen. |
| D | Addon-Name/Beschriftung | In 1.4.0 blieb die `id` `trade-republic-importer`; nur `name`, `description`, Sidebar-Label und Texte wurden allgemeiner. **Nachtrag:** Mit der Umbenennung in `broker-importer` (siehe 4.1) wurde die `id` bewusst geändert. | Eine neue `id` ist für Wealthfolio ein anderes Addon; gespeicherte Einstellungen (`secrets`) gehen dabei verloren. |

### 14.2 Formatvergleich (Datei-Ebene)

| Merkmal | Trade Republic (heute) | Scalable Capital | |
|---|---|---|---|
| Trennzeichen | `,` | `;` | **[Δ]** |
| Kodierung / Zeilenende | UTF-8, LF | UTF-8 **mit BOM**, CRLF | **[Δ]** BOM muss vor dem Header-Vergleich entfernt werden |
| Kopfzeile | englisch, `snake_case` (`datetime,date,…,transaction_id,…`) | deutsch: `Datum;Uhrzeit;Typ;Wertpapiername;ISIN;Wert;Stück;Buchungswährung;Gebühren;Steuern;Bruttobetrag;Notiz` | **[Δ]** dient zur Formaterkennung |
| Dezimalzeichen | `.` | `,` (z. B. `-3894,15`, `12,933359`) | **[Δ]** eigener Zahlenparser |
| Zeitstempel | eine Spalte `datetime`, ISO 8601 in UTC | `Datum` (`TT.MM.JJJJ`) + `Uhrzeit` (`HH:MM:SS`) in **Ortszeit Europe/Berlin** | **[Δ]** Umrechnung nach UTC nötig (Sommer-/Winterzeit) |
| Sonderfall Datum | – | `Datum` enthält vereinzelt zusätzlich ` 00:00:00` (z. B. `08.09.2026 00:00:00`) | **[Δ]** nur die ersten 10 Zeichen verwenden |
| Uhrzeit bei reinen Buchungen | echte Uhrzeit | `01:00:00` (Winter) bzw. `02:00:00` (Sommer) = Mitternacht UTC | **[Δ]** nur Trades haben echte Uhrzeiten |
| Sortierung | aufsteigend | **neueste zuerst** | **[=]** `transform` sortiert ohnehin |
| Kategorie + Typ | zwei Spalten `category` + `type` | eine Spalte `Typ`, gemischt deutsch/englisch (`Kauf`, `TAX`, `SWAP_OUT`, …), bei Wertpapierüberträgen **leer** | **[Δ]** |
| Wertpapier-ID | `symbol` (= ISIN) | `ISIN` | **[=]** inhaltlich gleich, ISIN bleibt Platzhalter-Symbol bis zum Security-Mapping |
| Wertpapiername | `name` | `Wertpapiername` (variiert über die Jahre, z. B. „… UCITS ETF" vs. „… (Acc)") | **[Δ]** Name nur zur Anzeige, nie als Schlüssel |
| Stückzahl | `shares` | `Stück` (Dezimalkomma, Sparpläne mit Bruchstücken) | **[Δ]** Format |
| Kurs | `price` | **fehlt** → `Bruttobetrag / Stück` | **[Δ]** |
| Betrag | `amount` (vorzeichenbehaftet) | `Wert` (vorzeichenbehaftet, Bedeutung je Typ siehe 14.3) | **[Δ]** |
| Gebühren / Steuern | `fee`, `tax` (negativ) | `Gebühren`, `Steuern` (**positiv**) | **[Δ]** Vorzeichen |
| Eindeutige ID | `transaction_id` (UUID) | **keine**; `Notiz` enthält bei Trades die Order-ID, sonst Referenz + Freitext | **[Δ]** **[NEU]** ID muss abgeleitet werden (14.6) |
| Gegenkonto | `counterparty_name`, `counterparty_iban` | **fehlt** | **[Δ]** Transfer-Patterns nur über `keyword` auf `Notiz` |
| Fremdwährung | `original_amount`, `original_currency`, `fx_rate` | nur `Buchungswährung` (im Beispiel immer EUR) | **[Δ]** Dividenden nur netto in EUR, keine Quellensteuer-Aufteilung |
| Anlageklasse | `asset_class` (`STOCK`/`FUND`) | **fehlt** | **[Δ]** `instrumentType` bleibt leer, bis das Security-Mapping ihn setzt |
| Karte, Saveback, Stockperk, MCC | vorhanden | **fehlt** | **[Δ]** diese Zweige werden nicht gebraucht |

Verifiziert über alle Zeilen des Beispiel-Exports:
- `Kauf`: `Wert = −(Bruttobetrag + Gebühren + Steuern)`
- `Verkauf`: `Wert = Bruttobetrag − Gebühren − Steuern`

### 14.3 Mapping-Tabelle Scalable → Wealthfolio

`C` = Scalable-Cash-Konto, `P` = Scalable-Depotkonto (Entscheidung B), `t` = Zeitstempel in UTC.
Alle Zeit-Versätze (`addSec`) und `transferGroupId`-Regeln aus 5.5 gelten unverändert.

| Scalable `Typ` | Häufigkeit im Beispiel | Erzeugte Aktivitäten | TR-Gegenstück | |
|---|---|---|---|---|
| `Kauf` | 91 | C `TRANSFER_OUT` (t−2s, \|Wert\|) → P `TRANSFER_IN` (t−1s) → P `BUY` (t; `quantity`=Stück, `unitPrice`=Bruttobetrag/Stück, `fee`=Gebühren+Steuern, `amount`=`tradeFinalCash`) | `TRADING/BUY` | **[=]** Logik, **[Δ]** Feldquellen |
| `Verkauf` | 10 | P `SELL` (t, `amount`=`tradeFinalCash`) → P `TRANSFER_OUT` (t+1s, Wert) → C `TRANSFER_IN` (t+2s) | `TRADING/SELL` | **[=]** Logik, **[Δ]** Feldquellen |
| `Dividende` (Wert > 0) | 47 | P `DIVIDEND` (amount=Wert, quantity="1") → P `TRANSFER_OUT` → C `TRANSFER_IN` | `CASH/DIVIDEND` | **[Δ]** keine Steuer-/FX-Aufteilung |
| `Dividende` (Wert < 0, `Notiz` enthält `CANCEL-<Ref>`) | 1 | **Storno:** Stornozeile **und** die ursprüngliche Dividende (gleiche ISIN, gleicher Betrag, `Notiz` enthält `<Ref>`) → beide `skipped`; die Neubuchung bleibt | – | **[NEU]** |
| `Zinsen` | 9 | C `INTEREST` | `INTEREST_PAYMENT` | **[=]** |
| `Einlage` | 21 | C `DEPOSIT` (immer, ohne Pattern-Prüfung) | `CUSTOMER_INBOUND` | **[=]** Eingangs-Regel |
| `Entnahme` | 6 | ohne Pattern: C `WITHDRAWAL`; mit Pattern (nur `keyword` auf `Notiz`): C `TRANSFER_OUT` (+ Zielkonto `TRANSFER_IN`) | `TRANSFER_OUTBOUND` | **[Δ]** kein IBAN-Abgleich |
| `TAX` (negativ, z. B. Vorabpauschale) | 19 | C `TAX` (\|Wert\|) | – (TR nur als Teil anderer Zeilen) | **[NEU]** |
| `Steuerrückerstattung` | 1 | C `CREDIT`, `subtype = TAX_REFUND` | – | **[NEU]** |
| `FEE` (z. B. „Entgelt PRIME+ Broker") | 8 | C `FEE` (\|Wert\|) | `CARD_ORDERING_FEE` | **[=]** |
| `SWAP_OUT` + leere Zeile mit gleicher `WWUM`-Referenz | 1 | **Fondsauflösung/Zwangsumtausch:** P `SELL` (Stück aus der Wertpapierzeile, Erlös = Wert der `SWAP_OUT`-Zeile) → P→C Transferpaar | – | **[NEU]** |
| `Dividende` + leere Zeile mit `Wert = 0` (gleiche ISIN, gleicher Tag, gleiche Referenz) | 1 | **Rückzahlung/Knock-out eines Zertifikats:** P `SELL` (Stück aus der Wertpapierzeile, Erlös = Wert der Dividende) → P→C Transferpaar | – | **[NEU]** **[?]** |
| leer (Wertpapierübertrag), paarweise verrechenbar | 24 | → `skipped` („Depotumzug/Umbuchung ohne Nettoeffekt"), siehe 14.4 | `DELIVERY/MIGRATION` | **[Δ]** Erkennung über Paare statt Typ |
| leer, nicht verrechenbar, Eingang | 0 | P `TRANSFER_IN` (Wertpapier, `unitPrice` = Wert/Stück) | `DELIVERY/FREE_RECEIPT` | **[=]** |
| leer, nicht verrechenbar, Ausgang | 0 | P `TRANSFER_OUT` (Wertpapier) | – | **[NEU]** |
| `Einlage` mit `SWITCH-` in `Notiz` + `Entnahme` gleichen Betrags (±7 Tage) | 1 Paar | beide → `skipped` (Cash-Teil des Depotumzugs) | – | **[NEU]** **[?]** |
| unbekannter `Typ` | – | → `skipped` („Unknown Scalable type") | Unknown category | **[=]** |

**[?] Offene Einzelfälle aus dem Beispiel:**
- `Einlage` 142,92 € mit `…-EUR-DISTRIBUTION-RKN` im Zuge des Depotumzugs: umgesetzt als normale `DEPOSIT`. **Weiterhin offen** – falls das eine Ausschüttung ist, wäre `DIVIDEND` richtiger.
- Rückzahlung eines Zertifikats (`Wert = 0` + `Dividende`): umgesetzt als `SELL`; die Erkennung beruht auf einem einzigen Beispiel.
- `instrumentType` wird für Scalable-Wertpapiere nicht gesetzt (keine Anlageklasse im Export); er kommt aus dem Security-Mapping. Bei „Custom"-Mapping bleibt er leer.
- `Entnahme`/`Einlage` gleichen Betrags an aufeinanderfolgenden Tagen ohne `SWITCH-` (z. B. 2.000 € am 14./15.08.2025) bleiben echte Ein-/Auszahlungen.

### 14.4 Wertpapierüberträge (leerer `Typ`) – Verrechnungsregel [NEU]

Beim Depotumzug (Dezember 2025) und bei Korrekturen bucht Scalable Positionen aus und
wieder ein. Das Vorzeichen von `Wert` ist dabei **nicht** immer die Richtung:

| Erkennungsmerkmal | Richtung |
|---|---|
| `Notiz` beginnt mit `CANCEL-` | Ausgang (storniert einen früheren Eingang, obwohl `Wert` positiv ist) |
| `Wert < 0` (z. B. `WWUM …`) | Ausgang |
| `Wert > 0` (`SWITCH-…`, `CORR-SWITCH-…`, `WWUM …`) | Eingang |
| `Wert = 0` | Ausgang (Rückzahlung, siehe 14.3) |

Algorithmus (pro ISIN):
1. Ausgänge und Eingänge mit **gleicher Stückzahl** paaren, jeweils mit dem zeitlich
   nächsten Gegenstück innerhalb von **7 Tagen**.
2. Gepaarte Zeilen → `skipped` mit Grund „Depotumzug/Umbuchung ohne Nettoeffekt".
3. Ungepaarte Ausgänge → zuerst Sonderfälle aus 14.3 prüfen (`SWAP_OUT`, Rückzahlung),
   sonst Wertpapier-`TRANSFER_OUT`.
4. Ungepaarte Eingänge → Wertpapier-`TRANSFER_IN`.

Ergebnis für den Beispiel-Export: alle 24 Umzugs-/Korrekturzeilen heben sich auf
(z. B. EMQQ: 4 Ausgänge, 4 Eingänge à 75 Stück), Bestände bleiben korrekt.

### 14.5 Änderungen an Modulen

```mermaid
flowchart TD
    IP[ImportPage.tsx] --> F[formats.ts NEU<br/>detectFormat / parseAndTransform]
    F --> TR[transform.ts<br/>Trade Republic]
    F --> SC[scalable.ts NEU<br/>transformScalable]
    TR --> CM[common.ts NEU<br/>gemeinsame Helfer]
    SC --> CM
```

| Datei | Änderung | |
|---|---|---|
| `src/common.ts` | **neu**: `makeCashAct`, `fmtAmt`, `addSec`, `timeTag`, `matchPattern`, `isCashSymbol` aus `transform.ts` hierher verschieben | **[Δ]** reine Verschiebung, Verhalten unverändert |
| `src/transform.ts` | importiert Helfer aus `common.ts`; Logik **unverändert** | **[=]** |
| `src/scalable.ts` | **neu**: `transformScalable(rows: ScRow[], config): TransformResult`, Zahlen-/Datumsparser, Storno-/Umzugs-Verrechnung | **[NEU]** |
| `src/formats.ts` | **neu**: `detectFormat(text)` (BOM entfernen, Kopfzeile vergleichen) und `parseAndTransform(text, settings)` → `{ format, result }`; wählt Trennzeichen und Transformer | **[NEU]** |
| `src/types.ts` | `ScRow` (Spalten 14.2); `AddonSettings` um Scalable-Konten erweitern (Entscheidung B), z. B. `scalableCashAccountId`, `scalablePortfolioAccountId` | **[Δ]** |
| `src/settings.ts` | Defaults für die neuen Felder (Rückwärtskompatibilität über das bestehende Merge, siehe 8.2) | **[Δ]** |
| `src/SettingsPage.tsx` | zweite Karte „Scalable Capital accounts"; Pflichtprüfung nur für die Konten des genutzten Brokers | **[Δ]** |
| `src/ImportPage.tsx` | `Papa.parse` + `transform()` durch `parseAndTransform()` ersetzen; erkanntes Format anzeigen; Fehlermeldung bei unbekannter Kopfzeile; Prüfung „Settings not configured" je Format; Texte allgemeiner | **[Δ]** |
| `src/addon.tsx` | Sidebar-Label allgemeiner (z. B. „Broker Import") | **[Δ]** Entscheidung D |
| `manifest.json` | `name`/`description`/`keywords` anpassen, `id` **unverändert**; keine neuen Berechtigungen nötig (die `id` wurde später in 2.0.0 geändert, siehe 4.1) | **[Δ]** |
| `src/scalable.test.ts` | **neu**: Unit-Tests je Typ + Fixture-Test | **[NEU]** |
| `src/__fixtures__/scalable-sample.csv` | **neu**: erfundene Daten im echten Format (`;`, Dezimalkomma, BOM, CRLF), deckt jeden Typ und einen Depotumzug ab | **[NEU]** |
| `README.md`, `CLAUDE.md`, `CHANGELOG.md` | Scalable-Export-Anleitung, neue Dateien, Changelog | **[Δ]** |
| Version | **Minor-Bump auf 1.4.0** (neue Funktion, rückwärtskompatibel) | |

Unverändert blieben in 1.4.0: `SecurityMappingStep.tsx` (arbeitet mit ISINs, die auch
Scalable liefert), die Import-Schleife inkl. `lineNumber → transferGroupId → sourceGroupId`
(6.3) und die Duplikaterkennung über `checkImport`. Spätere Änderungen daran siehe
Abschnitt 15 (Suchfeld mit Namen in 2.0.1, `amount` bei Trades in 2.0.2).

### 14.6 Neue Invarianten für `scalable.ts`

1. **Stabile IDs ohne `transaction_id`** [NEU]: `Kauf`/`Verkauf` nutzen die Order-ID aus
   `Notiz`; alle anderen Zeilen einen Hash aus `Datum|Uhrzeit|Typ|ISIN|Wert|Notiz`.
   **Nicht** die Zeilennummer verwenden – neue Exporte fügen Zeilen oben ein.
2. **Eigene Präfixe für `transferGroupId`** [Δ]: `sc-buy-`, `sc-sell-`, `sc-div-`,
   `sc-swap-`, `sc-xfer-`, damit sie nie mit TR-IDs kollidieren.
3. **Zeitzone** [NEU]: `Datum`+`Uhrzeit` werden als Europe/Berlin interpretiert und mit
   `Intl` nach UTC umgerechnet – nicht mit der Zeitzone des Rechners (CI läuft in UTC).
4. **Kommentare** enthalten `Notiz` bzw. Wertpapiername plus `timeTag`, damit gleiche
   Beträge am selben Tag (z. B. mehrere `TAX`-Zeilen um 01:00) unterscheidbar bleiben.
5. Alle Invarianten aus 5.5 gelten weiter.

### 14.7 Umsetzungsreihenfolge (erledigt)

1. `common.ts` herauslösen; TR-Tests müssen unverändert grün bleiben.
2. `scalable.ts` + Fixture + Tests (testgetrieben, ohne UI).
3. `formats.ts` + `ImportPage.tsx` anbinden.
4. Settings (Entscheidung B) + Texte/Manifest (Entscheidung D).
5. Doku (dieser Abschnitt wird zur Ist-Beschreibung), CHANGELOG, Version 1.4.0.

### 14.8 Ergebnis der Umsetzung

- Probelauf mit dem echten Export (240 Zeilen): 506 Aktivitäten, 28 übersprungene Zeilen
  (24 Umzugs-/Korrekturzeilen, 2 Dividenden-Storno, 2 Cash-Teil des Umzugs); kein
  Depotbestand wird negativ.
- Tests: `src/scalable.test.ts` (in 1.4.0 29 Tests, seit 2.0.2 31: Parser, Zeitzone inkl.
  Sommer/Winter, jeder Typ, Storno, Umzug, `SWAP_OUT`, Rückzahlung, Formaterkennung,
  `tradeFinalCash`, Fixture-Integration).
  Die Tests laufen unabhängig von der Zeitzone des Rechners.
- Seit 2.5.0 tragen auch Scalable-Zeilen in `skipped` ein `kind`: Storno, Depotumzug
  und Umzugs-Bargeld sind `netted`; unbekannter Typ, `SWAP_OUT` ohne Gegenzeile, Zeile
  ohne Typ und ISIN sowie negative Dividende ohne Original sind `missing` mit Hinweis.
- Rezept für neue Scalable-Typen: neuen `case` in Pass 4 von `transformScalable`
  ergänzen (bzw. einen eigenen Pass, wenn Zeilen paarweise verrechnet werden müssen),
  Zeile in `scalable-sample.csv` und Zähler im Fixture-Test anpassen.

---

## 15. Änderungshistorie seit 1.3.3

Überblick über alle Änderungen, die nach der ersten Fassung dieses Dokuments (Stand
1.3.3) umgesetzt wurden. Details stehen in `CHANGELOG.md` und in den genannten Abschnitten.

| Version | Art | Änderung | Betroffene Dateien | Abschnitt |
|---|---|---|---|---|
| 1.3.4 | Fix | Cash-Aktivitäten werden für **jede** Cash-Währung erkannt (vorher fest `$CASH-EUR`; bei Nicht-EUR-Konten landeten Cash-Buchungen im Security-Mapping). Neu: `isCashSymbol()`. | `common.ts` (damals `transform.ts`), `ImportPage.tsx` | 5.3, 6.2 |
| 1.4.0 | Feature | **Scalable Capital** als zweites Format: automatische Formaterkennung, eigenes Kontenpaar, Zeitzonen-Umrechnung, Verrechnung von Storno und Depotumzug. Helfer nach `common.ts` verschoben. | `formats.ts`, `scalable.ts`, `common.ts`, `types.ts`, `settings.ts`, `SettingsPage.tsx`, `ImportPage.tsx`, `addon.tsx`, `manifest.json` | 1, 3, 8, 14 |
| 2.0.0 | **Bruch** | Umbenennung in **Broker Importer**: Addon-ID `broker-importer` (vorher `trade-republic-importer`), Paket `broker-importer-addon`, Release-ZIP `broker-importer-addon.zip`, Links auf `waldonso2/wealthfolio-importer-addon`. Bestehende Installationen müssen neu installiert und neu eingerichtet werden. | `manifest.json`, `addon.tsx`, `package.json`, `release.yml`, Doku | 4.1 |
| 2.0.1 | Änderung | Suchfeld im Security-Mapping ist mit dem **Wertpapiernamen** (jüngster Name aus der Datei) statt der ISIN vorbelegt. | `SecurityMappingStep.tsx`, `ImportPage.tsx` | 6.2, 7 |
| 2.0.2 | Fix | Erneut importierte **`BUY`/`SELL`** werden als Duplikat erkannt (vorher doppelt angelegt). Trades tragen den exakten `amount` (`tradeFinalCash`). | `common.ts`, `transform.ts`, `scalable.ts` | 5.5 Nr. 7, 6.4 |
| 2.1.0 | Feature | **Update-Hinweis:** einmal täglich Abfrage der GitHub-Releases, Hinweis mit Download-Adresse, wenn eine neuere Version existiert. Neue Berechtigung `network` (nur `api.github.com`). | `updateCheck.ts`, `UpdateBanner.tsx`, `addon.tsx`, `manifest.json` | 4.2, 9 |
| 2.1.1 | Pflege | Autor `waldonso2` in `manifest.json`/`package.json`, `.github/FUNDING.yml` (Spenden an den ursprünglichen Autor) entfernt, MIT-Copyright des ursprünglichen Autors bleibt in `LICENSE`; README gekürzt und korrigiert, mit Credits für das Original-Addon. Kein Verhaltenswechsel. | `manifest.json`, `package.json`, `LICENSE`, `README.md` | – |
| 2.2.0 | Feature | Weitere TR-CASH-Typen: `DISTRIBUTION` und `EXCHANGE` wie Dividende, Vorabpauschale (`EARNINGS`, `PRE_DETERMINED_TAX_BASE`) und Steuerkorrekturen (`SEC_ACCOUNT`, `TAX_OPTIMIZATION`) als `TAX`/`CREDIT`-`TAX_REFUND`, `REFERRAL` als `CREDIT`/`BONUS`. | `transform.ts` | 5.4, 5.5 Nr. 8, 16 |
| 2.3.0 | Feature | TR-Kapitalmaßnahmen Stufe 2: Wertpapierwechsel (`SHARE_EXCHANGE`, `ADR_DISCONTINUATION`, `REORGANISATION`, `REVERSE_SPLIT`) als ungepaartes `TRANSFER_OUT`/`TRANSFER_IN` mit übertragenem Einstandswert (FIFO aus der Datei), `WORTHLESS` als `SELL` zu 0. | `transform.ts` | 5.4, 5.5 Nr. 9, 16.2 |
| 2.3.1 | Fix (kein eigenes Release) | Als „custom“ gemappte **Aktien** ohne Marktdaten (z. B. delistet) werden als manuell bepreist angelegt, statt von `checkImport` mit „Could not find … in market data“ abgelehnt zu werden – vorher scheiterten alle Aktivitäten einer solchen ISIN. | `ImportPage.tsx` | 6.2 |
| 2.4.0 | Fix (Datenänderung) | Dividenden in Fremdwährung werden in der Auszahlungswährung (EUR) gebucht statt in USD/ZAR mit `fxRate` – vorher blieben USD-/ZAR-Guthaben und ein EUR-Minus auf dem Portfolio-Konto. Negative Dividenden (Stornos) werden verrechnet bzw. übersprungen statt als positive Dividende gebucht. **Bereits importierte Fremdwährungs-Dividenden gelten nicht mehr als Duplikat** und müssen vor dem Neuimport gelöscht werden. | `transform.ts` | 5.4, 5.5 Nr. 10 |
| 2.5.0 | Feature | TR-Kapitalmaßnahmen Stufe 3: `SPLIT` als Wealthfolio-`SPLIT` (Verhältnis aus dem Bestand der Datei), `STOCK_DIVIDEND` als `DIVIDEND`/`DIVIDEND_IN_KIND` (+n/−n-Umbuchung verrechnet), `DIVIDEND_REINVESTMENT` mit seiner negativen Dividendenzeile als vom Cash-Konto finanzierter `BUY`. Übersprungene Zeilen tragen `kind` (`netted`/`missing`) und `hint`; die UI zeigt Status und Hinweis. Vorlauf `mapCorporateActions` + `dividendCorrections` → `planSpecialRows`. | `transform.ts`, `scalable.ts`, `types.ts`, `ImportPage.tsx` | 5.4, 5.5 Nr. 6, 16.3 |
| 2.6.0 | Änderung (Datenänderung) | TR: Gebühr und Steuer in eigenen Feldern (`fee`, `tax`). SELL/BUY: Steuer nicht mehr in `fee`; Steuererstattung als `CREDIT`/`TAX_REFUND`. DIVIDEND (inkl. Ausschüttung) und INTEREST: **eine** Aktivität mit Nettobetrag und `tax` statt Brutto-Aktivität plus `TAX`-Zeile. `handleImport` reicht `tax` an Wealthfolio weiter. **Bereits importierte Verkäufe mit Steuer, Dividenden und Zinsen mit Steuer gelten nicht mehr als Duplikat** – vor dem Neuimport löschen. | `common.ts`, `transform.ts`, `ImportPage.tsx` | 5.3, 5.4, 6.2, 6.4 |

Doku ohne Versionssprung: diese Architekturdatei (PR #1) und ihr Planungsabschnitt 14
(Teil von PR #3). Pipeline ohne Versionssprung: `opencode.yml` entfernt (nach 2.2.0).
2.3.1 wurde nicht als eigenes Release veröffentlicht (der Release-Lauf bekam keinen
Runner und wurde abgebrochen); die Änderung ist in v2.4.0 enthalten.

---

## 16. Nicht unterstützte Trade-Republic-Typen

Ein echter TR-Export (587 Zeilen) enthielt 95 Zeilen in 15 Typen, die bis 2.1.1 in
`skipped` landeten. Die CASH-Typen davon verschoben den Barbestand in Wealthfolio um
gut 900 €. Umsetzung in drei Stufen; Stand 2.5.0 sind alle 15 Typen abgebildet.

### 16.1 Stufe 1 – CASH-Typen (umgesetzt in 2.2.0)

| Typ | Bedeutung | Abbildung |
|---|---|---|
| `DISTRIBUTION` | Ausschüttung eines Fonds/ETFs; Spalten wie `DIVIDEND` (inkl. FX, Steuer) | wie `DIVIDEND` |
| `EXCHANGE` | Barausschüttung im Rahmen eines Aktientauschprogramms (z. B. Prosus) | wie `DIVIDEND` |
| `EARNINGS`, `PRE_DETERMINED_TAX_BASE` | Vorabpauschale (`amount` 0, nur `tax`); `PRE_DETERMINED_TAX_BASE` ist die ältere Bezeichnung | C `TAX` |
| `SEC_ACCOUNT` | Steuerbuchung zu einem Wertpapier, später ggf. per Gegenbuchung storniert | negativ C `TAX`, positiv C `CREDIT`/`TAX_REFUND` |
| `TAX_OPTIMIZATION` | Steuerausgleich (Verlustverrechnung), ohne Wertpapier | wie `SEC_ACCOUNT` |
| `REFERRAL` | Empfehlungsprämie | C `CREDIT`/`BONUS` |

Steuer-Stornos (`SEC_ACCOUNT` −x / +x) werden **nicht** verrechnet, sondern als `TAX` und
`CREDIT`/`TAX_REFUND` gebucht – der Saldo stimmt, und die Buchungen entsprechen dem Export.

### 16.2 Stufe 2 – einfache Kapitalmaßnahmen (umgesetzt in 2.3.0, #16)

`CORPORATE_ACTION` liefert nur Stückzahlen (`shares`), keine Beträge und keinen Einstandswert.

| Typ | Beispiel | Abbildung |
|---|---|---|
| `SHARE_EXCHANGE`, `ADR_DISCONTINUATION`, `REORGANISATION` | alte ISIN −n, neue ISIN +n zum selben Zeitpunkt | P `TRANSFER_OUT` (alte ISIN, t) + P `TRANSFER_IN` (neue ISIN, t+1s), **ohne** Gruppe; `unitPrice` beider Seiten = übertragener Einstandswert ÷ Stück |
| `REVERSE_SPLIT` | alte ISIN −25.000, neue ISIN +38,46 | wie oben (ISIN wechselt, daher kein `SPLIT`) |
| `WORTHLESS` | −15 Stück, wertlos ausgebucht | P `SELL` zu 0 (realisiert den Verlust), keine Cash-Umbuchung |

Entscheidungen bei der Umsetzung:

- **Kein Paar:** Wealthfolio prüft bei Übertrags-Paaren, dass beide Seiten dasselbe
  Wertpapier betreffen (`transfer_pairs.rs`, „security transfer legs use different
  assets"). Ein ungepaartes `TRANSFER_OUT` entnimmt die Lots zum Einstandswert (kein
  realisierter Gewinn), ein ungepaartes `TRANSFER_IN` legt einen Lot zu `unitPrice` an.
  Beide verschieben die Nettoeinlage um denselben Betrag in entgegengesetzte Richtung,
  in Summe also 0. Das ursprüngliche Kaufdatum geht dabei verloren (neuer Lot am
  Tauschtag).
- **Einstandswert aus der Datei:** `planSpecialRows()` (bis 2.4.0 `mapCorporateActions()`) läuft vor der Hauptschleife
  chronologisch über alle Zeilen und führt je ISIN FIFO-Lots wie Wealthfolio: `BUY` mit
  `tradeFinalCash`, `SELL` entnimmt FIFO, `FREE_RECEIPT` mit `shares × price`, ein
  Wertpapierwechsel überträgt die Kosten auf die neue ISIN. Hält die Datei weniger Stück
  als getauscht werden (unvollständige Historie), werden beide Zeilen mit Grund
  übersprungen, statt einen erfundenen Einstandswert zu buchen.
- An einem echten Export (7 Zeilen dieser Typen) gingen alle Einstandswerte auf.

### 16.3 Stufe 3 – Kapitalmaßnahmen mit Bestand oder Verrechnung (umgesetzt in 2.5.0, #17)

| Typ | Beispiel | Abbildung |
|---|---|---|
| `SPLIT` | +19 Stück (nur die **zusätzlichen** Stück, ISIN bleibt) | Wealthfolio-`SPLIT`, `amount` = Verhältnis (Bestand + n) ÷ Bestand (hier 1 → 20, also 20). Wealthfolio liest das Verhältnis aus `amount` (`portfolio-engine/compile.rs`). Die FIFO-Lots werden mitskaliert, damit spätere Wechsel stimmen |
| `STOCK_DIVIDEND` | +n; später +n/−n mit Valuta des ersten Eintrags (Umbuchung) | erstes +n als `DIVIDEND`/`DIVIDEND_IN_KIND` zum angegebenen Preis – Wealthfolio zerlegt das in Ertrag + `BUY` ohne Bargeldwirkung. Das +/−-Paar wird verrechnet (das −n hebt das zeitlich nächste +n auf) |
| `DIVIDEND_REINVESTMENT` | +0,73 Stück; dazu eine `CASH/DIVIDEND`-Zeile mit −23,20 € | Die Bardividende ist schon als Ertrag gebucht. Die Wiederanlage ist ein Kauf: C → P Umbuchung über die 23,20 € und `BUY` der Stücke (Preis = Betrag ÷ Stück). **Nicht** `DRIP`, denn das würde den Ertrag ein zweites Mal buchen |

An einem echten Export stimmt danach das Cash-Konto auf den Cent mit Trade Republic
überein, und das Portfolio-Konto hält kein Bargeld.

### 16.4 Ergebnis und Nebenbefunde

Mit 2.5.0 und dem echten Export von oben:

- Übersprungen bleiben 4 Zeilen, alle `netted` (ein Dividenden-Storno mit Neubuchung,
  eine Aktiendividenden-Umbuchung).
- Das Cash-Konto kommt auf den Cent auf den TR-Saldo (Summe aus `amount + fee + tax`
  aller Zeilen), das Portfolio-Konto hält kein Bargeld.

Beim Abgleich fielen drei Fehler außerhalb der neuen Typen auf und wurden behoben:

| Befund | Ursache | Behoben in |
|---|---|---|
| Alle Aktivitäten einer delisteten Aktie (VARTA) scheiterten mit „Could not find … in market data“ | „custom“-Mapping ohne `quoteMode: "MANUAL"` (6.2 Schritt 5) | 2.3.1 |
| Portfolio-Konto mit USD-/ZAR-Guthaben und EUR-Minus | Dividenden in Fremdwährung gebucht, Steuer und Umbuchung in EUR (5.5 Nr. 10) | 2.4.0 |
| Stornierte Dividenden als zusätzliche Dividende gebucht | `Math.abs` auf negativen Betrag | 2.4.0 |
