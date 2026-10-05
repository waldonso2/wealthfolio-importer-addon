# Broker Importer

A [Wealthfolio](https://wealthfolio.app) addon that imports **Trade Republic** and
**Scalable Capital** CSV exports. The format is detected automatically; each broker
uses its own pair of Wealthfolio accounts (cash + securities), with internal
transfers between them so balances and spending stay correct.

## Install and update

1. Download `broker-importer-addon.zip` from the
   [latest release](https://github.com/waldonso2/wealthfolio-importer-addon/releases/latest).
2. In Wealthfolio: **Settings → Add-ons → Install from File**. Approve
   `api.github.com` if you want update hints.

The addon isn't listed in the Wealthfolio store, so Wealthfolio can't update it.
Instead it checks GitHub once a day and shows a hint when a newer release exists;
install it the same way. Reinstalling keeps your settings.

Upgrading from **Trade Republic Importer** (≤ 1.4.0): the addon ID changed, so
uninstall the old addon, install this one and set up the settings again. Already
imported activities are not affected.

## Setup

In **Broker Import → Settings**, select the cash and securities account for each
broker you use. Optionally add **transfer patterns** (see below).

## Import

1. Export your transactions as CSV:
   - Trade Republic: app → Profile → Documents → Transaction history
   - Scalable Capital: transactions export (`scalable_transactions_export_<date>_de.csv`)
2. **Broker Import → Import**, drop the file.
3. Map unknown securities to a ticker (remembered for future imports).
4. Review — activities that already exist are flagged as duplicates — and import.

## Supported transactions

**Trade Republic**

| Type | Wealthfolio |
| --- | --- |
| Buy / Sell | BUY / SELL (fees and taxes as fee) + internal cash transfer |
| Dividend, fund distribution, share-exchange cash | DIVIDEND in the payout currency (original foreign amount in the comment) + TAX for withholding + transfer to cash; reversals are netted out |
| Vorabpauschale, tax adjustments / optimisation | TAX, or CREDIT (tax refund) when positive |
| Deposits (`CUSTOMER_INBOUND`, `TRANSFER_INBOUND`, …) | DEPOSIT |
| Outgoing transfers (`TRANSFER_OUTBOUND`, `CUSTOMER_OUTBOUND_REQUEST`, direct debits) | WITHDRAWAL, or TRANSFER via transfer pattern |
| Card payments / refunds | WITHDRAWAL / DEPOSIT |
| Interest, card fee, Saveback, referral bonus | INTEREST, FEE, CREDIT (bonus) |
| Gifted shares (Stockperk), share delivery | BUY funded by a bonus credit, TRANSFER_IN |
| ISIN migration | skipped |
| Share exchange, ADR discontinuation, reorganisation, reverse split into a new ISIN | TRANSFER_OUT of the old and TRANSFER_IN of the new ISIN, carrying the cost basis (computed from the file) |
| Worthless write-off | SELL at 0 |
| Stock split | SPLIT (ratio derived from the shares held, computed from the file) |
| Stock dividend | DIVIDEND in kind (income plus shares) |
| Dividend reinvestment | BUY of the new shares, paid from the cash account |

**Scalable Capital**

| Typ | Wealthfolio |
| --- | --- |
| Kauf / Verkauf | BUY / SELL + internal cash transfer |
| Dividende | DIVIDEND (net) + transfer to cash; cancellations are netted out |
| Einlage / Entnahme | DEPOSIT / WITHDRAWAL, or TRANSFER via transfer pattern |
| Zinsen, FEE, TAX, Steuerrückerstattung | INTEREST, FEE, TAX, CREDIT (tax refund) |
| Fund liquidation (`SWAP_OUT`), certificate redemption | SELL |
| Depot migration (paired out/in transfers) | skipped |

Rows that aren't imported are listed under **Skipped**, never silently dropped. Each
shows a status – *No action needed* (e.g. a reversal and the dividend it cancels) or
*Not imported* – and for the latter a hint on what to add manually.

## Transfer patterns

Outgoing transfers to your own accounts (e.g. a savings or pension account) can
be recorded as an internal transfer instead of a withdrawal: add a pattern with
an **IBAN** and/or **keyword** and a destination account. Scalable exports have no
counterparty IBAN, so only the keyword (matched against the note) applies there.
Incoming transfers are always deposits.

## More

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — architecture, mapping rules, invariants (German)
- [CHANGELOG.md](CHANGELOG.md) — release notes
- [CONTRIBUTING.md](CONTRIBUTING.md) — local setup, tests, releases

## Credits

This addon is based on the
[Trade Republic Importer](https://github.com/blastik/trade-republic-importer-addon)
by **blastik** — thank you for the original importer, the two-account model and
the Trade Republic mapping this project builds on.

## License

[MIT](LICENSE)
