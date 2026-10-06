# Changelog

## [2.10.0] - 2026-10-06

### Added

- PDF statements: drop any number of PDF statements of one broker at once. Supported are trade statements (buy, sell; Trade Republic also savings plan, round-up and Saveback) and dividend/distribution statements from Trade Republic, Scalable Capital and DKB.
  - The broker is detected from the document. The PDFs import into the same cash and securities accounts as that broker's CSV export; DKB gets its own account pair in Settings.
  - Fee and tax go into their own fields. Dividends carry the gross income, withholding and German tax, and the original foreign amount in the comment. This also gives Scalable dividends the tax that their CSV export lacks.
  - Documents that aren't supported or can't be read are listed under **Skipped** with the reason. A statement uploaded twice is imported once, and a re-import of the same statement is recognised as a duplicate.
- Settings: account pair for DKB.

### Notes

- Don't import the same period from a broker's CSV export and its PDF statements: CSV and PDF activities aren't recognised as duplicates of each other.
- The addon file is about 2 MB larger because it now bundles pdf.js.

## [2.9.0] - 2026-10-06

### Changed

- Scalable Capital buys and sells now carry fee ("Gebühren") and tax ("Steuern") in Wealthfolio's separate fee and tax fields, like Trade Republic since 2.6.0. Before, the tax was added to the fee. A negative tax (refund) on a trade is booked as a tax-refund credit.
- Scalable dividends are unchanged: the export only has the net amount, without the tax.

### Upgrade note

- Scalable sells with tax no longer match their earlier imports (the fee changed) and are not recognised as duplicates. Before re-importing a Scalable export, delete those sells in Wealthfolio, or empty the two Scalable accounts and re-import the full export. Buys without tax are unaffected.

## [2.8.0] - 2026-10-06

### Added

- Activities that Wealthfolio rejects during the import are no longer just counted. The result page lists each one with its date, account, type, symbol, amount and Wealthfolio's error message.
- **Retry N failed** re-sends only those activities. Internal transfer pairs keep their link, so a retried leg still pairs with its counterpart.
- **Copy as CSV** shows the list as text to copy, because downloads aren't possible in the addon sandbox.

### Changed

- The import logic (security mapping, activity status, create/update payloads, the import run) moved from the import page into its own module with unit tests. The import behaves as before.

## [2.7.0] - 2026-10-06

### Added

- Pre-import check in the review step, computed from the file before anything is imported:
  - Cash balance after the import, compared with the broker's own balance in the file (Trade Republic: amount + fee + tax of every row; Scalable Capital: "Wert" of every row with a type). A difference points to the rows listed as *Not imported*.
  - A warning if cash would be left on the securities account, or if a holding goes negative. Either points to missing or mis-mapped rows.
  - A new **Holdings** tab with the resulting positions, to compare with the broker app.

## [2.6.0] - 2026-10-05

### Changed

- Trade Republic: fee and tax are imported into Wealthfolio's separate fee and tax fields, so Wealthfolio reports them correctly.
  - Sells (and buys): the tax is no longer added to the fee. A tax refund on a sale is booked as a tax-refund credit.
  - Dividends, fund distributions and interest: one activity with the net amount and the withholding tax, instead of a gross activity plus a separate TAX row.
  - Stand-alone taxes (Vorabpauschale, tax adjustments) stay their own TAX rows.
- The import now passes the tax field to Wealthfolio.

### Upgrade note

- The following no longer match their earlier imports and are not recognised as duplicates: sells with tax (the fee changed), and dividends and interest with withholding tax (now net amount, no separate TAX row). Before re-importing, delete them in Wealthfolio together with their "Withholding tax on …" TAX rows, or they will be counted twice. The simplest way is to empty the two Trade Republic accounts and re-import the full export.

## [2.5.0] - 2026-10-05

### Added

- Trade Republic corporate actions, stage 3:
  - `SPLIT` is imported as a Wealthfolio split; the ratio is derived from the shares held before the split, computed from the file.
  - `STOCK_DIVIDEND` is imported as a dividend in kind (income plus shares). A later +n/−n rebooking by Trade Republic cancels out.
  - `DIVIDEND_REINVESTMENT` is imported together with the cash Trade Republic debited for it, as a BUY paid from the cash account. The cash dividend itself was already booked as income.
- Skipped rows now show a status: *No action needed* for rows skipped on purpose (reversals, rebookings, technical ISIN changes) or *Not imported*. Rows that weren't imported come first and include a hint on what to do, e.g. how much cash an unsupported row moved. This applies to both Trade Republic and Scalable Capital.

### Changed

- The review page counts "not imported" and "netted out" rows separately; the "Unsupported" tab is now called "Skipped".

## [2.4.0] - 2026-10-05

### Fixed

- Trade Republic dividends paid on foreign securities (USD, ZAR, …) are now booked in the currency Trade Republic actually paid out (EUR); the original amount is kept in the comment. Before, the dividend was booked in the foreign currency while the withholding tax and the transfer to the cash account were in EUR, which left foreign-currency cash and a negative EUR balance on the securities account.
- Dividend reversals (negative amounts) were booked as additional dividends. A reversal now cancels out the matching dividend; a negative row without a match is listed as skipped.

