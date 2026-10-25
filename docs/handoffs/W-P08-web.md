# Handoff W-P08 Web: Spalten ändern (API 0.9)

Branch `feat/w-p08-web` (Basis Web-`main` 48c2f67). Status: zur Prüfung, nicht gemergt, nicht gepinnt.
Kein Eintrag im Root-Lock. `package.json`/Shell/`app.css`/andere Feature-Verzeichnisse unverändert;
`src/lib/i18n/de.ts` enthält nur einen neuen Block `columns` (vor `'table-create'` eingefügt, um den
Konflikt mit parallel angehängten Blöcken zu vermeiden).

## Ergebnis

- `src/lib/contract/v9/`: Kopie von `contracts/api-v0.9.0.json` (SHA-256 `508b9951...e3f8`, Provenienz Root
  `4b66dfd`, geprüft gegen Root-main c331c64), Typen und Standalone-Validatoren per `contract:generate` und
  `validators:generate` (andere Stände byteidentisch, `contract:check` aktuell). Die 45 Vertragsfixtures liegen unter
  `src/lib/features/columns/fixtures/`; ein Test prüft, dass jede gültige akzeptiert und jede `*.invalid.json` abgelehnt wird.
- `src/lib/features/columns/`: `model.ts` (Entwurfsmodell, Vorabprüfungen, Request-Aufbau, Typerkennung aus dem
  Katalogtext), `client.ts` (Capabilities, Plan, genau ein Alter je Aufruf; Fehler nach dem Absenden ohne eindeutige
  Antwort werden `outcome_unknown`; Fehlertexte deutsch und codebasiert, Backendtexte nur für Fähigkeitsgründe,
  Warnungen und Abhängigkeiten, immer als Text), `operation.svelte.ts` (Plan, Bestätigung, ein Request, Sperre
  danach, verspätete Antworten verworfen), `DefinitionForm.svelte`, `ColumnsTab.svelte`, `feature.ts`
  (Tabellenreiter `spalten`, Slot `table-tab`, ohne Registry-Fähigkeit: das Panel erklärt fehlende Unterstützung).
- Ablauf: Spaltenliste aus `/api/v2/tables/describe` (Position, Name, Typ, NULL, Standard). Aktionen je Spalte:
  Ändern, Umbenennen, Verschieben (nur MySQL/MariaDB), Entfernen; dazu Spalte hinzufügen. Bis zu 16 Änderungen werden
  in einer Liste gesammelt, danach "Plan anzeigen": exakte Anweisungen (PlanPreview), Warnungen, betroffene Objekte,
  Abhängigkeiten, Transaktionshinweis, Plan-Hash. Nicht zerstörend: Bestätigungs-Checkbox, dann genau ein Execute.
  Zerstörend (`plan.destructive`, also Entfernen und jede Typ-/Attributersetzung): `ConfirmDestructiveDialog` mit dem
  `target_name` aus dem Plan (Katalog-Tabellenname). Nach jedem Ausgang ist die Aktion gesperrt; weiter nur über
  "Neue Änderung vorbereiten". Ergebnis zeigt Ausgang, deutschen Grund, Anzahl bestätigter Anweisungen, Beobachtung
  (`transactional`/`observed`/`unavailable`); bei `completed` oder unbekanntem Ausgang wird die Spaltenliste neu geladen.
- Schreibphase: `onwritephase` meldet `sending` beim Absenden, danach genau eine Endphase (`settled`/`unknown`), auch bei
  verworfener Antwort. Während eines Schreibvorgangs sind Plan und Ausführen gesperrt (`session.writeInFlight`).
  Die Blockade der Hash-Navigation während des Schreibens gehört zur W-P07-Shell (Shell.svelte, Zähler `writeCount`);
  sie ist auf Web-main 48c2f67 noch nicht enthalten und greift automatisch nach dem Merge von W-P07, ohne Änderung hier.
