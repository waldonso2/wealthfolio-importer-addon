# Broker Importer Addon

Wealthfolio addon that maps Trade Republic and Scalable Capital CSV exports, and PDF trade/dividend statements from Trade Republic, Scalable Capital and DKB, to Wealthfolio activities. `src/formats.ts` detects the format from the CSV header and dispatches to `src/transform.ts` (Trade Republic) or `src/scalable.ts` (Scalable Capital); shared helpers live in `src/common.ts`. PDFs go through `src/pdf/` (`parsePdfFiles`: pdf.js text → per-broker parser → activities) and then the same wizard. The React pages are thin wrappers: the import logic (security mapping, activity status, create/update payloads, the import run with failure collection and retry) lives in `src/importer.ts`, the pre-import check in `src/reconcile.ts`.

## Quick Start (Claude Code Contributors)

```bash
pnpm install              # Install dependencies
pnpm test:watch           # Run tests in watch mode while developing
pnpm type-check           # Check TypeScript types
pnpm build                # Build to dist/addon.js
pnpm bundle               # Build + create ZIP for local Wealthfolio installation testing
```

The mapping logic lives in the per-broker transformers — `src/transform.ts` (Trade Republic) and `src/scalable.ts` (Scalable Capital) — with shared helpers in `src/common.ts` and format detection in `src/formats.ts`. Tests live next to them (`src/transform.test.ts`, `src/scalable.test.ts`, `src/reconcile.test.ts`, `src/importer.test.ts`, `src/pdf/pdf.test.ts`) with CSV fixtures in `src/__fixtures__/`. Start with the transformer of the broker you are changing; `docs/ARCHITECTURE.md` explains the whole flow, invariants and change recipes (incl. adding a new broker, section 12.6).

## Stack

- **Runtime / package manager**: Node 24, pnpm 11 (versions pinned in `.tool-versions`)
- **Build**: Vite 8 — outputs a single `dist/addon.js` (ES module, no zip)
- **Tests**: Vitest 4 — `src/transform.test.ts` (Trade Republic), `src/scalable.test.ts` (Scalable Capital, format detection, `tradeFinalCash`) `src/reconcile.test.ts` (pre-import reconciliation), `src/importer.test.ts` (import logic with a faked activities API), `src/pdf/pdf.test.ts` (PDF parsers, mapping, pdf.js on a generated PDF) + CSV fixtures in `src/__fixtures__/`, fabricated statement texts in `src/__fixtures__/pdf/`
- **PDF**: `pdfjs-dist` 4.10 legacy build, worker bundled and run on the main thread (`src/pdf/text.ts`); `vite.config.ts` aliases the pre-minified files
- **Type checking**: `tsc --noEmit`

## Key files

