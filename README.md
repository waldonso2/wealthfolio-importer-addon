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
2. In Wealthfolio: **Settings → Add-ons → Install from File**.

This is a community addon (see the [Wealthfolio community directory](https://wealthfolio.app/addons/community)):
Wealthfolio installs community addons only from file and doesn't update them, and the
addon itself makes no network requests. To update, watch this repository's releases
(GitHub: **Watch → Custom → Releases**) or the directory, and install the new ZIP the same
way. Reinstalling keeps your settings.

Upgrading from **Trade Republic Importer** (≤ 1.4.0): the addon ID changed, so
uninstall the old addon, install this one and set up the settings again. Already
imported activities are not affected.

## Setup

In **Broker Import → Settings**, select the cash and securities account for each
broker you use. PDF statements of Trade Republic and Scalable Capital go into the same
accounts as their CSV export; DKB has its own pair. Optionally add **transfer patterns** (see below).

## Import

1. Export your transactions as CSV (see [Getting the CSV export](#getting-the-csv-export)).
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

## Getting the CSV export

**Trade Republic** — in the app: Profile → Documents → Transaction history, export as
CSV. The file holds the full history of your account (cash and securities), so one file is
enough; re-importing a newer export later only adds what is new.

**Scalable Capital** — Scalable has no complete transaction export of its own. The importer
reads the CSV created by the
[Scalable Capital Transactions Exporter](https://github.com/matthesvoss/Scalable-Capital-Transactions-Exporter)
by Matthes Voß (MIT, a browser userscript; not part of this addon):

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension, then the
   userscript `scalable-capital-transactions-exporter.user.js` from that repository.
2. Log in to Scalable Capital and open the **Transactions** page of your broker account
   (reload the page if the menu entries below don't appear).
3. In the Tampermonkey menu choose **Export Transactions CSV DE**, optionally limit the
   date range, and save `scalable_transactions_export_<date>_de.csv`.

Use the **DE** variant: it writes `;`-separated columns with German headers, which the
importer recognises. The **EN** variant (comma-separated, English headers) is not supported.

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
| Trade Republic | [`tr-sample.csv`](src/__fixtures__/tr-sample.csv) | `,`-separated, values in `"…"`, decimal point, UTC timestamps |
| Scalable Capital | [`scalable-sample.csv`](src/__fixtures__/scalable-sample.csv) | `;`-separated, decimal comma, UTF-8 with BOM, Europe/Berlin local time |
| PDF statements | [`src/__fixtures__/pdf/`](src/__fixtures__/pdf) | the text the importer reads from a PDF (buy, sell, dividend per broker), not PDFs themselves |

Each CSV sample covers every supported transaction type of its broker; the Scalable one also
has one deliberately unsupported row to show the **Skipped** list.

Header and one row (a buy) of each CSV format:

**Trade Republic**

```csv
"datetime","date","account_type","category","type","asset_class","name","symbol","shares","price","amount","fee","tax","currency","original_amount","original_currency","fx_rate","description","transaction_id","counterparty_name","counterparty_iban","payment_reference","mcc_code"
"2024-01-20T11:35:34.000Z","2024-01-20","DEFAULT","TRADING","BUY","FUND","FTSE All-World USD (Acc)","IE00BK5BQT80","2.0000000000","100.000000","-200.00","-1.00","","EUR","","","","","00000000-0000-0000-0000-000000000002","","","",""
```

**Scalable Capital** (Transactions Exporter, DE variant)

```csv
Datum;Uhrzeit;Typ;Wertpapiername;ISIN;Wert;Stück;Buchungswährung;Gebühren;Steuern;Bruttobetrag;Notiz
16.06.2026;20:09:37;Kauf;Test World ETF (Dist);IE00TEST0001;-1001;10;EUR;1;0;1000;ORDER0001
```

The format is detected from the header line, so the column order and names must stay as
exported.

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
(Apache-2.0). Scalable Capital CSV files come from the
[Scalable Capital Transactions Exporter](https://github.com/matthesvoss/Scalable-Capital-Transactions-Exporter)
by **Matthes Voß**.

This addon is based on the
[Trade Republic Importer](https://github.com/blastik/trade-republic-importer-addon)
by **blastik** — thank you for the original importer, the two-account model and
the Trade Republic mapping this project builds on.

## License

[MIT](LICENSE)
