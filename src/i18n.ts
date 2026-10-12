import { createElement, Fragment, type ReactNode } from "react";
import { useAddonTranslation, type AddonTranslationBundle } from "@wealthfolio/addon-sdk";

// UI texts in English and German (#74). The language follows Wealthfolio's
// setting: inside the addon sandbox the SDK's translator serves these bundles
// (registered in addon.tsx), outside it (unit tests) a small local translator
// does the same with `{{var}}` interpolation and `_one`/`_other` plurals.
//
// Only UI text lives here. Activity comments, symbols and group ids go to
// Wealthfolio and stay as they are - comments are part of its duplicate
// fingerprint. Skip reasons keep their English text (`reason`, `hint`) and
// carry a key + params for the UI (`reasonKey`, `hintKey`, `params`).
//
// A param named `<name>Key` holds a translation key: its translation becomes
// `<name>` (e.g. `whenKey: "skip.when.sameDay"` → `when`), so a fragment like
// "the same day" is translated along with the sentence.

export type Params = Record<string, string | number | undefined>;
export type T = (key: string, params?: Params) => string;

// A message for the UI with its English text, for logic modules that return text.
export interface Msg {
  text: string;
  key: string;
  params?: Params;
}

const en = {
  nav: {
    import: "Import",
    settings: "Settings",
  },
  common: {
    back: "Back",
    continue: "Continue",
    cancel: "Cancel",
    close: "Close",
    custom: "Custom",
    existing: "Existing",
    loading: "Loading…",
    none: "None.",
    skip: "Skip",
    include: "Include",
    includeAll: "Include all",
    skipAll: "Skip all",
  },
  col: {
    date: "Date",
    type: "Type",
    description: "Description",
    status: "Status",
    reason: "Reason",
    account: "Account",
    symbol: "Symbol",
    amount: "Amount",
    error: "Error",
    security: "Security",
    isinSymbol: "ISIN / symbol",
    shares: "Shares",
    comment: "Comment",
  },
  account: {
    cash: "Cash account ({{broker}})",
    portfolio: "Securities account ({{broker}})",
  },
  upload: {
    title: "Import broker CSV or PDF statements",
    intro:
      "CSV: Trade Republic (Settings → Documents → Transaction history) or Scalable Capital (transaction export). PDF: trade and dividend statements from Trade Republic, Scalable Capital or DKB - select as many of one broker as you like. The broker is detected automatically.",
    drop: "Drop a CSV export or any number of PDF statements here",
    browse: "or click to browse",
    reading_one: "Reading {{count}} PDF…",
    reading_other: "Reading {{count}} PDFs…",
    pdfStatements: "{{count}} PDF statements",
    parsed_one: "{{count}} activity parsed",
    parsed_other: "{{count}} activities parsed",
    otherFile: "Upload different file",
    settingsLoading: "Settings are still loading.",
    unreadable: "Could not read the file.",
    oneCsv: "Upload one CSV export at a time, without PDFs.",
    wrongType:
      "Please upload a .csv export (Trade Republic, Scalable Capital) or .pdf statements (Trade Republic, Scalable Capital, DKB).",
    unrecognisedCsv: "Unrecognised CSV. Upload a transaction export from Trade Republic or Scalable Capital.",
    selectAccounts: "Select your {{broker}} cash and securities accounts in Settings first.",
    noRows: "No rows found in the {{broker}} export.",
    noPdfBroker: "None of the PDFs is a statement from Trade Republic, Scalable Capital or DKB.",
    mixedBrokers: "The PDFs come from different brokers ({{names}}). Upload the statements of one broker at a time.",
  },
  notConfigured: {
    title: "Settings not configured",
    text: "Please go to the <strong>Settings</strong> tab and select the Cash and Portfolio accounts for Trade Republic, Scalable Capital and/or DKB before importing.",
  },
  checking: {
    title: "Validating…",
    text: "Checking {{count}} activities for duplicates and errors…",
  },
  review: {
    title: "Review activities",
    ready: "{{count}} ready",
    alreadyIn: "{{count}} already in Wealthfolio",
    duplicates: "{{count}} duplicates",
    errors: "{{count}} errors",
    notImported: "{{count}} not imported",
    netted: "{{count}} netted out",
    matchError: "Could not compare with the activities already in Wealthfolio: {{error}} — check for double entries yourself.",
    checkError: "Validation warning: {{error}} — review manually.",
    importNew_one: "Import {{count}} activity",
    importNew_other: "Import {{count}} activities",
    updateOnly: "Update {{count}} existing",
    importAndUpdate: "Import {{new}} new · update {{update}} existing",
    existingBanner_one:
      "<strong>{{count}} transaction</strong> already in Wealthfolio from another import (e.g. CSV instead of PDF) — <strong>skipped</strong> unless included.",
    existingBanner_other:
      "<strong>{{count}} transactions</strong> already in Wealthfolio from another import (e.g. CSV instead of PDF) — <strong>skipped</strong> unless included.",
    suspicious_one: "Check this security mapping before importing",
    suspicious_other: "Check these security mappings before importing",
    suspiciousText:
      "A wrong mapping books the security onto another asset. Go back and change it, or correct it later in Settings → Security mappings, which can also move activities already booked onto the right asset.",
    duplicateBanner_one:
      "<strong>{{count}} duplicate</strong> already exists in Wealthfolio — will be <strong>updated</strong> unless skipped.",
    duplicateBanner_other:
      "<strong>{{count}} duplicates</strong> already exist in Wealthfolio — will be <strong>updated</strong> unless skipped.",
    tabActivities: "Activities ({{count}})",
    tabSkipped: "Skipped ({{count}})",
    tabHoldings: "Holdings ({{count}})",
    showingDuplicates: "Showing duplicates only ({{count}})",
    showDuplicates: "Show duplicates only ({{count}})",
    statusReady: "Ready",
    statusExisting: "In Wealthfolio",
    statusExistingTitle: "The same transaction is already in Wealthfolio, imported from another source (e.g. CSV vs. PDF)",
    statusDuplicate: "Duplicate",
  },
  skipped: {
    none: "No rows were skipped.",
    missing: "Not imported",
    netted: "No action needed",
  },
  reconcile: {
    cashChangePdf: "Cash account change from these statements",
    cashAfter: "Cash account after import",
    matches: "Matches the {{broker}} balance in the file",
    differs: "{{broker}} balance in the file: {{balance}} — differs by {{diff}}",
    differsNotImported: "(see the {{count}} not imported rows under Skipped)",
    leftover: "Cash left on the securities account",
    leftoverNone: "None",
    shouldBeZero: "{{amounts}} — should be 0",
    positions: "Positions after import",
    positionsCount: "{{count}} (see Holdings)",
    negativeItem: "{{name}} ({{shares}} on {{date}})",
    soldWithoutPurchase:
      "Sold without a purchase in these statements - fine if the position is already in Wealthfolio: {{list}}",
    negative: "Negative holdings — rows are missing or mapped wrongly: {{list}}",
    footPdf:
      "Computed from these statements only. They hold trades and dividends but no deposits or withdrawals, so the cash account doesn't show your {{broker}} balance.",
    footCsv:
      "Computed from this file only. Compare with your {{broker}} app; if the file doesn't cover the full history, the balance and holdings differ.",
    noPositions: "No positions.",
  },
  importing: {
    title: "Importing…",
    text: "Saving activities to Wealthfolio…",
  },
  done: {
    complete: "Import complete",
    issues: "Import finished with issues",
    created_one: "{{count}} new activity imported",
    created_other: "{{count}} new activities imported",
    updated: ", {{count}} existing updated",
    total: "Total",
    new: "New",
    updatedTile: "Updated",
    skipped: "Skipped",
    failed: "Failed",
    failedText_one:
      "{{count}} activity could not be saved. Wealthfolio's reason is shown per row; fix the cause (e.g. the security mapping) and retry, or add them manually.",
    failedText_other:
      "{{count}} activities could not be saved. Wealthfolio's reason is shown per row; fix the cause (e.g. the security mapping) and retry, or add them manually.",
    retrying: "Retrying…",
    retry: "Retry {{count}} failed",
    copyCsv: "Copy as CSV",
    another: "Import another file",
  },
  mapping: {
    title: "Map Securities",
    found_one: "{{count}} security found. Search for the correct ticker or mark as custom to keep the ISIN.",
    found_other: "{{count}} securities found. Search for the correct ticker or mark as custom to keep the ISIN.",
    markAllCustom: "Mark All Custom",
    colIsin: "ISIN / Name",
    colTicker: "Map to ticker",
    remaining_one: "{{count}} security remaining — resolve all or mark as custom to continue.",
    remaining_other: "{{count}} securities remaining — resolve all or mark as custom to continue.",
    search: "Search ticker, name or ISIN…",
    customLabel: "Custom (ISIN as symbol)",
    check: "Check this mapping: {{warning}}.",
    warnOtherIsin: "mapped to another ISIN ({{symbol}})",
    warnLeverage: "leverage differs ({{ours}}x here, {{theirs}}x at {{symbol}})",
    warnDirection: "long/short differs from {{name}}",
  },
  remap: {
    isMappedTo: "is mapped to <strong>{{label}}</strong>. Choose the right asset:",
    newMapping: "New mapping: {{label}}",
    checkToo: "Check this mapping too: {{warning}}.",
    activitiesOn: "Activities on {{label}}",
    loadError: "Could not read the activities: {{error}}",
    explain:
      "Other ISINs may be booked on the same asset (e.g. its real product). Select only the activities of {{isin}}. Cash transfers stay as they are.",
    explainNamed:
      "Other ISINs may be booked on the same asset (e.g. its real product). Select only the activities of {{isin}} — preselected: those whose comment names it. Cash transfers stay as they are.",
    moveAria: "move",
    moving: "Moving {{done}} of {{total}}…",
    moved_one: "Moved {{count}} activity",
    moved_other: "Moved {{count}} activities",
    movedFailed: ", {{count}} failed",
    saveAndMove_one: "Save mapping and move {{count}} activity",
    saveAndMove_other: "Save mapping and move {{count}} activities",
    save: "Save mapping",
  },
  settings: {
    loading: "Loading settings…",
    title: "Broker Importer — Settings",
    intro: "Configure once; settings are saved securely and pre-filled on every import.",
    selectCash: "Select cash account…",
    selectSecurities: "Select securities account…",
    securitiesHelpPair: "Receives buy/sell trades and dividends, with internal transfers to the cash account.",
    tr: {
      title: "Trade Republic accounts",
      intro:
        "Trade Republic does not separate cash from securities — everything lives in one account. Wealthfolio tracks them separately so you can monitor spending, interest, and investment performance independently. Select the two Wealthfolio accounts that represent your TR balance below.",
      cash: "Trade Republic cash account",
      cashHelp: "Receives deposits, withdrawals, card transactions, interest, and saveback rewards.",
      securities: "Trade Republic securities account",
      securitiesHelp:
        "Receives buy/sell trades and dividends. The importer automatically creates internal transfers between the two accounts to keep balances correct.",
    },
    sc: {
      title: "Scalable Capital accounts",
      intro:
        "Scalable Capital exports are imported into their own pair of accounts, so they never mix with Trade Republic. Leave empty if you don't use Scalable Capital.",
      cash: "Scalable Capital cash account",
      cashHelp: "Receives deposits, withdrawals, interest, fees and taxes (e.g. Vorabpauschale).",
      securities: "Scalable Capital securities account",
    },
    dkb: {
      title: "DKB accounts",
      intro:
        "DKB has no CSV import; its PDF trade and dividend statements are imported into this pair. Trade Republic and Scalable Capital PDFs use the accounts above. Leave empty if you don't use DKB.",
      cash: "DKB cash account",
      cashHelp: "The Girokonto the trades are settled with; receives the cash side of trades and dividends.",
      securities: "DKB securities account",
    },
    patterns: {
      title: "Transfer patterns",
      intro:
        "Outbound transfers matching a pattern are recorded as <code>TRANSFER_OUT</code> instead of <code>WITHDRAWAL</code>. Each pattern requires at least one of:",
      iban: "<strong>IBAN</strong> — matched against the counterparty IBAN field, or as a substring of the description (Trade Republic sometimes embeds the IBAN there instead).",
      keyword: "<strong>Keyword</strong> — matched as a case-insensitive substring of the description.",
      note: "IBAN is tried first (more precise). You can set both on the same pattern. Scalable Capital exports have no counterparty IBAN, so their withdrawals are matched against the note (<code>Notiz</code>) only.",
      none: "No transfer patterns configured.",
      ibanPlaceholder: "IBAN (e.g. ES36…)",
      keywordPlaceholder: "Keyword (e.g. INDEXA)",
      labelPlaceholder: "Label (e.g. Indexa pensiones)",
      destination: "Destination…",
      noDestination: "No destination",
      add: "Add pattern",
    },
    mappings: {
      title: "Security mappings",
      intro:
        "Once an ISIN is mapped to a ticker (or marked custom) during import, it's remembered here so future imports of the same security skip the mapping step. Remove an entry to be asked again next time it's imported. <strong>Change</strong> corrects a wrong mapping and can move the activities already booked onto the right asset.",
      none: "No security mappings saved yet.",
      change: "Change",
      clearAll: "Clear all",
    },
    incomplete:
      "Select both the cash and the securities account for each broker you import from (Trade Republic, Scalable Capital and/or DKB).",
    saving: "Saving…",
    save: "Save settings",
    saved: "Saved",
  },
  skip: {
    when: {
      sameDay: "the same day",
      date: "{{date}}",
    },
    tr: {
      reversal: "Reversal of the {{type}} of {{when}}; the two rows cancel out.",
      reversed: "Cancelled by the reversal of {{date}}; the two rows cancel out.",
      stockDividendReversal:
        "Stock dividend reversal of {{shares}} {{name}} shares without a matching stock dividend.",
      rebookingReversal: "Rebooking by Trade Republic: cancels out with the stock dividend booked {{when}}.",
      rebookingOriginal: "Rebooking by Trade Republic: cancelled by the reversal booked {{when}}.",
      split:
        "Split of {{name}} ({{shares}} shares): the split ratio can't be derived because this file holds no {{symbol}} shares before the split.",
      stockDividendNoPrice: "Stock dividend of {{shares}} {{name}} shares without a value per share in the export.",
      reinvestmentNoDebit:
        "Dividend reinvestment of {{shares}} {{name}} shares: the export has no matching cash debit, so the purchase price is unknown.",
      exchangeLegs:
        "{{label}}: expected one outgoing and one incoming ISIN at the same time, found {{out}} outgoing and {{in}} incoming.",
      exchangeCost:
        "{{label}} {{from}} -> {{to}}: the cost basis is unknown because this file holds only {{held}} of the {{total}} exchanged shares.",
      negativeDividend:
        "Negative {{type}} of {{amount}} {{currency}} for {{name}}: neither a reversal of a matching dividend nor the payment for a dividend reinvestment.",
      isinChange: "Technical ISIN change by Trade Republic; the holding itself doesn't change.",
      taxNoCash: "Tax booking with no cash effect (amount and tax add up to 0).",
      cashUnsupported: "Trade Republic transaction type CASH/{{type}} isn't supported yet, so no activity was created.",
      corporateUnsupported: "Corporate action {{type}} isn't supported yet, so {{name}} wasn't changed.",
      corporateUnsupportedShares:
        "Corporate action {{type}} isn't supported yet, so {{name}} wasn't changed ({{shares}} shares).",
      categoryUnsupported:
        "Trade Republic category {{category}}/{{type}} isn't supported yet, so no activity was created.",
      exchange: {
        SHARE_EXCHANGE: "Share exchange",
        ADR_DISCONTINUATION: "ADR discontinuation",
        REORGANISATION: "Reorganisation",
        REVERSE_SPLIT: "Reverse split",
      },
      hint: {
        removeShares: "Check the position in Wealthfolio and remove the shares manually if Trade Republic took them back.",
        fullHistory:
          "Import the complete transaction history (all years) so the position is known, or add this change manually in Wealthfolio.",
        stockDividend:
          "Add it manually in Wealthfolio as a dividend in kind (Dividend, subtype Dividend in kind) with the value from your Trade Republic statement.",
        reinvestment: "Add it manually in Wealthfolio as a BUY with the amount from your Trade Republic statement.",
        exchange:
          "Add the exchange manually in Wealthfolio: TRANSFER_OUT of the old and TRANSFER_IN of the new security.",
        negativeDividend:
          "Trade Republic debited this amount. Check your statement and add it manually in Wealthfolio (e.g. as a withdrawal or tax) if it is missing.",
        corporate:
          "Add the change manually in Wealthfolio so the share count matches Trade Republic, and report the type so it can be supported.",
        moved:
          "It changed your Trade Republic cash by {{moved}}. Add it manually in Wealthfolio and report the type so it can be supported.",
        noCash: "It doesn't move cash. Report the type so it can be supported.",
      },
    },
    sc: {
      dividendStorno: "Dividend cancellation (Storno) — offsets the original dividend",
      dividendCancelled: "Dividend cancelled later ({{ref}})",
      negativeDividend: "Negative dividend without a matching original dividend.",
      migrationOut: "Depot migration/correction — offset by a matching transfer in",
      migrationIn: "Depot migration/correction — offset by a matching transfer out",
      migrationDeposit: "Depot migration cash — offset by a matching withdrawal",
      migrationWithdrawal: "Depot migration cash — offset by a matching deposit",
      swapOut: "SWAP_OUT without a matching security transfer row, so the sale price is unknown.",
      noType: "Row without type and without ISIN.",
      unsupported: "Scalable Capital type {{type}} isn't supported yet, so no activity was created.",
      hint: {
        addManually: "Add it manually in Wealthfolio if Scalable Capital booked it, and report the case so it can be supported.",
      },
    },
    pdf: {
      unreadableTitle: "Unreadable PDF",
      unknownTitle: "Unknown document",
      unreadable: "The PDF could not be read: {{error}}",
      notStatement: "Not a statement from Trade Republic, Scalable Capital or DKB.",
      duplicate: "The same statement was uploaded more than once; it is imported once.",
      noIsin: "No ISIN found.",
      noShares: "No share count found.",
      noAmounts: "Amounts could not be read.",
      doesntAddUp:
        "Market value, taxes and booked amount don't add up - the statement holds amounts the PDF import doesn't handle (e.g. accrued interest).",
      storno: "Cancellations (Storno) are not supported - leave both documents out.",
      trOnly: "Only German trade statements (Kauf, Verkauf, Sparplan) and dividend statements are supported.",
      trNoBooking: "No cash booking (BUCHUNG) found.",
      trNoPosition: "No position (ÜBERSICHT) found.",
      trNoExecution: "Execution date not found.",
      trNoRate: "Exchange rate not found.",
      scOnly: "Only trade statements (Wertpapierabrechnung) and dividend statements are supported.",
      scNoPosition: "No Kauf/Verkauf position found.",
      scNoExecution: "Execution or booked amount not found.",
      scNoDividend: "Dividend amounts not found.",
      dkbOnly: "Only trade statements (Wertpapier Abrechnung Kauf/Verkauf) and dividend statements are supported.",
      dkbPerPiece: "Only securities quoted per piece are supported (no bonds quoted in percent).",
      dkbTradeFields: "Trade date, market value or booked amount not found.",
      dkbCurrencies: "Market value and booked amount are in different currencies.",
      dkbNoPosition: "No share position found.",
      dkbNoAmount: "Booked amount or value date not found.",
      hint: {
        addManually: "Add it manually in Wealthfolio, or import the broker's CSV export for this period instead.",
      },
    },
  },
};

