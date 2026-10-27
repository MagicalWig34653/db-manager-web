# Handoff W-P12 Web: SQL- und CSV-Import (API 0.18)

Branch `feat/w-p12-13-web` (Worktree `.worktrees/w-p12-13-web`), Basis Web-`main` `f830326`. Status: zur Prüfung, nicht gemergt,
kein Pin. `package.json` und `package-lock.json` unverändert. Zusammen mit [W-P13-web](W-P13-web.md) ein Branch, weil beide
Pakete Verträge, Validator-Wurzeln, Textkatalog und das Echtlauf-Skript teilen.

## Ergebnis

- Verträge: `src/lib/contract/v18/` und `v19/` sind bytegleiche Kopien von `contracts/api-v0.18.0.json` (SHA-256
  `17451221...b103e5`) und `api-v0.19.0.json` (`c7a52e69...0a2d46`) auf Backend-`main` `d9463ba` (zuletzt geändert in
  `cc24449`). v19 ist kumulativ. Typen und Validatoren per Generator; `scripts/validator-roots.json` führt nur die genutzten
  Schemas (v18: 7, v19: 11), `provenance.json` je Version. Der Generator normalisiert die `node_modules`-Pfadkommentare,
  damit ein per Symlink eingebundenes `node_modules` (Worktrees) dieselben Bytes erzeugt.
- Messung Precache (Summe der Shell-Liste in `dist/sw.js`): `main` 3,33 MiB, jetzt 3,67 MiB, Obergrenze des Backend-Builds 8 MiB.
- Feature `src/lib/features/import/` (Registry-Muster, kein manueller Eintrag): Reiter "Import" im Datenbankbereich (SQL-Datei) und
  im Tabellenbereich (CSV in genau diese Tabelle). Fähigkeiten aus `GET /api/v18/capabilities`; ohne Import zeigt das Panel
  `ErrorPanel`/`CapabilityNotice` statt den Reiter zu verstecken.
- Upload: Dateiauswahl oder Ablegen, lokale Grenzen vor dem Versand (leer, über 64 MiB laut Fähigkeit), Kompression nur ausdrücklich
  (`gzip` wird bei `.gz` vorgeschlagen, nie automatisch erkannt), Multipart über `XMLHttpRequest` (Uploadfortschritt),
  `credentials` aus, keine Weiterleitung. Abbruch vor dem vollständigen Senden startet nichts.
- CSV: Trennzeichen, Quote (genau ein Zeichen, kein CR/LF/NUL/Backslash), Maskierung, Zeichensatz (`utf-8`, `iso-8859-1`,
  `windows-1252`), BOM-Hinweis, Kopfzeile, NULL-Text, Modus `stop`/`skip`, Spaltenzuordnung (Vorschlag aus der Kopfzeile, nur
  beschreibbare, nicht generierte Spalten). Plan -> Vorschau (Zeilenzahlen, parametrisierte Anweisung über `PlanPreview`,
  erste gültige Zeilen, Meldungen mit Zeile/Spalte, gekürzt-Hinweis) -> Bestätigung per `ConfirmDestructiveDialog` (Tabellenname
  tippen) -> Ausführen. Im Modus `stop` mit Fehlerzeilen ist die Bestätigung gesperrt.
- SQL: Warnung "führt beliebiges SQL ohne Plan aus" mit Anweisungsklassen- und Sperrhinweis vor der Dateiauswahl; Bestätigung
  durch Eintippen des Dateinamens; Modus `stop`/`continue`, Anfangstrenner. Kein Plan, kein Hash (laut Vertrag).
- Ergebnis: Ausgang, Grund, Zähler (CSV), Servermeldungen (u. a. die Anweisungsklassen), Meldungsliste, je Anweisung Status
  (`completed`, `rolled_back`, `not_executed`, `outcome_unknown`), Dauer, Fehlercodes; lange Listen werden seitenweise gezeigt.
- Einmaliger Plan: Ab dem Versand der Ausführung gilt der Plan als verbraucht (Button weg, Hinweis, "Neue Vorschau erstellen"),
  auch nach Ablehnung (`plan_mismatch` heißt "geändert oder bereits ausgeführt") und bei unbekanntem Ausgang. Eine zweite
  Ausführung wird synchron blockiert (Doppelklick = ein Request, Test).
- `outcome_unknown` und jeder Fehler nach dem Versand, der keine bekannte Ablehnung ist, enden als "unbekannt, nicht erneut
  senden" ohne Retry. Statusabfrage bei 404/Authentifizierungsfehler/ungültiger Antwort oder fünf Fehlern in Folge ebenfalls.
- Schreib-/Navigationssperre: `onwritephase('sending')` ab Versand bis Ergebnis; während der Job läuft sind Navigation und
  `beforeunload` gesperrt. Das Schließen der Ansicht meldet `unknown`, damit die Sperre nicht hängen bleibt.
- Abbruch: vor dem vollständigen Senden bricht der Upload ab (nichts gestartet); laufender Job -> `POST .../cancel` genau einmal,
  Ergebnis kommt weiter aus der Statusabfrage; zwischen "Upload fertig" und 202 nur "nicht länger warten" (Ausgang unbekannt).
- Texte nur über `t()` in `de.ts` und `en.ts` (`importData.*`), Paritätstest grün. Kein `{@html}`, keine SQL-/Dateiinhalte in Logs,
  Dateinamen und Servertexte erscheinen nur als Text; Fehlertexte kommen aus festen Katalogeinträgen, nie aus der Serverantwort.

## Prüfungen (Stand Commit siehe Abschlussbericht)

`npm run check` 0 Fehler; `npm test` 790 von 790 (63 Dateien; Import: Modell, Client, Operation, Komponente, 18 Backend-Fixtures
gegen die Validatoren); `format:check`, `contract:check`, `validators:check`; `npm run build`;
Browser-Specs mit gemocktem Backend `tests/browser/import.spec.ts` 8 von 8 (u. a. 320 px, feindliche Texte als Text, Doppelklick = ein
Request, Ersatzlauf nach Ablehnung, Job verschwindet, Sperre, Abbruch genau einmal) und gesamte Browser-Suite 92 von 92;
Echtlauf `DBM_BACKEND_REPO=<Backend> DBM_BACKEND_REV=d9463ba python3 scripts/test-real-import.py` 6 von 6 (SQLite und PostgreSQL 18.6
mit TLS `verify-full`: CSV mit Vorschau, einmaliger Plan, scheiternder zweiter Lauf ohne Datenänderung, SQL-Import mit Fehler in
Anweisung 3 und unberührtem Rest, jeweils unabhängiges Zurücklesen über API 0.1).

## Offen

- MySQL/MariaDB nur über Fixtures, kein echter Lauf. Echte Verbindungsverluste während eines Uploads, 64-MiB-Dateien im Browser
  und Speicherverbrauch des Backends (laut Vertrag bis ca. 500 MiB, Containerlimit mindestens 1 GiB) nicht gemessen.
- Kein Resume und kein Retry nach Neustart des Backends (Vertrag): Der Job-Status ist an dieselbe Instanz gebunden.
- Zeichensatz-/Trennzeichenerkennung ist bewusst nicht vorhanden; die Kopfzeilenvorschau liest nur die ersten 64 KiB der
  unkomprimierten Datei.
- Kein Pin, kein Build über das Release-Skript des Backends (Lead).
