# Handoff W-P28 Web: Erweiterte Exportformate und Dump-Details (API 0.21)

Branch `feat/w-p28-29-web` (Worktree `.worktrees/w-p28-29-web`), Basis Web-`main` `f830326` (f830326). Status: zur Prüfung,
nicht gemergt. Backend-Bezug: Backend-`main` `d9463ba` (Verträge v1..v23). Gemeinsamer Branch mit W-P29.

## Vertrag

- `src/lib/contract/v21/`: `api-v0.21.0.json` bytegleich zu `contracts/api-v0.21.0.json` aus `d9463ba` (SHA-256
  `68db81f9…18881c`), `provenance.json`, per Generator `api-types.ts` und schlanke `validators.js`
  (`scripts/validator-roots.json`: Connection, Error, ExportTableRef, ExtendedExportCapabilities, ExtendedExportRequest;
  169 KB statt rund 1 MB für die ganze Version). `npm run contract:check` und `validators:check` grün.
- Der Export spricht `GET /api/v21/capabilities` und `POST /api/v21/export`. Fehlt die Route (404 oder keine
  JSON-Antwort), fällt das Panel auf `/api/v11/...` mit den vier alten Formaten zurück; Textformate und Dump-Details
  werden dann nicht angeboten und die Anfrage mit einem Hinweis abgewiesen.

## Ergebnis

- Formate xml, yaml, php-array, latex, latex-longtable, mediawiki, texy, codegen (nur Daten) sowie excel-csv in der
  bestehenden Export-Oberfläche (`src/lib/features/export/`): eigene Gruppe "Weitere Textformate (nur Daten)", Formatliste
  nach Fähigkeiten der Instanz, Umfang tables/database/query/server (CSV nicht für Server). Hinweise je Format (XML
  Base64-Felder, PHP-Array nicht ungeprüft einbinden, LaTeX/Unicode, Entitäten) neben der Vorschau.
- Dump-Details (nur SQL): Sichten als Tabellen, Kommentare, Kompatibilität (nativ / nur Daten), Datenanweisung
  (INSERT / INSERT IGNORE / REPLACE, laut Fähigkeiten je Treiber, PostgreSQL nur INSERT), Aliase (Quell- auf vorhandene
  Zieltabelle, nur ohne Struktur). DEFINER wird nie gesendet (immer ausgelassen, Hinweis im Formular). Widersprüche
  (nur Daten mit Struktur/DROP, Alias mit Struktur, doppelte Ziele, unbekannte Tabellen) werden vor dem Senden gemeldet.
- Abschlussprüfung im Client (`verify.ts`, konstanter Speicher, Browser kann keine Trailer lesen): je Format die exakte
  Schlussstruktur laut `EXTENDED-EXPORT-API.md` am Ende des dekodierten Stroms (XML `</table>\n<complete>true</complete></export>\n`,
  YAML `],"complete":true}\n`, CodeGen `\n{"complete":true}\n`, PHP `),'complete'=>true);\n`, LaTeX `\end{tabular|longtable}`
  plus Markerzeile, MediaWiki `|}` plus Marker, Texy `|` plus Marker), zusätzlich Kopf (`<?xml `, Format-Kennung, `<?php`),
  bei YAML/CodeGen Klammer-/String-Balance. Gemessen an echten Ausgaben von `d9463ba`: Excel-CSV trennt standardmäßig mit
  Semikolon (die Prüfung folgt jetzt dem Trenner der Anfrage). Tests: jeder Byte-Schnitt jedes Formats, jedes Präfix,
  Marker in Zellen, Einzelbyte-Chunks.
- Download nur bei verifiziertem Ende (Sink bekommt `commit` erst danach), GZip wie bisher, Abbruch, kein Token in URLs.
  Doppelklick: Start bleibt deaktiviert statt durch "Abbrechen" ersetzt zu werden (vorher traf der zweite Klick
  des Doppelklicks die Abbrechen-Schaltfläche). `export_busy` (503, höchstens zwei Exporte) hat eine eigene Anzeige
  mit "Erneut versuchen" (nichts wurde geschrieben, der Neustart ist sicher).
- Texte `exportDump.*` in `de.ts` und `en.ts`; kein `{@html}`; Namen als Text.

## Prüfstand (gegen `d9463ba`)

`npm run check` 0 Fehler, `npm test` 752 grün (56 Dateien, davon neu `extended.test.ts` 33 Tests,
`ExportPanel.test.ts` erweitert), `format:check`, `contract:check`, `validators:check`, `build` (Precache-Summe dist 3,76 MiB,
Grenze 8 MiB), `test:csp` grün; alle 80 Browser-Specs grün (neu: Textformat nur mit Schluss, Doppelklick = ein Request,
320 px). Echtlauf `scripts/test-real-export-formats.py` (SQLite und PostgreSQL 18.6 verify-full): alle acht Textformate
und Excel-CSV über die UI heruntergeladen und unabhängig gelesen (ElementTree, PyYAML, `php` per `include`, json,
Entitäten-Rückwandlung, LaTeX-Marker und Escaping), abgeschnittener Strom wird abgelehnt und nicht gespeichert.

## Offen

- Kein Echtlauf für MySQL/MariaDB (Backend-Suite deckt sie ab); kein Test mit zwei echten gleichzeitigen Exporten
  (`export_busy` ist im Mock und per Komponententest belegt).
- ODS/ODT/Word/PDF, Exportvorlagen, Serververzeichnisse, Trigger/Routinen im Dump bleiben außerhalb (Backend offen).
- SQL-Optionen `dialect` und `max_statement_bytes` unverändert; `dialect` wird nicht gesendet (Vorgabe des Treibers).
- Unabhängiges Review steht aus.
