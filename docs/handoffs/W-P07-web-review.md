# Review W-P07 Web: Datenbank- und Tabellenoperationen (API 0.8)

Unabhängiger Review von `feat/w-p07-web` (`37a1bd3`, Basis `main` 48c2f67). Review-Branch `review/w-p07-web`, eigener Worktree,
`node_modules` als `cp -cR`-Kopie. Autorenbranch unverändert, nichts auf `main` gemergt.

## Urteil

**Freigabe mit Auflage (F1, mittel-niedrig).** Die destruktiven Pfade sind korrekt: der Zielname kommt aus dem Plan, die
Zweitbestätigung für die Verbindungsdatenbank ist zwingend, es geht genau ein Execute-Request raus, nach jedem Ausgang ist die
Aktion bis zu einem neuen Plan gesperrt. Alle Läufe grün, einschließlich eigener Browserprobe gegen MySQL 8.4 und MariaDB 12.3.

## Prüfungen (nacheinander, Review-Worktree)

| Befehl | Ergebnis |
| --- | --- |
| Vertragskopie v8 | `api-v0.8.0.json` SHA-256 `74aa39ed06311f2c45afc274a2412a0ac30912e3a5683ec96b812fd473a28264`, byteidentisch zum Root |
| `npm run contract:check` | Exit 0 (Typen und Validatoren aktuell) |
| `npm run check` | 0 Fehler, 0 Warnungen |
| `npm test` | 25 Dateien, 172 Tests |
| `npm run format:check` | bestanden |
| `npm run test:browser` | 32 bestanden |
| `npm run test:csp` | Build + 2 bestanden |
| `scripts/test-real-object-ops.py` (`DBM_BACKEND_REPO=<Root>`, `DBM_BACKEND_REV=main`) | 4 bestanden (SQLite, PostgreSQL 18.6 verify-full), Backend 3781869 |
| `scripts/test-real-tables.py` | 10 von 10 |
| `scripts/test-real-create.py` | 2 bestanden |
| `scripts/test-real-overview.py` | 2 bestanden |
| Eigene Probe MySQL 8.4 und MariaDB 12.3 (Wegwerf-Container über `scripts/dbfix.py`, Go-Backend aus Root `main`, Produktions-Build, nicht committet) | 2 bestanden, Container danach entfernt (`leftovers []`) |

Die Probe belegt je System in der echten Oberfläche: Tabellenoption Kommentar `hi 'x'; DROP` per Plan, Bestätigung, Doppelklick
= genau ein Execute-Request, unabhängiges Nachlesen über `information_schema` stimmt, danach kein Ausführen-Knopf mehr (gesperrt);
Löschen der Verbindungsdatenbank: „Ausführen“ ist ohne Zweitbestätigung deaktiviert, falscher Name im Dialog deaktiviert den
Bestätigungsknopf, Enter bei richtigem Namen bestätigt nicht (Dialog bleibt, Request-Zähler unverändert), Doppelklick auf den
Dialogknopf = genau ein Request, `completed`, Datenbank per `information_schema.schemata` weg.

## Befunde

### F1 (mittel-niedrig) Kein Schutz gegen Parallelität bei Neumontage oder mehreren Karten während eines Execute

Beleg (Code, nicht per Probe belegt): Die Reiter werden bei `writeInFlight` gesperrt, aber Hash-Navigation (Zurück-Knopf,
Seitenleistenlinks, Objektlinks) bleibt möglich. Der laufende Execute-Aufruf läuft weiter (Fortsetzung meldet `settled`/`unknown`
und lädt den Katalog), das Ergebnis der Karte geht aber mit dem Unmount verloren. Beim Zurückkehren ist die Karte leer
(`idle`); ein neuer Plan und eine neue Bestätigung sind dann möglich, während die erste Anfrage noch läuft. Dasselbe gilt für
mehrere Karten (`DatabaseOpsTab` hat drei, `TableOpsTab` sechs): jede hat eine eigene `Operation`, Ausführen ist bei laufender
Nachbaraktion nicht gesperrt, und `databaseWriteReceiver`/`writeReceiver` setzen `writeInFlight = (phase === 'sending')`: meldet
die zweite Karte `settled`, fällt der Seiten-verlassen-Schutz weg, obwohl die erste noch sendet. Replay mit demselben Plan-Hash ist
dadurch nicht möglich (jede Ausführung braucht einen neuen Plan und eine neue Bestätigung; der Server bindet an `plan_sha256`),
aber zwei gleichzeitige echte Schreibaktionen sind es.
Fix: „Ausführen“ (und „Plan anzeigen“) deaktivieren, solange `session.writeInFlight`; Phase der Schreibaktion zentral zählen
(Zähler statt Boolean); optional Hash-Navigation während `writeInFlight` ignorieren.