### Upgrade note

- Foreign-currency dividends imported with an earlier version are no longer recognised as duplicates, because amount and currency changed. Delete them in Wealthfolio (securities account, type Dividend, currency other than EUR) before re-importing, or they will be counted twice.

## [2.3.1] - 2026-10-05

### Fixed

- Stocks mapped as "custom" (kept as ISIN because the ticker search can't find them, e.g. delisted shares) were rejected by Wealthfolio with "Could not find '…' in market data", so every activity of that stock failed. They are now created as manually quoted assets. Funds mapped as "custom" are unchanged.

## [2.3.0] - 2026-10-05

### Added

- Trade Republic corporate actions that swap one ISIN for another (`SHARE_EXCHANGE`, `ADR_DISCONTINUATION`, `REORGANISATION`, `REVERSE_SPLIT`) are imported as a TRANSFER_OUT of the old and a TRANSFER_IN of the new ISIN. The new position takes over the old one's cost basis, computed FIFO from the buys and sells in the same file. If the file doesn't contain the shares (incomplete history), both rows are listed as skipped.
- `WORTHLESS` write-offs are imported as a SELL at 0, which realises the loss.
- Splits, stock dividends and dividend reinvestments are still listed as skipped.

## [2.2.0] - 2026-10-05

### Added

- Trade Republic: more CASH types are imported instead of skipped:
  - `DISTRIBUTION` (fund/ETF distributions) and `EXCHANGE` (cash paid in a share-exchange programme) are booked like dividends: DIVIDEND + withholding TAX + transfer to cash.
  - Vorabpauschale (`EARNINGS`, `PRE_DETERMINED_TAX_BASE`) and tax adjustments (`SEC_ACCOUNT`, `TAX_OPTIMIZATION`) become TAX on the cash account, or CREDIT (tax refund) when positive.
  - `REFERRAL` becomes CREDIT (bonus).
- Corporate actions (`CORPORATE_ACTION`) are still listed as skipped.

## [2.1.1] - 2026-10-05

### Changed

- Author in `manifest.json` / `package.json` is now `waldonso2`; the MIT copyright notice of the original author (blastik) is kept in `LICENSE`, with a line added for this project.
- Removed `.github/FUNDING.yml`, which pointed sponsorships to the original author.
- README shortened and corrected (Trade Republic mapping table, transfer patterns), with a credits section linking to the original [Trade Republic Importer](https://github.com/blastik/trade-republic-importer-addon). No behavior changes.

## [2.1.0] - 2026-10-04

### Added

- Update hint: once a day the addon checks the latest GitHub release and, if it is newer than the installed version, shows the version and the download address of `broker-importer-addon.zip` above the Import and Settings pages. Wealthfolio's sandbox doesn't let addons open external links, so the address is shown for copying. Installing stays manual via Settings → Add-ons → Install from File, which keeps your settings.
- New permission `network` (`request`), limited to `api.github.com`. Wealthfolio asks you to approve the host on install; without approval the addon works as before, just without the hint.

## [2.0.2] - 2026-10-04

### Fixed

- Re-importing a file recognised every existing activity as a duplicate except BUY and SELL, so trades were imported a second time. Wealthfolio's duplicate fingerprint includes the trade's exact final cash amount, which it derives (quantity × unit price ± fee) when an activity is created without one, while `checkImport` hashes the amount as submitted. Trades now carry exactly that derived amount, so already imported trades — including those from earlier versions — are detected as duplicates.

## [2.0.1] - 2026-10-04

### Changed

- The ticker search in the security-mapping step now starts with the security's name instead of its ISIN (falling back to the ISIN when the CSV has no name). For securities that appear several times, the most recent name from the file is used, since exports can carry outdated names for older rows.

## [2.0.0] - 2026-10-04

### Changed

- **Breaking:** renamed to **Broker Importer**. The addon ID changed from `trade-republic-importer` to `broker-importer` (routes are now `/addon/broker-importer/…`), the npm package to `broker-importer-addon`, and the release asset to `broker-importer-addon.zip`. Wealthfolio treats this as a new addon: uninstall the old one and re-enter the settings (accounts, transfer patterns, security mappings). Already imported activities are not affected.
- Repository links now point to `waldonso2/wealthfolio-importer-addon`.

## [1.4.0] - 2026-10-04

### Added

- Scalable Capital transaction exports (`scalable_transactions_export_<date>_de.csv`) can now be imported alongside Trade Republic. The format is detected from the CSV header; Scalable uses its own cash/securities account pair, configured in Settings.
- Supported Scalable types: Kauf, Verkauf, Dividende, Zinsen, Einlage, Entnahme (with transfer-pattern keywords), TAX, Steuerrückerstattung, FEE, fund liquidations (SWAP_OUT) and certificate redemptions. Dividend cancellations, depot-migration transfers and the migration's cash leg are netted and listed as skipped, so holdings and cost basis stay correct. Times are converted from Europe/Berlin to UTC.

### Changed

- Addon name, sidebar label ("Broker Import") and texts now cover both brokers. The addon `id` is unchanged, so existing installations and settings keep working.
- Shared activity helpers moved from `transform.ts` to `common.ts` (no behavior change for Trade Republic imports).

## [1.3.4] - 2026-10-04

### Fixed

- Cash activities were treated as securities when the cash account's currency was not EUR: `ImportPage` compared symbols against a hardcoded `$CASH-EUR`, while the transform emits `$CASH-<cash currency>`. Such cash activities showed up in the security-mapping step and had ticker mappings applied to them. Cash symbols are now recognised for any currency.

## [1.3.3] - 2026-08-24

### Changed

- Bumped `vite` (7→8), `@vitejs/plugin-react` (4→6), `typescript` (5→6), `@types/node` (20→24, matching the pinned Node 24 runtime), `papaparse` (5.6.1→5.7.0), and pnpm (10→11). Verified `dist/addon.js` still externalizes host-provided dependencies correctly under vite 8's new Rolldown-based bundler. No behavior changes — type-check, tests, and build all pass unmodified.

## [1.3.2] - 2026-08-24

### Changed

- Bumped the Wealthfolio host SDK family (`@wealthfolio/addon-sdk`, `@wealthfolio/ui`, `@wealthfolio/addon-dev-tools`) from 3.6.1 to 3.7.0, and refreshed other in-range dependencies (`papaparse`, `react`/`react-dom`, `tailwindcss`, `vitest`, and associated type packages). `manifest.json`'s `sdkVersion` and `hostDependencies` are updated to match. No behavior changes — type-check, tests, and build all pass unmodified.
- Added `.github/dependabot.yml` to check for dependency updates monthly.

## [1.3.1] - 2026-07-10

### Fixed

- Navigating between Import and Settings could silently stop working (clicking the tab did nothing) after the sandbox iframe migration in 1.2.0. Each route was creating its own React root, but the sandbox hands every route the same DOM container — the second `createRoot()` call collided with the still-live first one and its output was never shown. All routes now share a single root, as the SDK's own pattern expects.

## [1.3.0] - 2026-07-10

### Added

- Security mappings (ISIN → ticker or "custom") are now persisted across imports. Once a security is resolved, future imports of the same ISIN skip the mapping step entirely. Settings gained a "Security mappings" section to review or clear saved mappings.

### Fixed

- Uploading a non-CSV file (e.g. a zip) is now rejected before parsing, instead of producing confusing results from misread binary content.

## [1.2.0] - 2026-07-09

### Changed

- Migrated to Wealthfolio Addon SDK 3.6.1. Wealthfolio 3.6 runs addons in an isolated sandbox iframe — routes now render via `ctx.router.add({ render })` into a host-provided DOM node instead of the old `component: React.lazy(...)` pattern, and React/ReactDOM are imported directly (`react`, `react-dom/client`) instead of via SDK re-exports. The sidebar icon is now a host-drawn icon name (`bank`) instead of a custom SVG. No user-facing behavior changes.
- `manifest.json` now declares `minWealthfolioVersion` (3.6.0) and `hostDependencies`; the build externalizes `react`, `react-dom`, `@wealthfolio/addon-sdk`, and `@wealthfolio/ui` as ESM imports instead of bundling them with global-variable mapping.

## [1.1.1] - 2026-07-09

### Fixed

- Internal transfers (BUY funding, SELL/DIVIDEND cash sweeps, and matched Transfer Pattern pairs) no longer inflate Wealthfolio's spending totals. Each `TRANSFER_OUT`/`TRANSFER_IN` pair is now tagged with a shared `sourceGroupId`, which Wealthfolio's spending calculator uses to recognise the pair as an internal transfer rather than an expense.
- `CUSTOMER_OUTBOUND_REQUEST` (withdrawal requests to your linked bank account) now checks Transfer Patterns like `TRANSFER_OUTBOUND` already did — previously it was unconditionally recorded as a `WITHDRAWAL` even when a matching pattern with a destination account was configured, always counting it as spending.

## [1.1.0] - 2026-07-07

### Added

- Settings: account dropdowns now filter by type — cash selector shows only CASH accounts, securities selector shows only SECURITIES accounts
- Settings: account names in dropdowns now display their currency for easier identification
- Multi-currency support: cash account currency is captured from the selected account and used throughout the transform (symbol `$CASH-{CURRENCY}`, activity `currency` field) — no longer hardcoded to EUR

## [1.0.0] - 2026-07-07

### Added

- Import Trade Republic CSV exports (cash and portfolio activities)
- Two-account model: separate cash and portfolio accounts
- Automatic detection and mapping of internal fund transfers
- Security mapping step for unrecognised TR symbols
- Settings page for account selection and transfer pattern management
- Support for dividends, withholding tax, buy/sell, deposits, withdrawals, card transactions, interest, and Saveback

### Fixed

- All BUY, SELL, and TRANSFER_IN (broker transfer) activities imported as committed, not as drafts
- Activity deduplication: appends microsecond-precision time tag to every activity comment so that same-merchant/same-amount transactions (e.g. recurring card charges, ETF plan buys at the same price) are no longer collapsed into a single entry by Wealthfolio's idempotency key
