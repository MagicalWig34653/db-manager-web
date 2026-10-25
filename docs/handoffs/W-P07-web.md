# Handoff W-P07 Web: Datenbank- und Tabellenoperationen (API 0.8)

Branch `feat/w-p07-web` (Basis Web-`main` 48c2f67). Status: zur Prüfung, nicht gemergt, nicht gepinnt. `package.json`/Lock unverändert,
kein Pin im Root-Lock.

## Ergebnis

- Vertrag: `src/lib/contract/v8/` (Kopie von `contracts/api-v0.8.0.json`, SHA-256 `74aa39ed...8264` im Test geprüft, Provenienz Backend
  `bebe262`), Typen/Validatoren per `contract:generate`/`validators:generate`. Die 80 Vertragsfixtures liegen unter
  `src/lib/features/object-ops/fixtures/`; ein Test prüft, dass jede gültige akzeptiert und jede `*.invalid` abgelehnt wird.
- `src/lib/features/object-ops/`: `client.ts` (Capabilities, Plan, Abhängigkeiten, genau ein Execute je Aufruf; Fehler nach dem Absenden
  ohne eindeutige Serverantwort werden `outcome_unknown`; alle Antworten validiert; Fehlertexte deutsch und codebasiert),
  `operation.svelte.ts` (Zustandsmaschine Plan, Bestätigung, ein Request; Phase wird vor dem ersten await gesetzt; verspätete Antworten
  nach Reset/Token-/Verbindungswechsel verworfen), `ActionCard.svelte` (je Aktion: Fähigkeit, Formular, Plan mit exakten Statements,
  Warnungen, betroffenen Objekten inkl. Kindobjekten, Abhängigkeitstabelle mit exakt/Textsuche, Transaktionshinweis, Bestätigung,
  Ergebnis), `DatabaseOpsTab.svelte` (Datenbank anlegen/löschen/Kollation), `TableOpsTab.svelte` (umbenennen/verschieben, kopieren
  Struktur/Daten/beides, leeren, löschen, Optionen je `table_option_fields`, Abhängigkeitsprüfung), `feature.ts`
  (Datenbankreiter `datenbank-aktionen`, Tabellenreiter `operationen`).
- Ablauf: Plan wird immer zuerst geladen; destruktive Aktionen (laut `plan.confirmation.destructive`) öffnen `ConfirmDestructiveDialog`
  mit dem Zielnamen aus dem Plan; bei `confirmation.current_database` zusätzlich Checkbox, die `acknowledge_current_database` setzt;
  nicht destruktive Aktionen brauchen eine Bestätigungs-Checkbox. Genau ein Execute-Request (Doppelklick sicher). Nach jedem Ausgang
  (completed, rejected, outcome_unknown, Fehler wie `plan_mismatch`) ist die Aktion gesperrt; weitere Ausführung nur nach "Neuen Plan
  vorbereiten", neuem Plan und neuer Bestätigung (Replay-Konvention). Rejected-Gründe deutsch. `unsupported` zeigt den Grund des Backends,
  `limited` den Hinweis neben dem Formular. Sichten erhalten nur einen Hinweis.
- Schreibphase: `onwritephase` meldet sending/settled/unknown an `Session.databaseWriteReceiver` bzw. `writeReceiver` (Seiten-verlassen-Schutz,
  globaler Hinweis "Ausgang unbekannt"). Nach Abschluss lädt das Paket den Katalog neu.
- Texte: Block `object-ops.*` am Ende von `de.ts`.

## Änderungen außerhalb des Pakets (minimal)

- `src/lib/shell/Shell.svelte`: Tabellenreiter (Daten und Zusatzreiter) sind während `session.writeInFlight` gesperrt (4 Zeilen).
- `src/app.css`: `.workspace-tabs { flex-wrap: wrap; }`, damit die Reiterleiste mit den zusätzlichen Reitern bei 320 px nicht horizontal scrollt.

## Prüfungen (Worktree `.worktrees/w-p07-web`, nacheinander, Last 40 bis 130)

| Befehl | Ausgang |
| --- | --- |
| `npm run contract:check` | aktuell |
| `npm run check` | 0 Fehler, 0 Warnungen |
| `npm test` | 25 Dateien, 172 Tests (neu: 54 in `object-ops.test.ts`, `components.test.ts`) |
| `npm run format:check` | bestanden |
| `npm run test:browser` | 32 bestanden (7 neu in `tests/browser/object-ops.spec.ts`: Plan zuerst, falscher Name, Doppelklick, gesperrt nach Abschluss, Kopie/Umbenennen mit Sonderzeichen, rejected, Reiter-Sperre/beforeunload/globaler Hinweis, SQLite unsupported, MySQL Zweitbestätigung, 320 px) |
| `npm run test:csp` | Build und 2 Tests bestanden |
| `DBM_BACKEND_REPO=<Root> DBM_BACKEND_REV=main python3 scripts/test-real-object-ops.py` | Backend main 3781869: 4 bestanden (SQLite und PostgreSQL 18.6 verify-full) |
| `python3 scripts/test-real-tables.py` | 10 von 10 bestanden |

Echtlauf je Treiber: Sondernamen (Quote, Leerzeichen, SQL-Text), Löschen einer referenzierten Tabelle (Abhängigkeitswarnung, falscher
Name blockiert, Server lehnt mit `dependency_blocks` ab, Tabelle und Daten unverändert), Kopie Struktur+Daten (Zeilenzahl 3 unabhängig
nachgelesen), Umbenennen, Leeren, Löschen; Nachbartabelle unverändert; Doppelklick gleich ein Request; keine CSP-Verstöße. PostgreSQL:
Datenbank anlegen und löschen (unabhängig über pg_database geprüft), Verbindungsdatenbank wird abgewiesen. SQLite: Datenbankaktionen
als nicht unterstützt erklärt.

## Offen

- Kein Browser-Echtlauf für MySQL/MariaDB (Backendseite durch die Backend-Tests belegt); Zweitbestätigung nur gegen Mock getestet.
- Echtlauf deckt `table_options`, `database_collation` und Vererbungskinder/Partitionen nicht ab (nur Unit/Komponente bzw. Backendtests).
- `OBJ-004` Datenbank kopieren/umbenennen ist im Backend nicht umgesetzt, daher auch nicht in der Oberfläche.
- Kollation und Engine sind Freitextfelder (keine Auswahl aus der Serverinfo v7), der Server prüft gegen den Katalog.
- Pin/Neubau/Lock-Eintrag `contracts` für 0.8 durch den Integrations-Agenten.
