# Kennzahlen

Woran wir Sicherheit, Bedienbarkeit und Leistung des Addons messen, gegliedert nach dem Qualitätsmodell
**ISO/IEC 25010**. **Blockierend** heißt: Die CI scheitert, wenn der Wert nicht erreicht wird. **Bericht** heißt:
Der Wert wird bei jedem Lauf gemessen und auf der Zusammenfassungsseite des CI-Laufs gezeigt (`pnpm perf`, Ergebnis
in `$GITHUB_STEP_SUMMARY`), hält die CI aber nie an.

## Sicherheit (Security)

| Kennzahl | Ziel | Referenz | Wo gemessen | Art |
|---|---|---|---|---|
| Häufigste Risiken abgedeckt | alle 10 | OWASP Top 10 (2025) | Reviews, CodeQL | Leitlinie |
| Funde der Code-Analyse | 0 offen | CodeQL (`codeql.yml`, security-extended) | Security → Code scanning | Bericht |
| Funde in den Workflows | 0 ab „medium“ | zizmor | CI-Job `workflows` | blockierend |
| Bekannte Lücken in dem, was ausgeliefert wird | 0 | `pnpm audit --prod`, Dependency Review | CI-Jobs `ci`, `dependency-review` | blockierend |
| Geheimnisse im Repository | 0 | gitleaks | CI-Job `secrets` | blockierend |
| Netzwerkzugriffe | keine | Manifest ohne `network`-Berechtigung | `manifest.json` | Leitlinie |
| Sicherheit des Repositorys | ≥ 7 von 10 | OpenSSF Scorecard | `scorecard.yml`, Security → Code scanning | Bericht |
| Zeit bis zur Behebung einer Lücke | kritisch ≤ 7 Tage, hoch ≤ 30 Tage | übliche Fristen | Security Advisories, Dependabot | Leitlinie |

## Bedienbarkeit (UI)

| Kennzahl | Ziel | Referenz | Wo gemessen | Art |
|---|---|---|---|---|
| Barrierefreiheit der Seiten | 0 Verstöße | WCAG 2.2 AA, axe-core | `src/pages.test.tsx`: Einstellungen, Upload, Wertpapier-Zuordnung, Prüfung | blockierend |
| Barrierefreiheit im Code | 0 Funde | eslint-plugin-jsx-a11y | `pnpm lint` | blockierend |
| Farbkontrast | ≥ 4,5 : 1 (Text) | WCAG 2.2 AA | – (jsdom berechnet kein Layout; die Farben kommen aus Wealthfolio) | – |
| Texte in beiden Sprachen | jeder Schlüssel in DE und EN | eigenes Ziel (#74) | `src/i18n.test.ts` | blockierend |

## Leistung (Performance)

Gemessen in `src/addon.perf.ts` auf dem CI-Runner. Die Werte schwanken je nach Runner; entscheidend ist ihre
Entwicklung von Lauf zu Lauf. Als Referenz dient die Antwortzeit nach Nielsen: bis 1 s bleibt der Gedankenfluss
ungestört.

| Kennzahl | Ziel | Referenz | Art |
|---|---|---|---|
| Trade-Republic-CSV mit 10.000 Zeilen einlesen | ≤ 1 s | Nielsen 1 s | Bericht |
| Scalable-CSV mit 10.000 Zeilen einlesen | ≤ 1 s | Nielsen 1 s | Bericht |
| 500 PDF-Belege auswerten (Text schon gelesen) | ≤ 1 s | Nielsen 1 s | Bericht |
| Duplikat-Erkennung: 3000 neue gegen 3000 vorhandene (stündlich über ~4 Monate) | ≤ 1 s | Nielsen 1 s | Bericht |
| Größe von `dist/addon.js` | ≤ 3 MiB | eigenes Budget | Bericht |
| Größe von `dist/addon.js`, gzip | ≤ 1 MiB | eigenes Budget | Bericht |
