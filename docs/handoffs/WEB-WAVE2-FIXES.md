# WEB-WAVE2-FIXES Behebung der Befunde aus WEB-WAVE2-REVIEW

Stand 27.10.2026. Branch `integration/web-wave2-fixes` (Basis `review/web-wave2` c48d476, enthält `integration/web-wave2` 757a203). Nicht nach main gemergt. Code-Commit: `3990f95`.

## Ergebnis je Befund

| Befund | Status | Umsetzung |
| --- | --- | --- |
| F-1 (mittel) Bulk-Dialog schließt während Execute | behoben | `BulkDialog.svelte`: `onOpenChange(false)` und `close()` tun in Phase `executing` nichts (Dialog bleibt offen, `open` wird zurückgesetzt). Das Schließen (Escape, Klick außerhalb, Schließen-Symbol, Button) ist erst nach dem Ergebnis möglich. `test.fail` entfernt, läuft als normaler Test. |
| F-1 Audit aller Schreiber | ein weiteres Vorkommen behoben | `RowWorkspace.svelte` (Zeileneditor) hatte dasselbe Muster: `close()` meldete bei laufendem Request `unknown` und gab die Sperre frei. Jetzt ist das Schließen gesperrt, solange `phase === 'sending'` oder ein Dateiwert-Transfer (`FileValuePanel`, neues Callback `onbusychange`) offen ist; "Verwerfen" ist dann deaktiviert. Import, Partitionen, Präfix, Konten, Programme, Indizes, Spalten, Objektops, Suche/Ersetzen, Wartung und SQL-Stapel sind keine Dialoge: ihr Schreibzustand hängt an der Operation, nicht an einem schließbaren Container. Die Bestätigungsdialoge (`ConfirmDestructiveDialog`) schließen sich beim Bestätigen selbst und lösen nie eine Sperre. Verwerfen-/Neuer-Plan-Schaltflächen sind in `executing` deaktiviert oder wirkungslos (`discardPlan` ignoriert `executing`/`planning`, `writeBusy`). Der Abbrechen-Knopf des SQL-Stapels und des Imports ist eine ausdrückliche Nutzerhandlung, die ehrlich `unknown` meldet (bestehendes Verhalten, bleibt). |
| F-2 (niedrig) SQL-Abschlussmarke in Zelle | behoben | Neu `src/lib/features/export/sql-lexer.ts`: Zustandsautomat mit konstantem Speicher über Chunkgrenzen. Erkennt `'...'` (Verdoppelung), `E'...'` (Backslash), `"..."`, `` `...` ``, `--`-Zeilenkommentare und `/* */` (verschachtelt). Die Marke zählt nur, wenn sie ein echter Zeilenkommentar außerhalb jedes Literals ist, eine eigene Zeile nach `;` beginnt und das letzte Element des Stroms ist. Die bisherige Endprüfung bleibt zusätzlich. `it.fails` entfernt; neue Tests: offene Literale/Bezeichner/Kommentare, harmlose Kommentar-ähnliche Texte, Chunkgrößen 1 bis 7 mit CRLF. Vertrag EXPORT-FORMAT.md ("Ein Vorkommen im Dateninhalt ist kein Abschluss", Text nach Dialekt zitiert: Quoteverdopplung, PostgreSQL E-Strings) wurde nicht geändert. Echtlauf SQLite und PostgreSQL (verify-full) bestanden. |
| F-3 (niedrig) Ports | behoben | `playwright.csp.config.ts` liest `DBM_E2E_PORT`, `DBM_TEST_PORT`, `DBM_PW_PORT`; `playwright.pwa.config.ts` liest `PWA_TEST_PORT` (Fallback `DBM_E2E_PORT`, Standard 4181) und gibt den Wert an `serve.mjs`; die PWA-Spec leitet den Scope aus der Seiten-URL ab. Belegt mit `PWA_TEST_PORT=4613` (6 grün) und `DBM_TEST_PORT=4614` (CSP, 2 grün). |
| F-4 (niedrig) hart codiertes Deutsch | behoben | Neue Katalogabschnitte `rowEditor`, `structureView`, `tableView`, `sourceInfo`, `coreText` (de und en, Platzhalter paritätsgeprüft). Umgestellt: `RowWorkspace` (alle Texte), `StructurePanel` samt `structure.ts`, `TableWorkbench` samt Filterfehlern in `tables.ts`, `SourceInformation`, `gateway.ts`, `export.ts`, `rows.ts` (Fehlertexte; `UNKNOWN_MESSAGE` wurde zur Funktion `unknownMessage()`), PWA-Hinweise (`notices.ts`: `offlineText()` usw., Texte werden beim Anzeigen gesetzt), Schließen-Texte der Dialogkomponenten. `session.svelte.ts` enthielt bereits keine festen Texte mehr. Die deutschen Texte sind unverändert, daher bleiben alle Specs gültig. Rest (bewusst): Fixtures `*/testing.ts` (Backend-Gründe als Testdaten), im Zustand gespeicherte Statuszeile `eligibilityMessage` des Zeileneditors wird beim Erzeugen übersetzt und folgt einem späteren Sprachwechsel erst beim nächsten Laden. |
| F-5 (info) Upload-Race | behoben | `ImportOperation.execute` merkt sich über `onProgress` (`loaded >= total`), dass alle Body-Bytes übergeben wurden. Ein Abbruch danach (auch vor `upload.onload`) gilt als `unknown` statt "nichts gestartet"; Test ergänzt. |
| F-6 (info) Abbruch wiederholbar | behoben | Schlägt der Abbruchaufruf fehl, wird `cancelRequested` zurückgesetzt, ein zweiter Versuch ist möglich; Test ergänzt. |
| F-7, F-8 | unverändert (info) | axe-Kontrast ist ein Animationsartefakt; F-8 bewusst festgehalten. |

