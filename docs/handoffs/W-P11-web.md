# Handoff W-P11 Web: Export und SQL-Dump (API 0.11)

Branch `feat/w-p11-web` (Worktree `.worktrees/w-p11-web`), Basis Web-`main` `48c2f67`. Status: zur Prüfung, nicht gemergt.
Kein Pin im Root-Lock; `package.json` und `package-lock.json` unverändert. Backend: Root-`main` `c331c64`.

## Ergebnis

- Vertrag: `src/lib/contract/v11/` (Kopie von `contracts/api-v0.11.0.json`, SHA-256
  `b3bcc38b44b020335151aead207e281f9c54bdc7463d6fb1ddd7a6cc22396620` laut Backend-Handoff, im Unit-Test geprüft),
  Typen und Validatoren per `contract:generate`.
- Export-Assistent `src/lib/features/export/ExportPanel.svelte`, eingehängt als Datenbankreiter `export`
  (`#/db/<name>/export`) und Tabellenreiter `export` (Tabelle vorausgewählt). Umfang: Tabellenauswahl, ganze Datenbank,
  Abfrageergebnis, ausdrücklich genannte Datenbanken (Server). Formate SQL, CSV, Excel-CSV, JSON; Optionen laut Vertrag
  (Struktur/Daten, DROP, IF NOT EXISTS, erweiterte INSERTs, Transaktionsrahmen, FK-Schalter, Trenner, CRLF, BOM, GZip,
  Dateiname, Zeilen-/Byte-/Zeitlimit, INSERT-Größe). Ungültige Kombinationen werden vor dem Senden deutsch erklärt
  (`options.ts`); Vorschau der Einstellungen mit Hinweisen zu Treuegrenzen, Formelschutz, Best-effort der Abfrage.
  Fähigkeiten und Treibergründe aus `GET /api/v11/capabilities`.
- Schlussmarke (`verify.ts`, Pflicht aus EXPORT-API.md): der dekodierte Strom wird in konstantem Speicher geprüft.
  SQL: letzte Zeile `-- DBMANAGER EXPORT COMPLETE`; JSON: ausgeglichene Klammern, kein offener String, letztes Mitglied
  `"complete":true`; CSV: Anführungszeichen-Zustandsmaschine, letzter Satz ist der Kontrollsatz `complete` (auch Excel-Profil).
  GZip wird mit `DecompressionStream` geprüft (abgeschnittener Container oder fehlende Marke im Inhalt = unvollständig).
  Fehlt die Marke, meldet die Oberfläche "unvollständig und fehlerhaft", die Senke wird verworfen, nie "fertig".
- Transport (`run.ts`): `fetch` POST mit Bearer-Header, Strom per `tee()` in Senke und Prüfer, Abbruch über AbortController,
  Fortschritt in Bytes, clientseitiger Wachhund (`timeout_ms` + 20 s), deutsche Texte für `export_busy` (503) und alle
  öffentlichen Codes. Dateiname aus Content-Disposition wird auf einen harmlosen Basisnamen reduziert.
- Senken (`sinks.ts`): File System Access API (Streaming auf Platte, Datei wird erst nach bestandener Prüfung geschlossen,
  sonst `abort()`), sonst Arbeitsspeicher mit hartem Limit 256 MiB und Download erst nach Prüfung. Die Oberfläche weist darauf hin.
- Token-/Verbindungswechsel und Zerstören: laufender Export wird abgebrochen, späte Antworten werden verworfen.
- Texte: `exportDump.*` am Ende von `de.ts` (nur angehängt).

## Dateien

Neu: `src/lib/contract/v11/**`, `src/lib/features/export/**` (Panel, `run.ts`, `verify.ts`, `sinks.ts`, `options.ts`,
`caps.ts`, `feature.ts`, Tests), `tests/browser/export.spec.ts`, `tests/real/export-wizard.spec.ts`,
`scripts/test-real-export.py`, dieses Handoff. Geändert: `src/lib/i18n/de.ts` (angehängt), `src/app.css` (eine Zeile:
`.workspace-tabs { flex-wrap: wrap }`, weil zusätzliche Reiter die Seite bei 320 px verbreiterten; betrifft alle Pakete).

## Prüfungen

Stand nach Abgleich mit Web-`main` `7a83f0e` (W-P07): contract:check aktuell, check 0/0, test 201, format:check ok, check-docs 0 Fehler, test:browser 36, test:csp 2, test-real-tables.py 10/10, test-real-export.py 3 von 3 Läufen grün. Befehle: `contract:check`, `check`, `test`, `format:check`, `test:browser` (Playwright-Port 4199
über eine unversionierte Konfigurationskopie), `test:csp`, `scripts/test-real-tables.py` (10 Fälle), 
`DBM_BACKEND_REPO=<Root> DBM_BACKEND_REV=c331c64 python3 scripts/test-real-export.py`.
Der echte Lauf (SQLite, PostgreSQL 18.6 verify-full, Produktions-Build) lädt über die Oberfläche SQL, SQL+GZip, JSON und
CSV herunter; prüft SQL-Marke, GZip gleich Klartext, JSON `complete`, CSV-Kontrollsatz; spielt den SQL-Dump mit
unabhängigen Clients (sqlite3-Modul, psql) in frische Datenbanken ein und vergleicht Zeilen (NULL, Leerstring, Unicode,
Zeilenumbruch, Backslash, Binär, große Zahlen, Dezimal, Text mit Markerzeile als Inhalt); ein Zeilenlimit, das den Strom
mit 200 abschneidet, wird als unvollständig gemeldet und nichts gespeichert.

## Einschränkungen und offen

- MySQL/MariaDB nicht im Weblauf (Backend-Suite deckt sie ab).
- SQL-Marke: ein Datentext, der selbst eine Zeile `-- DBMANAGER EXPORT COMPLETE` enthält und genau dort abgeschnitten wird,
  ließe sich theoretisch nicht unterscheiden (SQL wird nicht dialektweise geparst). Der Backend-Abschluss folgt immer nach
  COMMIT; der Fall ist im Lauf mit Markertext als Dateninhalt vollständig geprüft, nicht der Schnitt an dieser Stelle.
- Trailer (`X-Export-Status/-Error`) sind im Browser nicht lesbar; die Ursache eines Abbruchs wird deshalb als Liste möglicher
  Gründe genannt, nicht als einzelner Code.
- Ohne File System Access (Firefox, Safari) gilt die 256-MiB-Grenze im Arbeitsspeicher.
- Servertabellenliste für den Bereich "Server" ist ein Textfeld (keine Datenbankliste im Export-Vertrag).
