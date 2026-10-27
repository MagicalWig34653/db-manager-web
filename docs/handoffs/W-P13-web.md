# Handoff W-P13 Web: Mehrzeilenaktionen, Dateiwerte, Fremdschlüssel-Auswahl (API 0.19)

Branch `feat/w-p12-13-web`, Basis Web-`main` `f830326`. Status: zur Prüfung, nicht gemergt, kein Pin. Verträge, Messung des
Precache und Testübersicht stehen in [W-P12-web](W-P12-web.md).

## Ergebnis

- Feature `src/lib/features/bulk/` (kein eigener Reiter; die Funktionen hängen an der Tabellenansicht): Modell, Client
  (`/api/v19`), `BulkOperation` (Plan -> Bestätigung -> Ausführen), `BulkDialog`, `FileValuePanel`, `FkLookup`.
  `RowWorkspace.svelte`/`ResultTable.svelte` erhalten Auswahlspalte, Aktionsleiste und die Einbindung; ohne v19 oder bei
  ungeeigneter Tabelle bleibt der Einzelzeileneditor unverändert und ein Hinweis erklärt, warum die Mehrzeilenaktionen fehlen.
- Mehrfachauswahl (Kontrollkästchen je Zeile und "alle", höchstens `max_rows` = 100, Auswahl wird bei Neuladen/Seitenwechsel
  verworfen): Bearbeiten (markierte Spalten für alle Zeilen), Kopieren (neue Schlüsselwerte je Kopie, bei einzelnem
  Auto-Schlüssel ohne Eingabe), Löschen (Zeilenzahl tippen), Export der Auswahl (neuer Umfang `table_selection` im bestehenden
  Exportweg, nur die markierten Zeilen der geladenen Seite, kein Tabellenexport).
- Ablauf je Aktion: Vorschau (`rows/plan`, schreibt nichts) mit Schlüsseln, Warnungen und Prüfsumme; Ausführen verlangt Häkchen
  (beim Löschen zusätzlich die Zeilenzahl), sendet die erwarteten Zeilenabbilder, `stability_sha256` je Zeile und
  `expected_plan_sha256`, genau einmal (Doppelklick = ein Request). Der Plan ist danach verbraucht; die Schaltfläche bleibt
  deaktiviert. Der Plan wird gegen Anfrage geprüft (Tabelle, Aktion, Zeilenzahl, Schlüssel der eigenen Zeilen in Reihenfolge).
- Ergebnis je Zeile (`completed`, `rejected`, `outcome_unknown`) und, wo gemeldet, die Nachherzeile des Servers. `plan_conflict`
  und `row_conflict` heißen "Plan geändert oder bereits ausgeführt" bzw. "Zeile geändert"; Hinweis auf neu laden und neue
  Vorschau, nichts wird wiederholt. HTTP 4xx/5xx mit `RowsBulkResult` werden als typisches Ergebnis gelesen, nicht als Netzfehler.
  Unbekannter Ausgang (503 oder Verbindungsverlust nach dem Versand): Warnung "nicht erneut senden", Schreibsperre mit `unknown`.
- Dateiwerte (`FileValuePanel` im Zeileneditor, nur Binärspalten außerhalb des Schlüssels, schreibbar, nicht generiert): Upload
  als Multipart (zuerst `metadata`, dann `file`), lokale Grenze 512 KiB (laut Fähigkeit) vor jeder Anfrage, Bestätigung,
  Konflikterkennung über das geladene Zeilenabbild, Schreibsperre und genau ein Versand. Download über authentifiziertes
  `POST` (kein Token in URL), Inhalt nur bei exakter Länge laut `Content-Length` und höchstens 512 KiB, Typ nur
  `application/octet-stream`/`image/png`; Dateiname nur aus bereinigten Bezeichnern, nie aus Daten oder Server. Die
  PNG-Vorschau wird als Datei gespeichert, nicht in die Seite gerendert (kein Inline-Rendern).
- Fremdschlüssel-Auswahl (`FkLookup` im Zeileneditor): nur einfache, eindeutige Fremdschlüssel aus den Strukturdaten (v5); Suche
  gebunden (256 Byte), Anzeigespalte wählbar, Seiten mit `has_more`; Auswahl füllt den Wert des Feldes (kein Schreiben).
  Anzeigewerte erscheinen nur als Text.
- Texte `bulk.*` in `de.ts` und `en.ts`; Serverantworten zeigen nur feste Katalogtexte zu Codes.
- Eine Korrektur am Zeileneditor: Die Fähigkeiten von v19 werden erst nach der Eignungsprüfung des Editors geladen, weil SQLite
  gleichzeitige Anfragen auf derselben Datenbank mit `database_busy` beantwortet (im Echtlauf gefunden).
- `playwright.config.ts`/`playwright.csp.config.ts` lesen optional `DBM_PW_PORT` (Vorgabe wie bisher 4179/4180), damit der
  fremde Prozess auf 4179 nicht stört. `tests/csp/source.spec.ts` erwartet weiterhin 4180.

## Prüfungen

`npm test` 790 von 790 (Bulk: Modell, Client mit Mock-`fetch`, Operation, 19 Fixtures gegen die Validatoren), Browser-Specs
`tests/browser/bulk.spec.ts` 12 von 12 (Auswahl und Export der Auswahl, Löschen mit Zähler und Doppelklick, Bearbeiten,
Kopieren mit/ohne Auto-Schlüssel, `plan_conflict`, Navigationssperre, `outcome_unknown`, ohne v19, Dateiwert Upload/Download,
Fremdschlüsselsuche, 320 px); Echtlauf `scripts/test-real-import.py` (SQLite und PostgreSQL 18.6, TLS): Mehrzeilen-Update,
verändertes Zeilenabbild zwischen Vorschau und Ausführen (rejected, nichts geändert), Kopieren mit Auto-Schlüssel, Löschen,
Dateiwert hoch/runter byte-genau, Fremdschlüsselauswahl, jeweils mit unabhängigem Zurücklesen.

## Offen

- MySQL/MariaDB nur über Fixtures. TEXT-Dateiupload und ENUM/SET-Editorlisten sind laut Backend nicht Teil von 0.19.
- Auswahl gilt nur für die geladene Seite (kein "alle Treffer"); Auswahl über Filter ist im Vertrag ausgeschlossen.
- Der Fremdschlüssel-Lookup nutzt die Strukturabfrage v5 (zusätzliche Anfrage beim Öffnen einer Tabelle); ohne v5 bleibt nur das
  freie Eingabefeld. Zusammengesetzte oder mehrdeutige Ziele werden nicht angeboten.
- Kein unabhängiger Review, kein Pin (Lead).
