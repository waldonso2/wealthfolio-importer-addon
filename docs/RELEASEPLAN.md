# Release-Plan

Stand 2026-11-05. Quelle: offene Issues mit Label `backlog` und die Issues dieses Repos.

## Einordnung des Backlogs

| Issue | Gehört zu | Release im Addon? |
|---|---|---|
| #157 SDK 3.12 | Addon | **ja** – Release 1 |
| #156 README überarbeiten | Addon (Doku) | ja, als Patch danach (Release 2) |
| #152 CLI, #150 Lieferkette/minisign, #141 Anlageklasse, #52 comdirect-Dividenden | Companion-Dienst (`Wealthfolio-broker-sync-service`) | nein, andere Repo-Releases |

## Releases

1. **3.12.0 – Gebaut für Wealthfolio 3.12 (#157).** SDK-Familie auf `^3.12.0`, `sdkVersion`/`minWealthfolioVersion`/Version 3.12.0, Version in README und Architektur. Gate: `check:versions`, `type-check`, `lint`, `test`, `bundle`. Keine Logikänderung.
2. **3.12.1 – README (#156).** Aus dem Repo erledigbar: Datenschutz-Satz in die Einleitung (keine Netzwerkzugriffe, alles lokal), Abschnitt „Supported transactions“ kürzen, Begriffe gegen die deutschen UI-Texte abgleichen. Nicht aus dem Repo prüfbar (braucht Gerät/Installation): Exportpfade in TR-App und Scalable-Exporter, Lizenz des Userscripts, „Reinstalling keeps your settings“ – bleiben als Checkboxen im Issue offen. Reine Doku: nach Projektregel **kein** Versions-Bump nötig; Release nur, wenn der Owner es für die Community-Seite will.
3. **Danach:** neue Wealthfolio-Linie (`sdk-watch.yml` öffnet ein Issue) → Bump aller Versionen auf `<line>.0`; sonst Patch-Releases nur bei Logikänderungen.
