# Broker Importer

A [Wealthfolio](https://wealthfolio.app) addon that imports **Trade Republic** and
**Scalable Capital** CSV exports, and PDF trade and dividend statements from **Trade
Republic**, **Scalable Capital** and **DKB**. The broker is detected automatically; each
broker uses its own pair of Wealthfolio accounts (cash + securities), with internal
transfers between them so balances and spending stay correct.

## Install and update

Requires **Wealthfolio 3.9** or later. The version follows Wealthfolio: `3.9.x` is built
and tested for Wealthfolio 3.9, and a new Wealthfolio version gets a matching addon release.

1. Download `broker-importer-addon.zip` from the
   [latest release](https://github.com/waldonso2/wealthfolio-importer-addon/releases/latest).
2. In Wealthfolio: **Settings → Add-ons → Install from File**. Approve
   `api.github.com` if you want update hints.

Wealthfolio installs community addons only from file and doesn't update them. Instead
the addon checks GitHub once a day and shows a hint when a newer release exists;
install it the same way. Reinstalling keeps your settings.

Upgrading from **Trade Republic Importer** (≤ 1.4.0): the addon ID changed, so
uninstall the old addon, install this one and set up the settings again. Already
imported activities are not affected.

## Setup

In **Broker Import → Settings**, select the cash and securities account for each
broker you use. PDF statements of Trade Republic and Scalable Capital go into the same
accounts as their CSV export; DKB has its own pair. Optionally add **transfer patterns** (see below).

## Import

1. Export your transactions as CSV:
   - Trade Republic: app → Profile → Documents → Transaction history
   - Scalable Capital: transactions export (`scalable_transactions_export_<date>_de.csv`)
2. **Broker Import → Import**, drop the file.
3. Map unknown securities to a ticker (remembered for future imports).
4. Review and import. Activities that already exist are flagged as duplicates and
   updated; the button shows how many are new and how many are updated. Above the
   list, a check shows the cash balance after the import next to the broker's balance from
   the file, warns about cash left on the securities account or negative holdings, and the
   **Holdings** tab lists the resulting positions — compare them with your broker app.
5. If Wealthfolio rejects some activities, the result page lists them with Wealthfolio's
   reason. Fix the cause (e.g. the security mapping) and press **Retry**, or copy the list
   as CSV and add them manually.

## PDF statements

Drop any number of PDF statements of one broker at once (e.g. all statements of a month).
Supported are trade statements (buy, sell; Trade Republic also savings plan, round-up,
Saveback) and dividend/distribution statements:

| Broker | Recognised | Imported as |
| --- | --- | --- |
| Trade Republic | Wertpapierabrechnung, Dividende, Ausschüttung (German) | BUY / SELL with fee and tax in their own fields + internal cash transfer; DIVIDEND with gross, withholding and German tax in its tax field + transfer to cash |
| Scalable Capital | Wertpapierabrechnung (Kauf, Verkauf), Dividende | as above — the dividend statement has the tax that the CSV export lacks |
| DKB | Wertpapier Abrechnung Kauf / Verkauf (also fund issue and redemption), Dividendengutschrift, Ausschüttung | as above |

Other documents (account statements, Vorabpauschale, interest, corporate actions,
cancellations, bonds) are listed under **Skipped** with the reason. A statement that is
uploaded twice is imported once, and importing it again later is recognised as a
duplicate. Statements hold no deposits or withdrawals, so the cash account shows only
their effect.

Trades and dividends that are already in Wealthfolio from the other source (CSV export
vs. PDF statement) are marked **In Wealthfolio** in the review and skipped together with
their cash transfers, unless you include them. They are found by account, type,
security, day, shares and amount.

## Example files

Fabricated data in the real export format, to see what the importer expects or to try it
out with a throwaway account:

| Broker | File | Format |
| --- | --- | --- |
| Trade Republic | [`tr-sample.csv`](src/__fixtures__/tr-sample.csv) | `,`-separated, decimal point, UTC timestamps; header `"datetime","date","account_type","category","type",…` |
| Scalable Capital | [`scalable-sample.csv`](src/__fixtures__/scalable-sample.csv) | `;`-separated, decimal comma, UTF-8 with BOM, Berlin local time; header `Datum;Uhrzeit;Typ;Wertpapiername;ISIN;Wert;Stück;…` |
| PDF statements | [`src/__fixtures__/pdf/`](src/__fixtures__/pdf) | the text the importer reads from a PDF (buy, sell, dividend per broker), not PDFs themselves |

Each sample covers every supported transaction type of its broker, plus one row that is
deliberately unsupported to show the **Skipped** list.

## Supported transactions

**Trade Republic**

| Type | Wealthfolio |
| --- | --- |
| Buy / Sell | BUY / SELL with fee and tax in their own fields + internal cash transfer |
| Dividend, fund distribution, share-exchange cash | one DIVIDEND in the payout currency with the withholding tax in its tax field (original foreign amount in the comment) + transfer to cash; reversals are netted out |
| Vorabpauschale, tax adjustments / optimisation | TAX, or CREDIT (tax refund) when positive |
| Deposits (`CUSTOMER_INBOUND`, `TRANSFER_INBOUND`, …) | DEPOSIT |
| Outgoing transfers (`TRANSFER_OUTBOUND`, `CUSTOMER_OUTBOUND_REQUEST`, direct debits) | WITHDRAWAL, or TRANSFER via transfer pattern |
| Card payments / refunds | WITHDRAWAL / DEPOSIT |
| Interest, card fee, Saveback, referral bonus | INTEREST (withholding tax in its tax field), FEE, CREDIT (bonus) |
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
| Kauf / Verkauf | BUY / SELL with fee and tax in their own fields + internal cash transfer |
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

The PDF statement layouts were worked out with the help of the PDF importers and test
documents of [Portfolio Performance](https://github.com/portfolio-performance/portfolio);
no code was taken from it. PDFs are read with [pdf.js](https://mozilla.github.io/pdf.js/)
(Apache-2.0).

This addon is based on the
[Trade Republic Importer](https://github.com/blastik/trade-republic-importer-addon)
by **blastik** — thank you for the original importer, the two-account model and
the Trade Republic mapping this project builds on.

## License

[MIT](LICENSE)