- Client-Vorabprüfung (ersetzt den Server nicht): neue Namen (leer, Steuerzeichen/U+0085, Rand-Leerzeichen, über 63 Byte;
  bestehende Namen werden nie neu geprüft), Länge 1 bis 1024, Dezimalparameter, ENUM/SET-Werte, typisierte Defaultkonstanten,
  NULL-Default nur bei NULL erlaubt, SQLite NOT NULL nur mit Default, MySQL/MariaDB Kommentar und VARCHAR-Kollation bei
  Ändern/Verschieben, doppelte Ziele, kollidierende Namen im Stapel, Bezugsspalte der Position.
- unsupported/limited: die Gründe des Backends werden je Aktion angezeigt; nicht unterstützte Aktionen sind deaktiviert
  (SQLite: Ändern und Verschieben). SQLite-Hinweis erklärt die Grenzen.
- Typauswahl kommt aus `types` der Capabilities je Treiber (ENUM/SET nur MySQL/MariaDB).

## Abweichungen vom Auftrag

- Auto-Inkrement ist im Vertrag 0.9 nicht enthalten (Sonderattribute werden abgewiesen), daher kein Feld; ein Hinweistext
  nennt das. Generierte Spalten sind nicht bearbeitbar (E5).
- Kommentar und Kollation bestehender Spalten liefert das Backend nicht (v2 `TableColumn` kennt sie nicht), daher zeigt die
  Liste sie nicht. Bei MySQL/MariaDB sind beide beim Ändern/Verschieben ausdrücklich einzugeben (Hinweis im Formular).
  Bei PostgreSQL ist der Kommentar nur nach "Kommentar ändern" Teil der Anfrage.
- Kollation ist Freitext (keine Auswahl aus der Serverinfo); der Server prüft gegen den Katalog.

## Prüfungen (Worktree `.worktrees/w-p08-web`, nacheinander, Last 80 bis 130)

| Befehl | Ausgang |
| --- | --- |
| `npm run contract:check` | alle Stände aktuell |
| `npm run check` | 0 Fehler, 0 Warnungen |
| `npm test` | 26 Dateien, 218 Tests (neu: Vertragsfixtures, model, operation, Komponenten) |
| `npm run format:check` | bestanden |
| `npm run test:browser` | 28 bestanden (3 neu in `tests/browser/columns.spec.ts`: Plan zuerst, Doppelklick = 1 Request, falscher Name, 320 px, Ausgang unbekannt) |
| `npm run test:csp` | Build und 2 Tests bestanden |
| `npm run test:pwa` | 6 bestanden |
| `DBM_BACKEND_REPO=<Root> DBM_BACKEND_REV=main python3 scripts/test-real-columns.py` | Backend main c331c64: SQLite und PostgreSQL 18.6 (TLS verify-full), 2 bestanden |
| `python3 scripts/test-real-tables.py` | 10 von 10 bestanden |
| `python3 scripts/check-docs.py` | 0 Fehler |

Echtlauf je Treiber: Spalte mit SQL-Text im Namen hinzufügen (Default mit Apostroph/Backslash als echte Konstante),
Umbenennen im selben Plan, unabhängiges Nachlesen über pragma_table_info bzw. information_schema, Daten und Nachbartabelle
unverändert, kein Request vor Bestätigung, Doppelklick = 1 Alter-Request, PostgreSQL: Typänderung als zerstörender Plan mit
falschem Namen (nichts gesendet) und richtigem Namen (Länge 60 nachgelesen), Entfernen mit getipptem Tabellennamen,
kollidierender Name vor dem Plan gestoppt, keine CSP-Verstöße, keine fremden Ursprünge.

## Offen

- Kein Browser-Echtlauf gegen MySQL/MariaDB (Backendseite durch die Backend-Livetests belegt); MySQL-spezifische
  Pfade (Verschieben, Kollationspflicht, ENUM/SET) nur Unit/Komponente/Mock.
- Positionsangaben und Mehrfachänderungen mit Positionsbezügen auf im selben Plan umbenannte Spalten verhindert nur der Server.
- Pin/Neubau/Lock-Eintrag `contracts` für 0.9 durch den Integrations-Agenten.
