# Review W-P05: Tabelle anlegen

Unabhängiger Review von `feat/w-p05-create-table` (`485a020`, Basis `main` 6cb9613). Review-Branch `review/w-p05`,
eigener Worktree, `node_modules` als `cp -cR`-Kopie. Autorenbranch unverändert, nichts auf `main` gemergt.

## Urteil

**Freigabe mit Auflagen (F1, F4).** Vertrag, Validierung, Ein-Request-Garantie, Bestätigung, 409 und `outcome_unknown` sind korrekt
und durch echte Läufe belegt. Offen ist ein mittlerer Befund (F1), der in der Shell (nicht im Paket) liegt und vor
Integration entschieden werden sollte.

## Prüfungen (nacheinander, Review-Worktree)

| Befehl | Ergebnis |
| --- | --- |
| Vertragskopie | `src/lib/contract/v6/api-v0.6.0.json` SHA-256 `b08b6aba858f72a3bad1fce2933e487eed017f5e35b4690cfd9fae3a590a6887`, byteidentisch zu `contracts/api-v0.6.0.json` im Root (`5921a9d`); `provenance.json` passt |
| `npm run contract:check` | alle Stände aktuell (Typen und Validatoren reproduzierbar) |
| `npm run check` | 0 Fehler, 0 Warnungen |
| `npm test` | 19 Dateien, 112 Tests |
| `npm run format:check` | bestanden |
| `npm run test:browser` | 19 bestanden |
| `npm run test:csp` | Build + 2 bestanden |
| `scripts/test-real-create.py` (`DBM_BACKEND_REPO=<Root>`, `DBM_BACKEND_REV=main`) | Backend 5921a9d, SQLite und PostgreSQL (verify-full): 2 bestanden |
| `scripts/test-real-tables.py` | 10 Bestandsfälle bestanden, 2 fehlgeschlagen: `tests/real/table-create.spec.ts` (siehe F4) |

Ein fremder Container (später zwei `dbmanager-f5b-web-…`) `dbmanager-f5b-web-…-postgres` (gestartet vor meinem Lauf) lief parallel; nicht angefasst. Meine
Läufe haben ihre Ressourcen selbst entfernt.

## Befunde

### F1 (mittel) Schreibphase erreicht die Shell nicht: Datenbankreiter erhalten ein leeres `onwritephase`

Beleg: `Shell.svelte` übergibt für `database-tab` (und `server-tab`) `onwritephase: () => {}`; nur `table-tab` bekommt
`session.writeReceiver(...)`. Das Panel meldet `sending`/`unknown`/`settled`, diese gehen verloren. Folgen: (a) kein
`beforeunload`-Schutz während des Erstellens (`session.writeInFlight` bleibt `false`); (b) kein globaler Hinweis „Ausgang
unbekannt“ (`writeNotice`); (c) Reiter- und Objektknöpfe bleiben während des Sendens bedienbar; wechselt der Nutzer den
Reiter, wird das Panel zerstört, eine `outcome_unknown`-Antwort geht verloren (kein Zustand, keine Warnung), eine
Erfolgsantwort lädt nur noch den Katalog. Das Panel selbst ist korrekt (ein Request, kein Retry), die Lücke liegt in der
Shell-Verdrahtung, die dem Paket nicht gehörte.
Fix: Shell stellt für schreibende Datenbank-Features einen generischen Empfänger bereit (`session.writeReceiver` ohne
Objektbindung, Reiter während `writeInFlight` sperren); Test: Reiterwechsel während des Sendens, Seite verlassen.

### F2 (niedrig) Vorabprüfung liegt zum Server in sicherer Richtung, ist aber nicht deckungsgleich

Gegen `internal/database/create_plan.go` verglichen: Namen (63 Bytes, UTF-8, kein NUL), Spaltenzahl 32, Duplikate ohne
Groß-/Kleinschreibung, Typgrenzen (Text 1..1024, Decimal 1..38/Skala), Textbudget 4096, PK höchstens 8 / nur int64/text /
NOT NULL / Budget 2048, Defaults (kanonisches Integer-Format, Text Bytes ≤ 4096 und Zeichen ≤ Länge, Decimal ≤ 80 Zeichen
und Stellen) sind übernommen. Abweichungen, jeweils nur ein späteres `invalid_create` vom Server ohne Nebenwirkung:
- Der Client akzeptiert den Integer-Default `-0` (Go: `FormatInt(0) != "-0"`).
- Der Client kennt nicht: SQLite-Name `sqlite_*`, reservierte Schemas (MySQL `mysql/sys/information_schema/performance_schema`,
  PostgreSQL `pg_*`/`information_schema`).
- Groß-/Kleinschreibung per `toLowerCase` statt Go-`ToLower` (z. B. `İ`): Client kann ein Duplikat übersehen.
- Doppelte Einträge im Primärschlüssel sind über die UI nicht erzeugbar (Schlüssel-Liste), serverseitig ohnehin abgelehnt.
Fix (optional): `-0` ablehnen, reservierte Namen/Schemas spiegeln; sonst im Handoff als bewusste Lücke nennen.

