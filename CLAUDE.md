# Broker Importer Addon

Wealthfolio addon that maps Trade Republic and Scalable Capital CSV exports to Wealthfolio activities. `src/formats.ts` detects the format from the CSV header and dispatches to `src/transform.ts` (Trade Republic) or `src/scalable.ts` (Scalable Capital); shared helpers live in `src/common.ts`. The React pages are thin wrappers that call the SDK.

## Quick Start (Claude Code Contributors)

```bash
pnpm install              # Install dependencies
pnpm test:watch           # Run tests in watch mode while developing
pnpm type-check           # Check TypeScript types
pnpm build                # Build to dist/addon.js
pnpm bundle               # Build + create ZIP for local Wealthfolio installation testing
```

The mapping logic lives in the per-broker transformers — `src/transform.ts` (Trade Republic) and `src/scalable.ts` (Scalable Capital) — with shared helpers in `src/common.ts` and format detection in `src/formats.ts`. Tests live next to them (`src/transform.test.ts`, `src/scalable.test.ts`, `src/updateCheck.test.ts`) with CSV fixtures in `src/__fixtures__/`. Start with the transformer of the broker you are changing; `docs/ARCHITECTURE.md` explains the whole flow, invariants and change recipes (incl. adding a new broker, section 12.6).

## Stack

- **Runtime / package manager**: Node 24, pnpm 11 (versions pinned in `.tool-versions`)
- **Build**: Vite 8 — outputs a single `dist/addon.js` (ES module, no zip)
- **Tests**: Vitest 4 — `src/transform.test.ts` (Trade Republic), `src/scalable.test.ts` (Scalable Capital, format detection, `tradeFinalCash`) and `src/updateCheck.test.ts` (update check) + CSV fixtures in `src/__fixtures__/`
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
| `src/updateCheck.test.ts` | Update check: version comparison, GitHub response parsing, caching, silent failures |
| `src/__fixtures__/tr-sample.csv` | 14-row fixture covering every supported Trade Republic transaction type |
| `src/__fixtures__/scalable-sample.csv` | 26-row fabricated Scalable fixture (BOM, CRLF, `;`, decimal comma) covering every supported Scalable type |
| `manifest.json` | Addon metadata; `version` here drives the release tag |
| `src/addon.tsx` | Entry point — registers pages and sidebar item via addon-sdk |
| `src/updateCheck.ts` / `src/UpdateBanner.tsx` | Daily GitHub release check (`ctx.api.network`, host `api.github.com`) and the update hint shown above both pages; the sandboxed iframe can't open external links, so the URL is shown for copying |
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

The release workflow never bumps the version itself — it only creates a GitHub release when `manifest.json`'s version has no matching git tag yet, so a merge to `main` without a version bump runs CI but publishes nothing. This is the deliberate gate for "only release on real changes": whenever a change to this addon touches actual logic (anything under `src/`, `manifest.json` permissions/metadata, transaction-mapping behavior, etc.) rather than just docs/CI/README, **proactively propose a semver bump** (patch/minor/major, with reasoning) before merging — don't wait to be asked. Docs-only or pipeline-only changes should merge without a bump.

Once a bump is agreed, apply it by bumping the `version` field in **both** `manifest.json` and `package.json`, and add a `CHANGELOG.md` entry, then push/merge to `main`. The release workflow will:

1. Run type-check, tests, and `pnpm bundle`
2. Detect the new version tag doesn't exist yet
3. Create a GitHub release `v{version}` with the changelog section, `dist/broker-importer-addon.zip` (the installable package), and `dist/addon.js` attached

This addon is not listed in the Wealthfolio store or community registry — end users always install manually from the GitHub release zip (Settings → Add-ons → Install from File), per `README.md`; the in-addon update hint (`src/updateCheck.ts`) points them to new releases.

## Two-account model

Trade Republic uses:
- **Cash account** — deposits, withdrawals, dividends, fees, card transactions
- **Portfolio account** — security positions

Buying a stock moves funds Cash → Portfolio (TRANSFER_OUT / TRANSFER_IN pair) then records the BUY. Selling is the reverse. This pairing is required by Wealthfolio to keep account balances consistent.

Scalable Capital uses the same model with its **own** account pair (`scalableCashAccountId` / `scalablePortfolioAccountId` in `AddonSettings`), so users of both brokers never mix them. Every internal pair in `scalable.ts` follows the same `transferGroupId` rule below, with `sc-`-prefixed IDs.

## Internal transfers and spending

Every TRANSFER_OUT/TRANSFER_IN pair the transformers (`transform.ts`, `scalable.ts`) generate for an internal movement (BUY funding, SELL/DIVIDEND cash sweep, or a matched Transfer Pattern with a `destinationAccountId`) is tagged with a shared `transferGroupId` (see `ActivityImportEx` in `src/types.ts`). `ImportPage.tsx` forwards that value as `sourceGroupId` on the `ActivityCreate`/`ActivityUpdate` calls it makes — this addon submits activities one at a time via `ctx.api.activities.create()`/`.update()`, never through Wealthfolio's bulk-import pipeline, so Wealthfolio's own transfer-pair auto-linker never runs; without an explicit `sourceGroupId` these pairs get miscounted as spending. `ActivityImport` (the type `transform()` returns) has no `sourceGroupId` field, and `ctx.api.activities.checkImport()` drops unknown fields, so `transferGroupId` can't ride through that round-trip — `ImportPage.tsx` re-derives it by `lineNumber` (which does survive `checkImport`) from the pre-check transformer output. Any new internal-transfer pair added to `transform.ts` or `scalable.ts` must get its own `transferGroupId` or it will silently inflate spending.

Every `BUY`/`SELL` must set `amount: tradeFinalCash(...)` (`src/common.ts`) — the exact decimal `quantity × unitPrice ± fee`. Wealthfolio's duplicate fingerprint hashes the exact `amount`; it derives that value when a trade is created without one, but `checkImport` hashes the submitted value, so a trade without it is never recognised as a duplicate on re-import.

Only **outbound** CASH types (`CUSTOMER_OUTBOUND_REQUEST`, `TRANSFER_OUTBOUND`/`TRANSFER_INSTANT_OUTBOUND`, `TRANSFER_DIRECT_DEBIT_INBOUND`) check `transferPatterns` — they default to spend (`WITHDRAWAL`) unless matched to a pattern with a `destinationAccountId`, at which point they become an internal transfer. **Inbound** CASH types (`CUSTOMER_INBOUND`/`CUSTOMER_INPAYMENT`, `TRANSFER_INBOUND`/`TRANSFER_INSTANT_INBOUND`) are intentionally always `DEPOSIT` with no pattern check — an unrecognised inbound transfer is treated as external income by design, not matched against your own accounts. Scalable Capital follows the same split: `Entnahme` is outbound (patterns match the `Notiz` text only — the export has no counterparty IBAN), `Einlage` is always `DEPOSIT`. Keep new CASH types consistent with this outbound/inbound split rather than adding pattern-matching to inbound types.

## Security mapping persistence

`AddonSettings.securityMappings` (ISIN → `SecurityMapping`) is persisted alongside the rest of the addon config via `settings.ts`. `ImportPage.tsx` pre-fills the mapping step from it on every upload and, if every ISIN in the file is already known, skips `SecurityMappingStep` entirely and goes straight to `checkImport` — so a repeat import of a previously-mapped security requires no user interaction. New mappings (including "custom") are written back to settings as soon as the user completes the mapping step. Because the skip path bypasses the per-import "Clear" button, `SettingsPage.tsx` exposes a list of saved mappings with per-entry removal so a wrong mapping can be corrected without re-importing.
