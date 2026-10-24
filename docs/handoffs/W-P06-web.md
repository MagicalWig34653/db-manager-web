# Handoff W-P06 Web: Übersicht, Definition, Serverinfo (API 0.7)

Branch `feat/w-p06-web` (Worktree `.worktrees/w-p06-web`), Basis `main` (`6cb9613`). Status: zur Prüfung, nicht gemergt,
nicht gepusht. Kein Pin im Root-Lock, `package.json` und `package-lock.json` unverändert.

## Ergebnis

- Vertrag: `src/lib/contract/v7/` (Kopie von `contracts/api-v0.7.0.json`, SHA-256
  `c6fd8c91315e25185d949d309397c7c0d80cc67fcab87ae521e38068e7004d17`, Provenienz aus Root-Commit `9f44a7c`, geprüft
  gegen die Datei im Root und im Test), Typen und Validatoren per vorhandenem Generator (`npm run contract:generate`).
  Die 32 Vertragsfixtures liegen unverändert unter `src/lib/features/overview/fixtures/`.
- `OverviewClient` (`src/lib/features/overview/client.ts`): Fähigkeiten, Datenbanken, Objekte, Definition, Serverinfo;
  jede Antwort wird gegen die v7-Validatoren geprüft, ungültige Antworten werden nicht angezeigt. Neue Fehlercodes
  (`invalid_overview`, `object_not_found`, fehlendes v7) bekommen deutsche Texte. Das Passwort steht nur im
  POST-Body der Verbindung, nie in URL oder Hash.
- `Resource` (`resource.svelte.ts`): ein Ladevorgang mit Abbruch und Verwerfen später Antworten; jede Komponente bricht
  beim Verbindungs-/Tokenwechsel und beim Zerstören ab.
- Komponenten:
  - `ServerInfoPanel.svelte`: Serverkontext (Treiber, Variante, Version, Laufzeit, Datenbank, Host, Benutzer, TLS,
    Sitzungszeichensatz), Datenbankliste mit Kennzeichnung geschätzt/exakt, Limit-Hinweis und "Weitere laden",
    Zeichensätze, Kollationen, Engines, Plugins (ausklappbar, `*_truncated` sichtbar). Eingehängt in den eingebauten
    Reiter `#/server` (`shell/builtin/ServerOverviewTab.svelte`, drei Zeilen geändert).
  - `ObjectsTab.svelte` (Datenbankreiter `uebersicht`, `#/db/<name>/uebersicht`): Tabelle/Sicht unterscheidbar, Zeilen
    (geschätzt mit Markierung und "≈", exakt, unbekannt), Engine, Kollation, Größe; Sortierung je Spalte, Textfilter,
    Artfilter; Aktion "Zeilen exakt zählen" (bis 100 Objekte, 8 s Budget; Teilergebnis wird als unvollständig
    gemeldet); Limit-Hinweis und "Weitere laden"; Link zur Tabelle und zur Definition.
  - `DefinitionTab.svelte` (Tabellenreiter `definition`): nur lesen, Kopieren-Knopf mit Rückmeldung, bei `derived`
    Hinweis mit `notice` und `warnings`.
  - Alle Funktionen werten die Treiberfähigkeit aus (`/api/v7/capabilities`): `unsupported` und `limited` zeigen den
    Grund des Backends statt die Funktion zu verstecken.
- Texte: `src/lib/i18n/de.ts`, Gruppen `overview.*` und `serverInfo.*` (Camel-Case statt `server-info`, weil der
  Schlüsseltest nur `\w`-Segmente prüft). Eingefügt am Anfang des Objekts, um Konflikte mit anderen Paketen am Ende zu meiden.
- `feature.ts` registriert zwei Features (`overview.objects`, `overview.definition`); Serverinfo hängt am eingebauten
  Serverreiter, weil dessen Reiterkennung `uebersicht` belegt ist und die Shell für Serverrouten keine Reiterleiste zeigt.

## Dateien

Neu: `src/lib/contract/v7/**`, `src/lib/features/overview/**` (Client, Resource, drei Komponenten, `feature.ts`,
Fixtures, `overview.test.ts`, `components.test.ts`), `tests/browser/overview.spec.ts`, `tests/real/overview.spec.ts`,
`scripts/test-real-overview.py`, dieses Handoff. Geändert: `src/lib/i18n/de.ts` (nur Einfügung),
`src/lib/shell/builtin/ServerOverviewTab.svelte`.

## Prüfungen (Worktree, nacheinander, `node_modules` per `cp -cR`; Host-Load 55 bis 105)