### F4 (mittel, Integration) `test-real-tables.py` führt den neuen Echt-Spec mit aus und schlägt fehl

Beleg: `playwright.real.config.ts` hat `testDir: ./tests/real`; `scripts/test-real-tables.py` übergibt keine Dateiliste, startet also
auch `tests/real/table-create.spec.ts`, das eigene Fixtures (`scripts/test-real-create.py`) erwartet: 2 von 12 fehlgeschlagen
(zweimal gelaufen, reproduzierbar). Das Handoff nennt den Lauf „nicht ausgeführt“; nach dem Merge wäre der Bestands-Echtlauf rot.
Fix: `test-real-tables.py` mit expliziter Liste der vier Bestandsspecs aufrufen (oder `testIgnore` je Runner), vor Integration.

### F3 (niedrig) Handoff-Aussagen
- „Tab immer sichtbar“ ist dokumentiert; ohne v6-Backend erscheint die CapabilityNotice (browsergetestet).
- `test-real-tables.py` war im Handoff offen; jetzt durch den Reviewer belegt (10 bestanden).
- MySQL/MariaDB-Browser-Echtlauf fehlt weiter (im Handoff genannt); `different`/`unavailable`/`observed` nur gegen Mock.

## Prüfung nach Punkten

1. Vertrag: byteidentisch, reproduzierbar (s. o.).
2. Sicherheit: keine `{@html}`, kein Storage; Namen, `actual_description` und Standardwerte nur als Text (`JSON.stringify`
   für Namen in Zusammenfassung); Serverfehlertexte werden nie angezeigt (nur codebasierte deutsche Texte); Request und
   Antwort per Standalone-Validator geprüft (`CreateTableRequest`, `CreateTableResult`, `CreateCapabilities`); Anfrage nur
   mit Kopfzeile Bearer-Token wie bisher, kein Token in URL. Genau ein POST: Flag `sending` wird vor dem ersten `await`
   gesetzt, Knopf gesperrt, Bestätigungs-Checkbox nötig (Browsertests: keine Anfrage ohne Bestätigung, Doppelklick = 1,
   echter Lauf bestätigt). 409 lässt Formular stehen mit Hinweis „unverändert“; Timeout/Netzfehler/ungültige Antwort nach
   dem Absenden werden `outcome_unknown`, Formular gesperrt, kein Wiederholen. Antworten nach Token-/Verbindungswechsel
   werden per Generationszähler verworfen.
3. Korrektheit: `structure_check` (transactional/observed/different/unavailable) wird mit eigenen Texten angezeigt, plus
   tatsächlich gelesene Struktur.
4. Barrierefreiheit: Labels je Feld mit eindeutiger `$props.id()`-Basis, Spaltenaria-Labels mit Nummer, Fehler `role=alert`,
   Warnungen `role=status`; 320 px ohne horizontales Scrollen (Browsertest). Texte über `t()`, keine festen deutschen Literale
   im Panel gefunden; `de.ts` nur angehängt (`table-create`-Block), Probemerge siehe Bericht zu W-P06-web.
5. Doku: ehrlich und konsistent mit den Läufen (112 Tests, 19 Browserfälle stimmen).

## Nachreview (`feat/w-p05-create-table` bbe0f60, Fixes ae8393f; eingemergt)

**Urteil: Freigabe.** Befunde F1, F2 und F4 sind geschlossen, keine neuen Befunde mit Auswirkung.

- F1 geschlossen: `Session.databaseWriteReceiver(version)` (an die Sitzungsversion gebunden, ignoriert ältere Sitzungen) wird für
  Datenbankreiter übergeben; Reiter, Tabellenknopf und Objektknöpfe sind bei `writeInFlight` gesperrt. Das Panel meldet
  `settled`/`unknown` auch nach einem Unmount (Fortsetzung ohne Generationswechsel), der Zustand bleibt also nicht hängen.
  Unit-Tests (Phase, `unknown`-Hinweis, ältere Sitzung) und Browsertest ergänzt.
- F2 geschlossen: Vorabprüfung spiegelt `sqlite_*`, reservierte MySQL-/PostgreSQL-Schemas und lehnt `-0` ab (Tests).
  Bleibt Server-autoritativ; kleine Restabweichung bei Unicode-Kleinschreibung (sichere Richtung).
- F4 geschlossen: `SPECS` in `scripts/test-real-tables.py` mit den vier Bestandsspecs.
- Hinweis: Reiter sind während des Sendens gesperrt, die Seitenverlassen-Warnung greift über `writeInFlight`.
Läufe und Probemerge siehe Abschnitt „Probemerge aller drei Branches“ in `W-P06-web-review.md`.