### F2 (niedrig) Server-Texte und Roh-Kennungen in der Anzeige

- Plan-Warnungen, Abhängigkeitshinweise (`deps.notes`) und Capability-Gründe (`unsupported`/`limited`) werden unverändert aus der
  Backendantwort angezeigt (feste deutsche Backendtexte, nur als Text gerendert, kein `{@html}`); sie laufen nicht über `t()`.
- `affected_objects` erscheinen mit rohem Präfix (`table:probe_maria.t1`); `observation.state` wird als Roh-Enum angezeigt.
Fix: Präfix und Zustand über Textkatalog abbilden; Server-Texte als bewusste Ausnahme dokumentieren.

### F3 (niedrig) Formularfelder werden bei Verbindungswechsel nicht geleert
Plan und Ergebnis werden zurückgesetzt, aber Eingaben (z. B. `dropName`, `createName`) bleiben. Kein Sicherheitsproblem, da
jede Ausführung einen neuen Plan und die Zielnamen-Eingabe verlangt; eine alte Datenbankbezeichnung kann aber vorausgefüllt wirken.

### F4 (info) Handoff-Angaben
Stimmen mit den Läufen überein (172 Tests, 32 Browserfälle, 4 + 10 Echtfälle). Der offene Punkt „kein MySQL/MariaDB-Browserlauf“ ist
durch diese Probe für Optionen und Zweitbestätigung nun belegt; `table_options` mit Kollation/Auto-Inkrement, Vererbungskinder und
Partitionen bleiben ohne Browser-Echtlauf.

## Prüfung nach Punkten

1. Vertrag: byteidentisch; Tests prüfen alle 80 Fixtures (gültig akzeptiert, `*.invalid` abgelehnt); `contract:check` grün.
2. Ablauf: Plan wird immer zuerst geladen; `Operation.execute` baut die Anfrage aus dem gespeicherten Plan-Request (`base`), dem
   Plan-Hash und dem **Zielnamen aus dem Plan** (`plan.confirmation.target_name`, nicht aus Formularzustand); Formulareingaben nach
   dem Plan ändern die Ausführung nicht. `ConfirmDestructiveDialog` verlangt den exakten Plan-Namen (Enter bestätigt nie).
   `phase` wechselt vor dem ersten `await` (Doppelklick/Enter sicher, Probe belegt). Nach `finished` (completed, rejected,
   outcome_unknown, `plan_mismatch` u. a.) bleibt die Karte gesperrt bis „Neuen Plan vorbereiten“. Token-, Verbindungs- und
   Objektwechsel setzen die Karte zurück (`reset`, Generationszähler); verspätete Antworten werden verworfen. Fehler nach dem
   Absenden ohne eindeutige Serverantwort werden `outcome_unknown` ohne Retry. Offen: F1.
3. Anzeige: Warnungen, betroffene Objekte, Abhängigkeitstabelle mit Gewissheit exakt/Textsuche, `dependencies_truncated`,
   Transaktionshinweis, rejected-Gründe deutsch über Codetabelle, Fehlertexte codebasiert deutsch; kein `{@html}`. Sichten
   erhalten nur einen Hinweis. F2.
4. Änderungen außerhalb: `Shell.svelte` sperrt die Tabellenreiter bei `writeInFlight` (korrekt, ergänzt die bestehende Sperre für
   Datenbankreiter); `app.css` `flex-wrap` auf `.workspace-tabs` ist rein additiv, 320-px-Browserfall besteht ohne horizontales
   Scrollen. Keine Regression in den 32 Browserfällen.
