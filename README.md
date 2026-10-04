# Broker Importer

A Wealthfolio addon that imports Trade Republic and Scalable Capital CSV exports
into your portfolio. The export format is detected automatically.

## Overview

Trade Republic uses a two-account model: a **cash account** (where deposits,
withdrawals, dividends, and fees land) and a **portfolio account** (where
securities are held). This addon maps that model to two existing Wealthfolio
accounts you select in Settings.

## Upgrading from "Trade Republic Importer" (1.4.0 and earlier)

The addon was renamed to **Broker Importer** and its addon ID changed from
`trade-republic-importer` to `broker-importer`. Wealthfolio treats it as a new
addon, so:

1. Note your settings (accounts, transfer patterns, saved security mappings).
2. Uninstall the old **Trade Republic Importer** addon.
3. Install `broker-importer-addon.zip` as described below and set up the settings again.

Activities you already imported stay in Wealthfolio; only the addon's own
settings need to be re-entered.

## Updates

Wealthfolio can only update addons listed in its own store, which this addon
isn't (yet). Instead, the addon checks GitHub once a day for a newer release
and shows a hint with the download address of the new
`broker-importer-addon.zip` above the Import and Settings pages. To update,
download the ZIP and install it via **Settings → Add-ons → Install from File**;
the existing addon is replaced and your settings (accounts, transfer patterns,
security mappings) are kept.

The check needs network access to `api.github.com`, which Wealthfolio asks you
to approve when installing. Without it, everything else works; you just don't
get the hint.

## Setup

1. Install the addon:
   - Download the `broker-importer-addon.zip` asset from the
     [latest release](https://github.com/waldonso2/wealthfolio-importer-addon/releases/latest)
   - In Wealthfolio, go to **Settings → Add-ons**, click **Install from File**, and
     select the downloaded zip
   - This addon is registered in Wealthfolio's community addon directory for
     discovery, but that tier doesn't include in-app one-click installation —
     it must always be installed manually as described above
2. Go to **Broker Import → Settings**
3. Select the **Cash account** and **Portfolio account** for each broker you
   use — Trade Republic and/or Scalable Capital each get their own pair, so the
   two brokers never mix
4. Optionally add **Transfer Patterns** to categorise recurring bank transfers

## Importing

1. Export your transaction history:
   - Trade Republic: app → Profile → Documents → Transaction history → Export as CSV
   - Scalable Capital: export your transactions as CSV
     (`scalable_transactions_export_<date>_de.csv`)
2. Go to **Broker Import → Import**
3. Drop or select the CSV file
4. Review the parsed activities — duplicates are detected automatically
5. Map any unrecognised securities to their correct ticker (Security Mapping
   step)
6. Click **Import**

## Supported Transaction Types

| TR type                                                 | Wealthfolio activity                                |
| ------------------------------------------------------- | --------------------------------------------------- |
| TRADING / BUY                                           | BUY + FEE (if any)                                  |
| TRADING / SELL                                          | SELL + FEE (if any)                                 |
| DELIVERY / FREE_RECEIPT                                 | BUY at cost zero (gifted shares)                    |
| DELIVERY / MIGRATION                                    | Skipped (technical ISIN change, no net effect)      |
| CASH / CUSTOMER_INBOUND, CUSTOMER_INPAYMENT             | DEPOSIT                                             |
| CASH / CUSTOMER_OUTBOUND_REQUEST                        | WITHDRAWAL or TRANSFER (via transfer patterns)      |
| CASH / CARD_TRANSACTION, CARD_TRANSACTION_INTERNATIONAL | WITHDRAWAL                                          |
| CASH / CARD_ORDERING_FEE                                | FEE                                                 |
| CASH / BENEFITS_SAVEBACK                                | DIVIDEND (Saveback cashback)                        |
| CASH / DIVIDEND                                         | DIVIDEND (+ tax withholding entry if present)       |
| CASH / INTEREST_PAYMENT, MANUAL_CASH_TRANSFER           | INTEREST                                            |
| CASH / TRANSFER_DIRECT_DEBIT_INBOUND                    | DEPOSIT or TRANSFER (via transfer patterns)         |
| CASH / TRANSFER_INBOUND, TRANSFER_INSTANT_INBOUND       | DEPOSIT or TRANSFER (via transfer patterns)         |
| CASH / TRANSFER_OUTBOUND, TRANSFER_INSTANT_OUTBOUND     | WITHDRAWAL or TRANSFER (via transfer patterns)      |
| CASH / STOCKPERK                                        | Skipped (the corresponding BUY is imported instead) |

## Supported Scalable Capital Types

| Scalable `Typ`                                   | Wealthfolio activity                                          |
| ------------------------------------------------ | ------------------------------------------------------------- |
| Kauf                                             | BUY (funded by an internal cash → portfolio transfer)         |
| Verkauf                                          | SELL (proceeds swept back to cash)                            |
| Dividende                                        | DIVIDEND (net amount, swept back to cash)                     |
| Dividende with `CANCEL-…`                        | Skipped together with the cancelled original dividend         |
| Zinsen                                           | INTEREST                                                      |
| Einlage                                          | DEPOSIT                                                       |
| Entnahme                                         | WITHDRAWAL or TRANSFER (via transfer pattern keyword)         |
| TAX (e.g. Vorabpauschale)                        | TAX                                                           |
| Steuerrückerstattung                             | CREDIT (tax refund)                                           |
| FEE                                              | FEE                                                           |
| SWAP_OUT + security transfer out                 | SELL (fund liquidation)                                       |
| Zero-value security transfer out + Dividende     | SELL (certificate redemption)                                 |
| Security transfers (empty `Typ`)                 | Matching out/in legs (depot migration) skipped; others TRANSFER_IN/OUT |

Scalable exports use local time (Europe/Berlin), which is converted to UTC.

## Transfer Patterns

Transfer patterns let you classify recurring bank transfers (e.g. salary, rent)
as Wealthfolio TRANSFER activities instead of plain deposits/withdrawals. Each
pattern matches by **IBAN** or **keyword** in the transaction description.

Example: an IBAN `DE89 3704 0044 0532 0130 00` with label `Investment` will mark all
inbound transfers from that IBAN as a TRANSFER linked to a destination account
of your choice.

## Notes

- Currency is driven by the CSV. Cash activities use the corresponding currency
  symbol (e.g. `$CASH-EUR` for EUR, `$CASH-USD` for USD, etc.).
- Settings (account selection, transfer patterns) are stored securely in
  Wealthfolio's secrets store and pre-filled on every import.
- Internal money movements — BUY funding, SELL/DIVIDEND cash sweeps, and any
  Transfer Pattern with a destination account selected — are excluded from
  Wealthfolio's spending totals. Each `TRANSFER_OUT`/`TRANSFER_IN` pair the
  importer creates is tagged with a shared `sourceGroupId`, which Wealthfolio
  uses to recognise it as an internal transfer rather than an expense. A
  Transfer Pattern left without a destination account (i.e. a genuine external
  transfer) is recorded as a plain `WITHDRAWAL` and correctly counts as spending.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, fixture conventions, and versioning/release notes.