const de: typeof en = {
  nav: {
    import: "Import",
    settings: "Einstellungen",
  },
  common: {
    back: "Zurück",
    continue: "Weiter",
    cancel: "Abbrechen",
    close: "Schließen",
    custom: "Eigenes",
    existing: "Vorhanden",
    loading: "Wird geladen…",
    none: "Keine.",
    skip: "Überspringen",
    include: "Übernehmen",
    includeAll: "Alle übernehmen",
    skipAll: "Alle überspringen",
  },
  col: {
    date: "Datum",
    type: "Typ",
    description: "Beschreibung",
    status: "Status",
    reason: "Grund",
    account: "Konto",
    symbol: "Symbol",
    amount: "Betrag",
    error: "Fehler",
    security: "Wertpapier",
    isinSymbol: "ISIN / Symbol",
    shares: "Stück",
    comment: "Kommentar",
  },
  account: {
    cash: "Verrechnungskonto ({{broker}})",
    portfolio: "Depotkonto ({{broker}})",
  },
  upload: {
    title: "CSV-Export oder PDF-Belege importieren",
    intro:
      "CSV: Trade Republic (Einstellungen → Dokumente → Transaktionshistorie) oder Scalable Capital (Transaktions-Export). PDF: Abrechnungen von Käufen, Verkäufen und Dividenden von Trade Republic, Scalable Capital oder DKB - so viele eines Brokers, wie du willst. Der Broker wird automatisch erkannt.",
    drop: "CSV-Export oder beliebig viele PDF-Belege hier ablegen",
    browse: "oder klicken, um Dateien auszuwählen",
    reading_one: "{{count}} PDF wird gelesen…",
    reading_other: "{{count}} PDFs werden gelesen…",
    pdfStatements: "{{count}} PDF-Belege",
    parsed_one: "{{count}} Aktivität gelesen",
    parsed_other: "{{count}} Aktivitäten gelesen",
    otherFile: "Andere Datei hochladen",
    settingsLoading: "Die Einstellungen werden noch geladen.",
    unreadable: "Die Datei konnte nicht gelesen werden.",
    oneCsv: "Lade immer nur einen CSV-Export hoch, ohne PDFs.",
    wrongType:
      "Lade einen .csv-Export (Trade Republic, Scalable Capital) oder .pdf-Belege (Trade Republic, Scalable Capital, DKB) hoch.",
    unrecognisedCsv: "Unbekannte CSV-Datei. Lade einen Transaktions-Export von Trade Republic oder Scalable Capital hoch.",
    selectAccounts: "Wähle zuerst in den Einstellungen dein Verrechnungs- und Depotkonto für {{broker}}.",
    noRows: "Keine Zeilen im {{broker}}-Export gefunden.",
    noPdfBroker: "Keines der PDFs ist ein Beleg von Trade Republic, Scalable Capital oder DKB.",
    mixedBrokers: "Die PDFs stammen von verschiedenen Brokern ({{names}}). Lade die Belege eines Brokers nach dem anderen hoch.",
  },
  notConfigured: {
    title: "Noch nicht eingerichtet",
    text: "Wähle unter <strong>Einstellungen</strong> das Verrechnungs- und Depotkonto für Trade Republic, Scalable Capital und/oder DKB, bevor du importierst.",
  },
  checking: {
    title: "Wird geprüft…",
    text: "{{count}} Aktivitäten werden auf Duplikate und Fehler geprüft…",
  },
  review: {
    title: "Aktivitäten prüfen",
    ready: "{{count}} bereit",
    alreadyIn: "{{count}} schon in Wealthfolio",
    duplicates: "{{count}} Duplikate",
    errors: "{{count}} Fehler",
    notImported: "{{count}} nicht importiert",
    netted: "{{count}} verrechnet",
    matchError:
      "Der Abgleich mit den Aktivitäten in Wealthfolio ist fehlgeschlagen: {{error}} — prüfe selbst auf doppelte Buchungen.",
    checkError: "Warnung bei der Prüfung: {{error}} — bitte selbst prüfen.",
    importNew_one: "{{count}} Aktivität importieren",
    importNew_other: "{{count}} Aktivitäten importieren",
    updateOnly: "{{count}} vorhandene aktualisieren",
    importAndUpdate: "{{new}} neue importieren · {{update}} vorhandene aktualisieren",
    existingBanner_one:
      "<strong>{{count}} Transaktion</strong> ist schon aus einem anderen Import in Wealthfolio (z. B. CSV statt PDF) — wird <strong>übersprungen</strong>, außer du übernimmst sie.",
    existingBanner_other:
      "<strong>{{count}} Transaktionen</strong> sind schon aus einem anderen Import in Wealthfolio (z. B. CSV statt PDF) — werden <strong>übersprungen</strong>, außer du übernimmst sie.",
    suspicious_one: "Prüfe diese Wertpapier-Zuordnung vor dem Import",
    suspicious_other: "Prüfe diese Wertpapier-Zuordnungen vor dem Import",
    suspiciousText:
      "Eine falsche Zuordnung bucht das Wertpapier auf ein anderes Asset. Geh zurück und ändere sie, oder korrigiere sie später unter Einstellungen → Wertpapier-Zuordnungen; dort kannst du schon gebuchte Aktivitäten auch auf das richtige Asset verschieben.",
    duplicateBanner_one:
      "<strong>{{count}} Duplikat</strong> ist schon in Wealthfolio — wird <strong>aktualisiert</strong>, außer du überspringst es.",
    duplicateBanner_other:
      "<strong>{{count}} Duplikate</strong> sind schon in Wealthfolio — werden <strong>aktualisiert</strong>, außer du überspringst sie.",
    tabActivities: "Aktivitäten ({{count}})",
    tabSkipped: "Übersprungen ({{count}})",
    tabHoldings: "Bestand ({{count}})",
    showingDuplicates: "Nur Duplikate ({{count}})",
    showDuplicates: "Nur Duplikate zeigen ({{count}})",
    statusReady: "Bereit",
    statusExisting: "Schon in Wealthfolio",
    statusExistingTitle: "Dieselbe Transaktion ist schon in Wealthfolio, aus einer anderen Quelle importiert (z. B. CSV statt PDF)",
    statusDuplicate: "Duplikat",
  },
  skipped: {
    none: "Keine Zeilen übersprungen.",
    missing: "Nicht importiert",
    netted: "Nichts zu tun",
  },
  reconcile: {
    cashChangePdf: "Änderung des Verrechnungskontos durch diese Belege",
    cashAfter: "Verrechnungskonto nach dem Import",
    matches: "Stimmt mit dem {{broker}}-Saldo in der Datei überein",
    differs: "{{broker}}-Saldo in der Datei: {{balance}} — Abweichung {{diff}}",
    differsNotImported: "(siehe die {{count}} nicht importierten Zeilen unter Übersprungen)",
    leftover: "Geld auf dem Depotkonto",
    leftoverNone: "Keins",
    shouldBeZero: "{{amounts}} — sollte 0 sein",
    positions: "Positionen nach dem Import",
    positionsCount: "{{count}} (siehe Bestand)",
    negativeItem: "{{name}} ({{shares}} am {{date}})",
    soldWithoutPurchase:
      "Verkauft ohne Kauf in diesen Belegen - in Ordnung, wenn die Position schon in Wealthfolio ist: {{list}}",
    negative: "Negativer Bestand — Zeilen fehlen oder sind falsch zugeordnet: {{list}}",
    footPdf:
      "Nur aus diesen Belegen berechnet. Sie enthalten Käufe, Verkäufe und Dividenden, aber keine Ein- oder Auszahlungen, daher zeigt das Verrechnungskonto nicht deinen {{broker}}-Saldo.",
    footCsv:
      "Nur aus dieser Datei berechnet. Vergleiche mit deiner {{broker}}-App; deckt die Datei nicht die ganze Historie ab, weichen Saldo und Bestand ab.",
    noPositions: "Keine Positionen.",
  },
  importing: {
    title: "Wird importiert…",
    text: "Aktivitäten werden in Wealthfolio gespeichert…",
  },
  done: {
    complete: "Import abgeschlossen",
    issues: "Import mit Problemen beendet",
    created_one: "{{count}} neue Aktivität importiert",
    created_other: "{{count}} neue Aktivitäten importiert",
    updated: ", {{count}} vorhandene aktualisiert",
    total: "Gesamt",
    new: "Neu",
    updatedTile: "Aktualisiert",
    skipped: "Übersprungen",
    failed: "Fehlgeschlagen",
    failedText_one:
      "{{count}} Aktivität konnte nicht gespeichert werden. Den Grund von Wealthfolio siehst du in der Zeile; behebe die Ursache (z. B. die Wertpapier-Zuordnung) und versuche es erneut, oder lege sie von Hand an.",
    failedText_other:
      "{{count}} Aktivitäten konnten nicht gespeichert werden. Den Grund von Wealthfolio siehst du je Zeile; behebe die Ursache (z. B. die Wertpapier-Zuordnung) und versuche es erneut, oder lege sie von Hand an.",
    retrying: "Neuer Versuch…",
    retry: "{{count}} fehlgeschlagene erneut versuchen",
    copyCsv: "Als CSV kopieren",
    another: "Weitere Datei importieren",
  },
  mapping: {
    title: "Wertpapiere zuordnen",
    found_one: "{{count}} Wertpapier gefunden. Suche den richtigen Ticker oder wähle Eigenes, um die ISIN zu behalten.",
    found_other: "{{count}} Wertpapiere gefunden. Suche den richtigen Ticker oder wähle Eigenes, um die ISIN zu behalten.",
    markAllCustom: "Alle als Eigenes",
    colIsin: "ISIN / Name",
    colTicker: "Ticker zuordnen",
    remaining_one: "{{count}} Wertpapier offen — ordne alle zu oder wähle Eigenes, um weiterzumachen.",
    remaining_other: "{{count}} Wertpapiere offen — ordne alle zu oder wähle Eigenes, um weiterzumachen.",
    search: "Ticker, Name oder ISIN suchen…",
    customLabel: "Eigenes (ISIN als Symbol)",
    check: "Prüfe diese Zuordnung: {{warning}}.",
    warnOtherIsin: "einer anderen ISIN zugeordnet ({{symbol}})",
    warnLeverage: "anderer Hebel ({{ours}}x hier, {{theirs}}x bei {{symbol}})",
    warnDirection: "Long/Short weicht ab von {{name}}",
  },
  remap: {
    isMappedTo: "ist <strong>{{label}}</strong> zugeordnet. Wähle das richtige Asset:",
    newMapping: "Neue Zuordnung: {{label}}",
    checkToo: "Prüfe auch diese Zuordnung: {{warning}}.",
    activitiesOn: "Aktivitäten auf {{label}}",
    loadError: "Die Aktivitäten konnten nicht gelesen werden: {{error}}",
    explain:
      "Auf demselben Asset können andere ISINs gebucht sein (z. B. sein eigentliches Produkt). Wähle nur die Aktivitäten von {{isin}}. Überträge von Geld bleiben, wie sie sind.",
    explainNamed:
      "Auf demselben Asset können andere ISINs gebucht sein (z. B. sein eigentliches Produkt). Wähle nur die Aktivitäten von {{isin}} — vorausgewählt: die, deren Kommentar es nennt. Überträge von Geld bleiben, wie sie sind.",
    moveAria: "verschieben",
    moving: "{{done}} von {{total}} werden verschoben…",
    moved_one: "{{count}} Aktivität verschoben",
    moved_other: "{{count}} Aktivitäten verschoben",
    movedFailed: ", {{count}} fehlgeschlagen",
    saveAndMove_one: "Zuordnung speichern und {{count}} Aktivität verschieben",
    saveAndMove_other: "Zuordnung speichern und {{count}} Aktivitäten verschieben",
    save: "Zuordnung speichern",
  },
  settings: {
    loading: "Einstellungen werden geladen…",
    title: "Broker Importer — Einstellungen",
    intro: "Einmal einrichten; die Einstellungen werden sicher gespeichert und bei jedem Import vorausgefüllt.",
    selectCash: "Verrechnungskonto wählen…",
    selectSecurities: "Depotkonto wählen…",
    securitiesHelpPair: "Erhält Käufe, Verkäufe und Dividenden, mit Überträgen zum Verrechnungskonto.",
    tr: {
      title: "Trade-Republic-Konten",
      intro:
        "Trade Republic trennt Geld und Wertpapiere nicht — alles liegt in einem Konto. Wealthfolio führt beides getrennt, damit du Ausgaben, Zinsen und die Wertentwicklung deiner Anlagen getrennt verfolgen kannst. Wähle unten die zwei Wealthfolio-Konten, die dein Trade-Republic-Guthaben abbilden.",
      cash: "Trade Republic Verrechnungskonto",
      cashHelp: "Erhält Einzahlungen, Auszahlungen, Kartenzahlungen, Zinsen und Saveback.",
      securities: "Trade Republic Depotkonto",
      securitiesHelp:
        "Erhält Käufe, Verkäufe und Dividenden. Der Import legt automatisch Überträge zwischen den beiden Konten an, damit die Salden stimmen.",
    },
    sc: {
      title: "Scalable-Capital-Konten",
      intro:
        "Exporte von Scalable Capital kommen in ein eigenes Kontenpaar und mischen sich so nie mit Trade Republic. Leer lassen, wenn du Scalable Capital nicht nutzt.",
      cash: "Scalable Capital Verrechnungskonto",
      cashHelp: "Erhält Einzahlungen, Auszahlungen, Zinsen, Gebühren und Steuern (z. B. Vorabpauschale).",
      securities: "Scalable Capital Depotkonto",
    },
    dkb: {
      title: "DKB-Konten",
      intro:
        "DKB hat keinen CSV-Import; ihre PDF-Abrechnungen von Käufen, Verkäufen und Dividenden kommen in dieses Kontenpaar. PDFs von Trade Republic und Scalable Capital nutzen die Konten oben. Leer lassen, wenn du DKB nicht nutzt.",
      cash: "DKB Verrechnungskonto",
      cashHelp: "Das Girokonto, über das die Käufe abgerechnet werden; erhält die Geldseite von Käufen, Verkäufen und Dividenden.",
      securities: "DKB Depotkonto",
    },
    patterns: {
      title: "Überträge",
      intro:
        "Ausgehende Überweisungen, die zu einem Muster passen, werden als <code>TRANSFER_OUT</code> statt als <code>WITHDRAWAL</code> gebucht. Jedes Muster braucht mindestens eins von beiden:",
      iban: "<strong>IBAN</strong> — wird mit der IBAN der Gegenseite verglichen oder in der Beschreibung gesucht (Trade Republic schreibt die IBAN manchmal dorthin).",
      keyword: "<strong>Stichwort</strong> — wird in der Beschreibung gesucht, ohne auf Groß- und Kleinschreibung zu achten.",
      note: "Die IBAN wird zuerst geprüft (genauer). Du kannst beides im selben Muster angeben. Exporte von Scalable Capital haben keine IBAN der Gegenseite, ihre Auszahlungen werden nur mit der Notiz (<code>Notiz</code>) verglichen.",
      none: "Keine Muster eingerichtet.",
      ibanPlaceholder: "IBAN (z. B. ES36…)",
      keywordPlaceholder: "Stichwort (z. B. INDEXA)",
      labelPlaceholder: "Bezeichnung (z. B. Indexa pensiones)",
      destination: "Zielkonto…",
      noDestination: "Kein Zielkonto",
      add: "Muster hinzufügen",
    },
    mappings: {
      title: "Wertpapier-Zuordnungen",
      intro:
        "Sobald eine ISIN beim Import einem Ticker zugeordnet (oder als Eigenes markiert) ist, wird sie hier gemerkt, damit spätere Importe desselben Wertpapiers die Zuordnung überspringen. Entferne einen Eintrag, um beim nächsten Import wieder gefragt zu werden. <strong>Ändern</strong> korrigiert eine falsche Zuordnung und kann schon gebuchte Aktivitäten auf das richtige Asset verschieben.",
      none: "Noch keine Wertpapier-Zuordnungen gespeichert.",
      change: "Ändern",
      clearAll: "Alle entfernen",
    },
    incomplete:
      "Wähle für jeden Broker, von dem du importierst (Trade Republic, Scalable Capital und/oder DKB), das Verrechnungs- und das Depotkonto.",
    saving: "Wird gespeichert…",
    save: "Einstellungen speichern",
    saved: "Gespeichert",
  },
  skip: {
    when: {
      sameDay: "am selben Tag",
      date: "am {{date}}",
    },
    tr: {
      reversal: "Storno von {{rawType}}, gebucht {{when}}; beide Zeilen heben sich auf.",
      reversed: "Durch das Storno vom {{date}} aufgehoben; beide Zeilen heben sich auf.",
      stockDividendReversal: "Storno einer Aktiendividende über {{shares}} Stück {{name}} ohne passende Aktiendividende.",
      rebookingReversal: "Umbuchung durch Trade Republic: hebt sich mit der Aktiendividende auf, gebucht {{when}}.",
      rebookingOriginal: "Umbuchung durch Trade Republic: aufgehoben durch das Storno, gebucht {{when}}.",
      split:
        "Split von {{name}} ({{shares}} Stück): das Verhältnis lässt sich nicht bestimmen, weil diese Datei vor dem Split keine {{symbol}}-Stücke enthält.",
      stockDividendNoPrice: "Aktiendividende über {{shares}} Stück {{name}} ohne Wert je Stück im Export.",
      reinvestmentNoDebit:
        "Wiederanlage der Dividende, {{shares}} Stück {{name}}: der Export enthält keine passende Belastung, daher ist der Kaufpreis unbekannt.",
      exchangeLegs:
        "{{label}}: erwartet wurden eine abgehende und eine eingehende ISIN zur selben Zeit, gefunden {{out}} abgehende und {{in}} eingehende.",
      exchangeCost:
        "{{label}} {{from}} -> {{to}}: der Einstandswert ist unbekannt, weil diese Datei nur {{held}} der {{total}} getauschten Stücke enthält.",
      negativeDividend:
        "Negative Buchung {{rawType}} über {{amount}} {{currency}} für {{name}}: weder Storno einer passenden Dividende noch Zahlung für eine Wiederanlage.",
      isinChange: "Technischer ISIN-Wechsel durch Trade Republic; der Bestand ändert sich nicht.",
      taxNoCash: "Steuerbuchung ohne Geldbewegung (Betrag und Steuer ergeben 0).",
      cashUnsupported: "Der Trade-Republic-Typ CASH/{{type}} wird noch nicht unterstützt, daher wurde keine Aktivität angelegt.",
      corporateUnsupported: "Die Kapitalmaßnahme {{type}} wird noch nicht unterstützt, daher wurde {{name}} nicht geändert.",
      corporateUnsupportedShares:
        "Die Kapitalmaßnahme {{type}} wird noch nicht unterstützt, daher wurde {{name}} nicht geändert ({{shares}} Stück).",
      categoryUnsupported:
        "Die Trade-Republic-Kategorie {{category}}/{{type}} wird noch nicht unterstützt, daher wurde keine Aktivität angelegt.",
      exchange: {
        SHARE_EXCHANGE: "Aktientausch",
        ADR_DISCONTINUATION: "ADR-Einstellung",
        REORGANISATION: "Reorganisation",
        REVERSE_SPLIT: "Reverse Split",
      },
      hint: {
        removeShares: "Prüfe die Position in Wealthfolio und entferne die Stücke von Hand, falls Trade Republic sie zurückgebucht hat.",
        fullHistory:
          "Importiere die vollständige Transaktionshistorie (alle Jahre), damit die Position bekannt ist, oder trage die Änderung von Hand in Wealthfolio ein.",
        stockDividend:
          "Lege sie in Wealthfolio von Hand als Sachdividende an (Dividende, Subtyp Dividend in kind), mit dem Wert aus deiner Trade-Republic-Abrechnung.",
        reinvestment: "Lege sie in Wealthfolio von Hand als Kauf (BUY) an, mit dem Betrag aus deiner Trade-Republic-Abrechnung.",
        exchange:
          "Trage den Tausch von Hand in Wealthfolio ein: TRANSFER_OUT des alten und TRANSFER_IN des neuen Wertpapiers.",
        negativeDividend:
          "Trade Republic hat diesen Betrag belastet. Prüfe deine Abrechnung und lege ihn von Hand in Wealthfolio an (z. B. als Auszahlung oder Steuer), falls er fehlt.",
        corporate:
          "Trage die Änderung von Hand in Wealthfolio ein, damit die Stückzahl zu Trade Republic passt, und melde den Typ, damit er unterstützt werden kann.",
        moved:
          "Sie hat dein Trade-Republic-Guthaben um {{moved}} verändert. Lege sie von Hand in Wealthfolio an und melde den Typ, damit er unterstützt werden kann.",
        noCash: "Sie bewegt kein Geld. Melde den Typ, damit er unterstützt werden kann.",
      },
    },
    sc: {
      dividendStorno: "Storno einer Dividende — hebt die ursprüngliche Dividende auf",
      dividendCancelled: "Dividende später storniert ({{ref}})",
      negativeDividend: "Negative Dividende ohne passende ursprüngliche Dividende.",
      migrationOut: "Depotumzug/Korrektur — durch passenden Eingang aufgehoben",
      migrationIn: "Depotumzug/Korrektur — durch passenden Ausgang aufgehoben",
      migrationDeposit: "Geld aus Depotumzug — durch passende Auszahlung aufgehoben",
      migrationWithdrawal: "Geld aus Depotumzug — durch passende Einzahlung aufgehoben",
      swapOut: "SWAP_OUT ohne passende Wertpapierzeile, daher ist der Verkaufspreis unbekannt.",
      noType: "Zeile ohne Typ und ohne ISIN.",
      unsupported: "Der Scalable-Capital-Typ {{type}} wird noch nicht unterstützt, daher wurde keine Aktivität angelegt.",
      hint: {
        addManually: "Lege sie von Hand in Wealthfolio an, falls Scalable Capital sie gebucht hat, und melde den Fall, damit er unterstützt werden kann.",
      },
    },
    pdf: {
      unreadableTitle: "Unlesbares PDF",
      unknownTitle: "Unbekanntes Dokument",
      unreadable: "Das PDF konnte nicht gelesen werden: {{error}}",
      notStatement: "Kein Beleg von Trade Republic, Scalable Capital oder DKB.",
      duplicate: "Derselbe Beleg wurde mehrmals hochgeladen; er wird einmal importiert.",
      noIsin: "Keine ISIN gefunden.",
      noShares: "Keine Stückzahl gefunden.",
      noAmounts: "Die Beträge konnten nicht gelesen werden.",
      doesntAddUp:
        "Kurswert, Steuern und gebuchter Betrag passen nicht zusammen - der Beleg enthält Beträge, die der PDF-Import nicht kennt (z. B. Stückzinsen).",
      storno: "Stornos werden nicht unterstützt - lass beide Belege weg.",
      trOnly: "Nur deutsche Wertpapierabrechnungen (Kauf, Verkauf, Sparplan) und Dividendenbelege werden unterstützt.",
      trNoBooking: "Keine Buchung (BUCHUNG) gefunden.",
      trNoPosition: "Keine Position (ÜBERSICHT) gefunden.",
      trNoExecution: "Ausführungsdatum nicht gefunden.",
      trNoRate: "Devisenkurs nicht gefunden.",
      scOnly: "Nur Wertpapierabrechnungen und Dividendenbelege werden unterstützt.",
      scNoPosition: "Keine Kauf/Verkauf-Position gefunden.",
      scNoExecution: "Ausführung oder gebuchter Betrag nicht gefunden.",
      scNoDividend: "Beträge der Dividende nicht gefunden.",
      dkbOnly: "Nur Wertpapierabrechnungen (Kauf/Verkauf) und Dividendenbelege werden unterstützt.",
      dkbPerPiece: "Nur Wertpapiere mit Stücknotiz werden unterstützt (keine Anleihen mit Prozentnotiz).",
      dkbTradeFields: "Handelstag, Kurswert oder gebuchter Betrag nicht gefunden.",
      dkbCurrencies: "Kurswert und gebuchter Betrag haben verschiedene Währungen.",
      dkbNoPosition: "Keine Stückzahl gefunden.",
      dkbNoAmount: "Gebuchter Betrag oder Valuta nicht gefunden.",
      hint: {
        addManually: "Lege sie von Hand in Wealthfolio an, oder importiere stattdessen den CSV-Export des Brokers für diesen Zeitraum.",
      },
    },
  },
};