5. i18n/Barrierefreiheit: Texte über `t()` (Block `object-ops.*`, vom Schlüsseltest geprüft), Ausnahmen siehe F2; Karten mit
   `aria-label`, Formularfelder mit Labels, Fehler `role=alert`, Dialog über die geprüfte gemeinsame Komponente.
6. Echtläufe: siehe Tabelle.
7. Doku: ehrlich.

## Nachreview (`feat/w-p07-web` e00ec56, Basis main 48c2f67; eingemergt)

**Urteil: Freigabe.** F1, F2 und F3 sind geschlossen; keine neuen Befunde mit Auswirkung.

Läufe nacheinander auf dem Merge-Stand: `contract:check` Exit 0; `check` 0/0; `test` 25 Dateien, 175 Tests; `format:check` grün;
`test:browser` 32; `test:csp` 2; `test-real-object-ops.py` 4; `test-real-create.py` 2; `test-real-tables.py` 10; `test-real-overview.py` 2
(Root-`main`). `package.json` unverändert, keine neue Abhängigkeit.

- F1 (a) Zähler: `Session.writeCount` wird nur über `applyPhase` verändert (`sending` +1, Ende -1 nur wenn > 0, nie negativ), die Empfänger
  sind an die Sitzungsversion gebunden; `clearSession` und `separateWriteContext` setzen auf 0. Jeder abgesendete Execute meldet genau eine
  Endphase, auch bei veralteter Antwort (`end(...)` vor der Generationsprüfung in `Operation` und `CreateTablePanel`), und auch nach
  Unmount, da die Fortsetzung weiterläuft. Eigene Browserproben (temporär, nicht committet), alle grün: (1) `route.abort` mitten im Senden
  → `outcome_unknown`, danach Reiter bedienbar, Navigation und Zurück funktionieren, kein Seiten-verlassen-Schutz mehr; (2) „Sitzung
  leeren“ mitten im Senden, späte Antwort danach, neue Verbindung → Reiter und Navigation bedienbar, Zähler nicht hängend und nicht
  negativ; (3) Objektknopf während des Sendens gesperrt, nach der Antwort alles frei. Restfall (niedrig): `separateWriteContext` wird auch
  bei Objektwechsel/Neuverbinden in derselben Sitzungsversion aufgerufen und setzt den Zähler auf 0; eine spätere Endphase des noch
  laufenden Requests zählt dann einen später gestarteten Schreibvorgang herunter (zu früh freigegeben, nie hängend). Auslösen erfordert
  Neuverbinden während eines laufenden Schreibvorgangs; Folge nur eine zu frühe Freigabe.
- F1 (b) Navigation: `navigate()` und `onhashchange` brechen bei `writeInFlight` ab, setzen den Hash auf die aktuelle Route zurück und zeigen
  einen Hinweis (`navigation-blocked`, nur solange der Schreibvorgang läuft). Nach Ende (Antwort, Fehler, Timeout) ist alles wieder frei.
  Kein dauerhaftes Einsperren: Schreibanfragen haben ein Zeitlimit von 75 s (`AbortSignal.timeout`, danach `outcome_unknown` und Freigabe),
  zusätzlich bleibt „Backend-Zugang → Sitzung leeren“ als Notausgang bedienbar (Probe 2). Nebenwirkung (niedrig): der Rücksetzversuch
  schreibt einen zusätzlichen Verlaufseintrag; nach Freigabe funktioniert Zurück normal.
- F1 (c) Karten (`ActionCard`: Plan, Ausführen) und `CreateTablePanel` sind bei `writeInFlight` gesperrt; keine Regression
  (`test-real-create.py` 2, `test-real-tables.py` 10, Browserfälle W-P05 grün).
- F2: Präfixe betroffener Objekte (`affectedLabel`) und Beobachtungszustand (`observationText`) laufen über `t()`; Serverwarnungen
  bleiben als bewusste Ausnahme (Text, kein HTML).
- F3: Eingaben der Datenbankkarten werden bei Verbindungs-/Tokenwechsel geleert.
- Beobachtung (info): Beim „Sitzung leeren“ während des Sendens meldet Svelte im Entwicklungsmodus `derived_inert` (Lesen eines Derived in
  zerstörtem Effekt); folgenlos, im Produktionsbuild ohne Wirkung.