## Prüfstand (Worktree `.worktrees/web-wave2-fixes`, Node 26.5.0)

| Befehl | Ergebnis |
| --- | --- |
| `npm run check` | 0 Fehler, 0 Warnungen (5235 Dateien) |
| `npm test` | 73 Dateien, 970 Tests bestanden (kein erwarteter Fehlschlag mehr) |
| `format:check`, `contract:check`, `validators:check` | bestanden |
| `npm run build` (nach Commit) | bestanden; Precache 49 Dateien, 4 530 403 Byte (4,32 MiB) ohne `sw.js`; Grenzen 8 MiB und `MAX_CHUNKS` 64 eingehalten |
| Playwright `tests/browser` (Port 4611) | 117 von 117 (vorher 115 + `test.fail` F-1 jetzt normal; 2 neue Specs: Zeileneditor und Bulk-Dialog ohne Schließen während des Writes, jeweils Escape, Schließen-Symbol, Klick außerhalb, `beforeunload`); ohne den Fix schlagen die Bulk-Specs fehl (belegt) |
| `test:csp` (Port 4612, außerdem `DBM_TEST_PORT=4614`) | 2 von 2 |
| `test:pwa` (`PWA_TEST_PORT=4613`) | 6 von 6 |
| Echtläufe `test-real-export.py` (SQL-Dump, SQLite + PostgreSQL verify-full) und `test-real-export-formats.py`, Backend `cf3d406` | je 2 von 2; Container, Prozesse, Checkout entfernt |

Port 4179 (fremder Prozess) wurde nicht angefasst, kein fremder Prozess beendet.

## Offen

- MySQL/MariaDB-Echtläufe für Import, Bulk, Export-Formate und Partitionen (Empfehlung 4 des Reviews) fehlen weiter.
- Der SQL-Lexer kennt keine PostgreSQL-Dollar-Quotes (das Backend gibt keine aus) und keine MySQL-Backslash-Escapes (Text geht dort über `CONVERT(X'..')`).