export const resources: { en: AddonTranslationBundle; de: AddonTranslationBundle } = { en, de };
export type Language = keyof typeof resources;

// ── Local translator (outside the sandbox, and for the English texts of logic modules) ──

function lookup(bundle: AddonTranslationBundle, key: string): string | undefined {
  let node: string | AddonTranslationBundle | undefined = bundle;
  for (const part of key.split(".")) {
    if (node === undefined || typeof node === "string") return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

function find(lang: Language, key: string, params?: Params): string | undefined {
  const bundle = resources[lang];
  if (typeof params?.count === "number") {
    const plural = lookup(bundle, `${key}_${params.count === 1 ? "one" : "other"}`);
    if (plural !== undefined) return plural;
  }
  return lookup(bundle, key);
}

const interpolate = (template: string, params?: Params) =>
  template.replace(/\{\{\s*(\w+)\s*\}\}/g, (all, name: string) =>
    params && params[name] !== undefined ? String(params[name]) : all,
  );

// Params named `<name>Key` translated into `<name>` (see the top of the file).
function resolveKeys(params: Params | undefined, t: T): Params | undefined {
  if (!params) return params;
  const out: Params = { ...params };
  for (const [name, value] of Object.entries(params)) {
    if (name.endsWith("Key") && name.length > 3 && typeof value === "string") out[name.slice(0, -3)] = t(value, params);
  }
  return out;
}

function translateRaw(lang: Language, key: string, params?: Params): string {
  const template = find(lang, key, params) ?? find("en", key, params);
  return template === undefined ? key : interpolate(template, params);
}

export function translate(lang: Language, key: string, params?: Params): string {
  return translateRaw(lang, key, resolveKeys(params, (k, p) => translateRaw(lang, k, p)));
}

// English, for texts that logic modules return (skip reasons, warnings, labels).
export const enT: T = (key, params) => translate("en", key, params);

export function msg(key: string, params?: Params): Msg {
  return { text: enT(key, params), key, params };
}

// The UI text of something that carries an English text and maybe a key.
export function textOf(t: T, text: string, key?: string, params?: Params): string {
  return key ? t(key, params) : text;
}

let fallbackLanguage: Language = "en";

// Tests only: the language of the local translator.
export function setFallbackLanguage(lang: Language): void {
  fallbackLanguage = lang;
}

export interface Translator {
  t: T;
  language: string;
}

function useLocalT(): Translator {
  const lang = fallbackLanguage;
  return { t: (key, params) => translate(lang, key, params), language: lang };
}

function useSdkT(): Translator {
  const { t: sdkT, language } = useAddonTranslation();
  // Values are data shown by React, which escapes them itself.
  const raw: T = (key, params) => sdkT(key, { ...params, interpolation: { escapeValue: false } });
  return { t: (key, params) => raw(key, resolveKeys(params, raw)), language };
}

// The sandbox installs its runtime before any addon code runs, so this choice
// never changes while the addon runs and the hook order stays stable.
export const useT: () => Translator =
  typeof globalThis !== "undefined" && globalThis.__wealthfolioAddonI18n ? useSdkT : useLocalT;

// Renders a translated text with <strong>…</strong> and <code>…</code> markup.
export function rich(text: string): ReactNode {
  const parts = text.split(/(<strong>.*?<\/strong>|<code>.*?<\/code>)/g);
  return createElement(
    Fragment,
    null,
    ...parts.map((part, i) => {
      const m = /^<(strong|code)>(.*)<\/\1>$/.exec(part);
      return m ? createElement(m[1], { key: i }, m[2]) : part;
    }),
  );
}