| File | Purpose |
|---|---|
| `src/transform.ts` | Trade Republic: pure CSV-row → ActivityImport mapping |
| `src/scalable.ts` | Scalable Capital: pure CSV-row → ActivityImport mapping, incl. netting of cancellations/depot migrations and Europe/Berlin → UTC |
| `src/formats.ts` | Format detection + parsing (delimiter, BOM) and dispatch to the right transformer |
| `src/common.ts` | Helpers shared by both transformers (`makeCashAct`, `matchPattern`, `sortAndNumber`, …) |
| `src/transform.test.ts` | Trade Republic tests (unit + fixture integration) |
| `src/scalable.test.ts` | Scalable Capital tests (unit + fixture integration), format detection, `tradeFinalCash` |
| `src/remap.ts` / `src/remap.test.ts`, `src/RemapPanel.tsx` | Correcting a wrong ISIN mapping (#41): suspicious-mapping warning, activities on the mapped asset, moving them to another asset |
| `src/importer.ts` / `src/importer.test.ts` | Import logic without React: `applySecurityMappings`, `activityStatus`, `selectCandidates`, `groupIdsByLine`, `buildPayload`, `matchExisting` (same trade/dividend already imported from the other source, CSV ↔ PDF), `importButtonLabel`, `runImport` (counts new vs. updated, collects failures with Wealthfolio's message; retry re-runs only those), `failedAsCsv`. Change import behaviour here, not in `ImportPage.tsx` |
| `src/reconcile.ts` / `src/reconcile.test.ts` | Pre-import check shown in the review step: cash balance vs. the broker's balance from the file (`trBrokerCash` / `scalableBrokerCash`), cash left on the securities account, holdings. `cashEffect()` mirrors Wealthfolio's cash rules — extend it with every new activity type or subtype |
| `src/__fixtures__/tr-sample.csv` | 26-row fixture covering every supported Trade Republic transaction type |
| `src/__fixtures__/scalable-sample.csv` | 26-row fabricated Scalable fixture (BOM, CRLF, `;`, decimal comma) covering every supported Scalable type |
| `src/pdf/` | PDF statements: `text.ts` (pdf.js → lines), `parse.ts` (broker detection), `tradeRepublic.ts` / `scalable.ts` / `dkb.ts` (parsers → `PdfTransaction` or a reason), `activities.ts` (two-account mapping, same rules as the CSV transformers), `index.ts` (`parsePdfFiles`). Never put real statements into fixtures — fabricate them in the real layout |
| `manifest.json` | Addon metadata; `version` here drives the release tag |
| `src/addon.tsx` | Entry point — registers pages and sidebar item via addon-sdk |
| `docs/ARCHITECTURE.md` | Full architecture (German): modules, data flow, invariants, change recipes |

## Commands

```bash
pnpm install          # install deps
pnpm type-check       # tsc --noEmit
pnpm test             # vitest run (once)
pnpm test:watch       # vitest (watch mode)
pnpm build            # vite build → dist/addon.js
pnpm bundle           # build + zip → dist/broker-importer-addon.zip (for local install testing)
pnpm dev              # vite build --watch
```

## Releasing

**The version follows Wealthfolio** (since 3.9.0): `major.minor` is the Wealthfolio/SDK line the addon is built for, the patch counts our releases on that line. `sdkVersion` and `minWealthfolioVersion` are `<line>.0`, every `@wealthfolio/*` dependency (package.json and manifest `hostDependencies`) is `^<line>.0`; `pnpm check:versions` (`scripts/check-versions.mjs`, run in CI and release) fails otherwise. A new Wealthfolio line (the weekly `sdk-watch.yml` workflow opens an issue; Dependabot ignores `@wealthfolio/*` minor/major) means bumping all of these to `<line>.0` together and releasing, even without other changes.

The release workflow never bumps the version itself — it only creates a GitHub release when `manifest.json`'s version has no matching git tag yet, so a merge to `main` without a version bump runs CI but publishes nothing. This is the deliberate gate for "only release on real changes": whenever a change to this addon touches actual logic (anything under `src/`, `manifest.json` permissions/metadata, transaction-mapping behavior, etc.) rather than just docs/CI/README, **proactively propose a patch bump** on the current line (say whether it's a feature or a fix) before merging — don't wait to be asked. Docs-only or pipeline-only changes should merge without a bump.

Once a bump is agreed, apply it by bumping the `version` field in **both** `manifest.json` and `package.json`, and add a `CHANGELOG.md` entry, then push/merge to `main`. The release workflow will:

1. Run type-check, tests, and `pnpm bundle`
2. Detect the new version tag doesn't exist yet
3. Create a GitHub release `v{version}` with the changelog section, `dist/broker-importer-addon.zip` (the installable package), and `dist/addon.js` attached

The addon is (being) listed in the Wealthfolio community directory (`wealthfolio/wealthfolio-addons`, `community/directory/broker-importer/addon.store.json`, #32). That listing is a link only: users always install manually from the GitHub release zip (Settings → Add-ons → Install from File), per `README.md`, and Wealthfolio doesn't update community addons; users learn about releases from GitHub or the directory. The addon makes **no network requests** (the GitHub update hint was removed in 3.9.0), so the manifest has no `network` permission and the directory shows that no data leaves the device — keep it that way unless a feature really needs a host. The listing's compatibility, licence and data handling are derived from this repo's `manifest.json` and LICENSE, so keep the manifest `id` (`broker-importer`) and `sdkVersion` accurate.

## Two-account model

Trade Republic uses:
- **Cash account** — deposits, withdrawals, dividends, fees, card transactions
- **Portfolio account** — security positions

Buying a stock moves funds Cash → Portfolio (TRANSFER_OUT / TRANSFER_IN pair) then records the BUY. Selling is the reverse. This pairing is required by Wealthfolio to keep account balances consistent.

The portfolio account must end up holding no cash: every cash-moving activity there (dividend, tax, buy, sell) is in the cash currency and fully swept to/from the cash account. Wealthfolio keeps cash per currency, so a DIVIDEND booked in USD next to an EUR tax and EUR sweep leaves USD cash and an EUR deficit behind — foreign dividends are booked in the payout currency, with the original amount only in the comment.

Scalable Capital uses the same model with its **own** account pair (`scalableCashAccountId` / `scalablePortfolioAccountId` in `AddonSettings`), so users of both brokers never mix them. PDF statements import into the pair of their broker (`formatAccounts`); DKB, which has no CSV import, has its own pair (`dkbCashAccountId` / `dkbPortfolioAccountId`). PDF activities use `pdf-tr-`/`pdf-sc-`/`pdf-dkb-` group IDs and comments ending in `[PDF <docId>]` — part of the duplicate fingerprint, so don't reword them. Every internal pair in `scalable.ts` follows the same `transferGroupId` rule below, with `sc-`-prefixed IDs.

## Internal transfers and spending

Every TRANSFER_OUT/TRANSFER_IN pair the transformers (`transform.ts`, `scalable.ts`) generate for an internal movement (BUY funding, SELL/DIVIDEND cash sweep, or a matched Transfer Pattern with a `destinationAccountId`) is tagged with a shared `transferGroupId` (see `ActivityImportEx` in `src/types.ts`). `ImportPage.tsx` (via `buildPayload` in `src/importer.ts`) forwards that value as `sourceGroupId` on the `ActivityCreate`/`ActivityUpdate` calls it makes — this addon submits activities one at a time via `ctx.api.activities.create()`/`.update()`, never through Wealthfolio's bulk-import pipeline, so Wealthfolio's own transfer-pair auto-linker never runs; without an explicit `sourceGroupId` these pairs get miscounted as spending. `ActivityImport` (the type `transform()` returns) has no `sourceGroupId` field, and `ctx.api.activities.checkImport()` drops unknown fields, so `transferGroupId` can't ride through that round-trip — `groupIdsByLine` in `src/importer.ts` re-derives it by `lineNumber` (which does survive `checkImport`) from the pre-check transformer output. Any new internal-transfer pair added to `transform.ts` or `scalable.ts` must get its own `transferGroupId` or it will silently inflate spending. The one exception is a security swapped for a different ISIN (Trade Republic corporate actions in `planSpecialRows`): Wealthfolio rejects transfer pairs between different assets, so those legs stay unpaired and carry the cost basis as `unitPrice`.

Every `BUY`/`SELL` must set `amount: tradeFinalCash(...)` (`src/common.ts`) — the exact decimal `quantity × unitPrice ± (fee + tax)`. Fee and tax go into the separate `fee` and `tax` fields (both brokers; Scalable's export has no tax on dividends); `amount` is always the actual cash flow, and Wealthfolio reports fee and tax from those fields — so a dividend or interest payment is one activity with its net `amount` and the withholding `tax`, not a gross activity plus a TAX row. `tax` is not part of the duplicate fingerprint, but `fee` and `amount` are. Wealthfolio's duplicate fingerprint hashes the exact `amount`; it derives that value when a trade is created without one, but `checkImport` hashes the submitted value, so a trade without it is never recognised as a duplicate on re-import.

Every skipped row carries `kind` (`netted` = on purpose, nothing to do; `missing` = not imported) and, when missing, a `hint` telling the user what to add manually — keep that for new skip reasons.

The `comment` is part of that fingerprint too: never reword the comments an existing type produces, or every previously imported activity of that type reappears as new. New types get their own wording (e.g. the `DIVIDEND_LIKE` labels in `transform.ts`).

Only **outbound** CASH types (`CUSTOMER_OUTBOUND_REQUEST`, `TRANSFER_OUTBOUND`/`TRANSFER_INSTANT_OUTBOUND`, `TRANSFER_DIRECT_DEBIT_INBOUND`) check `transferPatterns` — they default to spend (`WITHDRAWAL`) unless matched to a pattern with a `destinationAccountId`, at which point they become an internal transfer. **Inbound** CASH types (`CUSTOMER_INBOUND`/`CUSTOMER_INPAYMENT`, `TRANSFER_INBOUND`/`TRANSFER_INSTANT_INBOUND`) are intentionally always `DEPOSIT` with no pattern check — an unrecognised inbound transfer is treated as external income by design, not matched against your own accounts. Scalable Capital follows the same split: `Entnahme` is outbound (patterns match the `Notiz` text only — the export has no counterparty IBAN), `Einlage` is always `DEPOSIT`. Keep new CASH types consistent with this outbound/inbound split rather than adding pattern-matching to inbound types.

## Security mapping persistence

`AddonSettings.securityMappings` (ISIN → `SecurityMapping`) is persisted alongside the rest of the addon config via `settings.ts`. `ImportPage.tsx` pre-fills the mapping step from it on every upload and, if every ISIN in the file is already known, skips `SecurityMappingStep` entirely and goes straight to `checkImport` — so a repeat import of a previously-mapped security requires no user interaction. New mappings (including "custom") are written back to settings as soon as the user completes the mapping step. Because the skip path bypasses the per-import "Clear" button, `SettingsPage.tsx` exposes a list of saved mappings with per-entry removal so a wrong mapping can be corrected without re-importing.

`AddonSettings.securityNames` (ISIN → name from the broker's file) is remembered alongside. `src/remap.ts` uses it for `mappingWarning` (target symbol is another ISIN, different leverage factor or long/short — shown in the mapping step, the review step and the settings list) and to preselect activities in *Change* (`RemapPanel.tsx`), which moves chosen activities already booked on the old asset to the new one via `activities.update` with every other field unchanged (comment and amounts are part of the duplicate fingerprint). The ISIN is not in the comments, so the user confirms which activities belong to it; cash transfers carry no asset and are never touched.
