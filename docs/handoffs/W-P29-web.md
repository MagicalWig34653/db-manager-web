# Handoff W-P29 Web: Partitionen und Tabellenpräfix-Stapel (API 0.22)

Branch `feat/w-p28-29-web` (Worktree `.worktrees/w-p28-29-web`), Basis Web-`main` f830326. Status: zur Prüfung, nicht
gemergt. Backend-Bezug: Backend-`main` `d9463ba`. Gemeinsamer Branch mit W-P28.

## Vertrag

`src/lib/contract/v22/`: `api-v0.22.0.json` bytegleich zu `contracts/api-v0.22.0.json` aus `d9463ba` (SHA-256
`397db161…44afd1`), `provenance.json`, Typen und schlanke Validatoren (15 Wurzeln, 345 KB). Routen
`/api/v22/capabilities`, `tables/partitions/{list,plan,execute}`, `tables/prefix/{list,plan,execute}`.

## Ergebnis (`src/lib/features/partitions/`)

- Tabellenreiter "Partitionen" (`partitions.table`): Fähigkeiten aus `/api/v22/capabilities` je Treiber und Aktion;
  Partitionsliste (Methode, Ausdruck, Grenzen, Zeilenschätzung, "unbekannt" bei null). **SQLite**: klare Anzeige
  "nicht unterstützt" mit dem Grund des Backends, kein Formular und keine Listenanfrage. Aktionen define, add, drop,
  reorganize, coalesce, remove, analyze, check, optimize, rebuild, repair, truncate, attach, detach; nicht unterstützte
  Aktionen (zum Beispiel reorganize auf PostgreSQL) erscheinen mit dem Grund statt als Formular; "limited" zeigt den
  Hinweis neben dem Formular. Strukturierte Eingaben (Methode, genau eine Spalte, Anzahl, Definitionen je Methode:
  less_than / from-to / values / modulus-remainder, Partitionsauswahl aus der Liste, PostgreSQL qualifiziert).
- Datenbankreiter "Präfix-Stapel" (`partitions.prefix`): wörtliches Präfix, optionales Schema, Trefferliste, Aktionen
  drop, truncate, replace, remove, add, copy mit neuem Präfix.
- Plan -> Bestätigung -> genau ein Execute (`StructureOperation`, `StructureCard`): Vorschau mit exakten Anweisungen,
  Warnungen, betroffenen Objekten (`PlanPreview`); zerstörende Aktionen verlangen den getippten Namen aus dem Plan
  (`ConfirmDestructiveDialog`: Tabellenname bzw. gemeinsames Präfix), nur Analyse/Prüfung/Kopie eine Bestätigungsbox.
  Der Plan ist nach einem Execute verbraucht ("Neuer Plan" lädt neu). Doppelklick = ein Request; Phase kippt vor dem ersten
  await. `Session.writeCount` über `onwritephase` (sending/settled/unknown), Plan und Ausführung sind gesperrt, solange
  eine andere Schreibaktion läuft; Eingaben/Plan werden bei Verbindungs-/Token-/Tabellenwechsel verworfen.
- Ergebnis: completed / rejected (Grund auf Deutsch, "nichts dauerhaft geändert") / **outcome_unknown ohne Retry**
  (auch bei abgebrochener Verbindung nach Versand); beim Präfix-Stapel die Tabelle je Tabelle mit
  angewendet / nicht angewendet / **unbekannt** (MySQL/MariaDB-Teilzustand). Katalog und Partitionsliste werden danach
  neu gelesen. Hinweistext zum Teilzustand im Reiter.
- i18n: `partitions.*` in `de.ts` und `en.ts`; kein `{@html}`; feindliche Namen werden als Text dargestellt (Unit- und
  Browsertest); 320 px ohne horizontales Scrollen; Tastaturbedienung per Auswahlfeld/Schaltflächen.

## Prüfstand (gegen `d9463ba`)

`npm run check`, `npm test` (752, neu `partitions.test.ts` 20 Tests mit unveränderten Backend-Antworten aus
`fixtures/` gegen die v22-Validatoren), `format:check`, `contract:check`, `validators:check`, `build` (dist 3,76 MiB < 8 MiB),
`test:csp`, 80 Browser-Specs grün (neu `tests/browser/partitions.spec.ts`: SQLite nicht unterstützt, Drop mit getipptem
Präfix und Doppelklick = ein Request, Teilzustand unbekannt ohne Retry, 320 px/Tastatur).
Echtlauf `scripts/test-real-partitions.py`: PostgreSQL 18.6 verify-full mit echten deklarativen Partitionen (Liste,
anlegen, abtrennen, leeren mit getipptem Namen, löschen) und Präfix-Stapel auf SQLite und PostgreSQL (blockierter Drop
durch Fremdschlüssel von außerhalb: rejected / alle nicht angewendet, danach echter Drop; Gegenprobe über den Katalog).
Der Echtlauf nutzt `scripts/real_wave4.py` (zufällige Ports, Container wird entfernt, nie Port 4179).

## Offen

- MySQL/MariaDB-Partitionen und der MySQL-Teilzustand sind nur über aufgezeichnete Backend-Antworten (Unit) belegt, nicht
  im Echtlauf der Web-Skripte (Backend-Suite deckt sie ab).
- SQLite erzwingt Fremdschlüssel standardmäßig nicht; der "blockierte Drop" ist daher nur auf PostgreSQL real belegt.
- Definitionen: eine Spalte, skalare Werte; keine Ausdrücke, Unterpartitionen, Default-Partitionen.
- Unabhängiges Review steht aus.