| Befehl | Ausgang |
| --- | --- |
| `npm run contract:check` | Typen und Validatoren aller Verträge aktuell |
| `npm run check` | 0 Fehler, 0 Warnungen |
| `npm test` | 18 Dateien, 90 Tests bestanden (neu: 19 in `overview.test.ts`, `components.test.ts`) |
| `npm run format:check` | bestanden |
| `npm run test:browser` | 17 bestanden (5 neu in `overview.spec.ts`, 12 unverändert); wegen belegtem Port 4179 durch einen parallelen Agenten mit einer unversionierten Kopie der Konfiguration auf Port 4189 |
| `npm run test:csp` | Build und 2 Tests bestanden |
| `DBM_BACKEND_REPO=<Root> DBM_BACKEND_REV=5921a9d python3 scripts/test-real-overview.py` | echtes Go-Backend (aus `git archive`, Vertragsbytes gleich der Kopie), SQLite und PostgreSQL 18.6 mit TLS verify-full, Produktions-Build: 2 bestanden (Serverinfo, Datenbankliste, Tabelle/Sicht, Schätzwert, exakt zählen, Definition von `odd"name`, kein Token/Passwort in URLs); danach Container und Temp-Dateien entfernt |

## Einschränkungen und offen

- MySQL und MariaDB nicht im echten Weblauf (nur durch die Backend-Suite `scripts/test-overview.py` und die
  Vertragsfixtures im Unit-/Komponententest abgedeckt).
- "Exakt zählen" bei der Datenbankliste gibt es nicht: der Vertrag bietet dafür keine Option (`estimated` ist ein
  Kennzeichen, kein Schalter). Die Aktion sitzt bei den Zeilenzahlen der Objektübersicht.
- Exakte Zählung deckt höchstens die ersten 100 Objekte ab (Vertragsgrenze); darüber weist die Oberfläche darauf hin.
- Datenbanken außer der verbundenen sind nicht verlinkt (die Shell löst Datenbankrouten nur für die Verbindung auf);
  Tooltip erklärt das. Die Startseite (`#/`) bleibt der SQL-Arbeitsbereich; der Serverkontext liegt unter `#/server`.
- Review-Hinweis L2 des Backends (MySQL `SYSTEM VIEW`): die Definition solcher Sichten kann mit allgemeinem Fehler
  scheitern; die Oberfläche zeigt dann die Fehlermeldung mit Wiederholen.
- Der echte Lauf holt das Backend nicht aus GitHub (anders als `test-real-tables.py`, das einen gepinnten Commit
  holt), weil `feat/w-p06-backend` und Folgestand erst im Root-Repo liegen; der Integrations-Agent stellt auf den
  Pin um, sobald der Vertrag gepinnt ist.
- Nicht ausgeführt: `scripts/test-real-tables.py` (holt den gepinnten Commit v5 aus GitHub; Code unverändert).

## Nachtrag: Review-Auflagen (Review `review/w-p06-web`, a616589)

- F1: `ServerInfoPanel` fragt Serverinfo und Datenbankliste nacheinander. `Resource.run` wiederholt lesende Anfragen bei
  `database_busy` einmal automatisch (600 ms Pause, abbrechbar); bleibt es busy, erscheint die Meldung mit "Erneut versuchen".
  Tests: keine Überlappung plus Wiederholung, dauerhaft busy. Echter Lauf `test-real-overview.py` (SQLite + PostgreSQL) 6 von 6 grün.
- F3: neuer Registry-Slot `server-section` (tab-los, `src/lib/features/index.ts`). `ServerOverviewTab.svelte` lädt die Registry lazy
  (kein Importzyklus) und zeigt alle Sektionen in `FeatureHost`; kein Import aus dem Featurepaket mehr. `Shell.svelte` unverändert.
  Doppelte Kopfzeilen Treiber/Datenbank im Panel entfernt. Registry-Test für tab-lose Sektionen.
- F4: Fehlertexte in `client.ts` über `t()` (`overview.err*`); Each-Schlüssel per Index (Datenbanken, Warnungen, Listen);
  "Weitere laden" in Datenbank- und Objektliste abbrechbar. Test mit doppelten Datenbanknamen.
- F5: Fixtures wieder byteidentisch zum Root, `.prettierignore` nimmt sie aus.
- F2: nicht hier; der W-P05-Autor stellt eine explizite Spec-Liste in `test-real-tables.py` her. `test-real-overview.py` bleibt.
- Prüfstand: contract:check, check (0/0), test (94), format:check, test:browser (17, Port 4189 wegen Fremdbelegung), test:csp (2) grün.
