# Review W-P08 Web: Spalten ändern (API 0.9)

Unabhängiger Review von `feat/w-p08-web` (`aa87547`, Basis alter Web-`main` 48c2f67). Review-Branch `review/w-p08-web`,
eigener Worktree, `node_modules` als `cp -cR`-Kopie. Läufe auf einem Wegwerf-Probemerge mit Web-`main` 7a83f0e (W-P07).
Autorenbranch unverändert, nichts auf `main` gemergt.

## Urteil

**Freigabe mit kleinen Auflagen (F1, F2).** Ablauf, Bestätigung, Einmal-Request, Schreibphasen und Vorabprüfung sind korrekt und
durch Echtläufe einschließlich eigener MySQL-8.4-/MariaDB-12.3-Probe belegt. Probemerge ohne Konflikte.

## Prüfungen (nacheinander, Probemerge-Stand)

| Befehl | Ergebnis |
| --- | --- |
| Vertragskopie v9 | `api-v0.9.0.json` SHA-256 `508b9951d102ec44bf4cafc9fe444f7266b31f898d9e91c887f4bef39735e3f8`, byteidentisch zum Root (`c331c64`) |
| Probemerge (`git merge-tree` und echter Merge in Wegwerf-Worktree) | konfliktfrei (`de.ts`, Registry, Shell) |
| `npm run contract:check` | Exit 0 |
| `npm run check` | 0 Fehler, 0 Warnungen |
| `npm test` | 28 Dateien, 248 Tests |
| `npm run format:check` | bestanden |
| `npm run test:browser` | 35 bestanden |
| `npm run test:csp` | Build + 2 bestanden |
| `npm run test:pwa` | 6 bestanden |
| `test-real-columns.py` (`DBM_BACKEND_REPO=<Root>`, `DBM_BACKEND_REV=main`) | 2 bestanden (SQLite, PostgreSQL) |
| `test-real-tables.py` | 10 von 10 |
| `test-real-object-ops.py` / `test-real-create.py` / `test-real-overview.py` | 4 / 2 / 2 bestanden |
| Eigene Probe MySQL 8.4 und MariaDB 12.3 (Wegwerf-Container über `scripts/dbfix.py`, Go-Backend aus Root-`main`, Produktions-Build, nicht committet) | 2 bestanden, Container entfernt (`leftovers []`) |

Die Probe belegt je System: ENUM mit Apostroph (`'y''z'`) und SET hinzufügen (Plan ohne Zerstörung, Checkbox, Doppelklick =
genau ein Request, `information_schema` zeigt `enum('x','y''z')` und `set('p','q')`); Verschieben einer VARCHAR-Spalte nach vorn:
ohne Kollation ist „Zur Änderungsliste hinzufügen“ gesperrt (Kollationspflicht), mit Kollation zerstörender Plan, falscher Name
sperrt, Enter bestätigt nie, Doppelklick = ein Request, Spalte danach an erster Stelle; Entfernen einer von einer Sicht genutzten
Spalte: Plan warnt „Die Sicht … verwendet die Spalte a … wird danach ungültig“ und nennt die Sicht unter betroffenen Objekten und
Abhängigkeiten, Ausführung nur mit getipptem Tabellennamen, Spalte danach weg.

## Befunde

### F1 (niedrig-mittel) Vorbelegung der Spaltendefinition behauptet Typen, die sie nicht sind

Beleg: `parseDatabaseType` in `model.ts` erkennt `timestamp*` per Präfix und `bigint` ohne den Zusatz `unsigned`. Ausgeführt:
`timestamp with time zone` ergibt Typ `timestamp` (zeitzonenlos), `bigint unsigned` ergibt `int64` (BIGINT mit Vorzeichen). Wer beim
Ändern nur Name oder Standardwert anpasst, schickt eine Typkonvertierung, die er nicht bewusst gewählt hat. Der Plan zeigt die exakte
`ALTER`-Anweisung und ist immer zerstörend (getippter Tabellenname), die Schutzschicht greift also; die Vorbelegung ist trotzdem
irreführend. Fix: nur exakte Treffer vorbelegen (`timestamp`/`timestamp without time zone`, `bigint` ohne `unsigned`), sonst Typ
leer lassen, wie bei `int`, `tinyint`, `datetime`.

### F2 (niedrig) MySQL/MariaDB: „Ändern/Verschieben“ ersetzt Kommentar und Zeichensatz/Kollation unbemerkt

Beleg: Das Backend verlangt dafür eine vollständige Ersatzdefinition (`COMMENT`, bei Text `CHARACTER SET … COLLATE …`); die
Oberfläche kennt bestehende Kommentare/Kollationen nicht (`TableColumn` liefert sie nicht). Die Probe zeigt im Plan
`… VARCHAR(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT '' FIRST`; ein bestehender Kommentar ginge verloren.
Das Formular weist darauf hin und der Plan ist zerstörend bestätigt, aber ein reines „Verschieben“ ersetzt Attribute. Fix: den
bestehenden Kommentar/die Kollation über `information_schema` (Backend) mitliefern oder im Plan hervorheben, dass das Verschieben
Attribute ersetzt.

### F3 (niedrig) Spalten mit Zusatzattributen erst nach dem Plan abgewiesen
Das Backend lehnt Ändern/Verschieben auf MySQL-Spalten mit `EXTRA` (z. B. `auto_increment`) und auf Nicht-InnoDB-Tabellen mit
`unsupported_action` ab; die Oberfläche kann das vorher nicht erkennen (kein `EXTRA` in der Beschreibung). Folge: deutscher
Fehlertext nach dem Planversuch, nichts gesendet. Kein Sicherheitsproblem.

### F4 (info) Bedienung nach abgelehnter Ausführung
Nach `rejected` bleibt die Aktion gesperrt (gewollt); „Neue Änderung vorbereiten“ leert die Änderungsliste, der Nutzer baut den Stapel
neu auf. Komfortlücke, kein Fehler.

## Prüfung nach Punkten

1. Vertrag: byteidentisch; 45 Fixtures per Test (gültig akzeptiert, `*.invalid.json` abgelehnt); `contract:check` grün.
2. Ablauf: `Operation.loadPlan` speichert die Anfrage (`base`); `execute` sendet `base` mit `expected_plan_sha256` des Plans und
   `confirm.target_name = plan.target_name` (aus dem Plan, nicht aus Eingabe); Änderungsliste und Aktionen sind ab `planned`
   gesperrt (`locked`), eine veraltete Auswahl kann also nicht gegen einen alten Plan laufen; „Bearbeiten“ verwirft den Plan. `phase`
   wechselt vor dem ersten `await`; Doppelklick/Enter belegt (Probe, Browserfälle). Nach `finished` gesperrt bis neuer Plan.
   Token-/Verbindungs-/Tabellenwechsel setzen zurück (`reset`, Generationszähler). Schreibphasen: genau ein `sending` und genau
   eine Endphase pro abgesendetem Request (`end(...)` vor der Generationsprüfung, auch bei verspäteter oder fehlgeschlagener
   Antwort); damit hängt der `writeCount`-Zähler aus W-P07 nicht. Auf dem Probemerge gilt die W-P07-Navigationssperre; Panel und
   Aktionen sind bei `writeInFlight` gesperrt.
3. Vorabprüfung: Namen, Länge 1..1024, Dezimal, ENUM/SET, Defaults, NULL-Default nur bei NULL, SQLite NOT NULL nur mit Default,
   MySQL-Kommentar-/Kollationspflicht, doppelte/kollidierende Ziele, Bezugsspalte; jeweils strenger oder gleich dem Backend
   (`columns_plan.go`), der Server bleibt maßgeblich. Typauswahl aus `types` der Capabilities je Treiber. Kein `{@html}`; Warnungen,
   Abhängigkeiten und Fähigkeitsgründe vom Backend erscheinen nur als Text; Fehler codebasiert deutsch; Texte über `t()`
   (Block `columns.*`). Offene Ausnahme: Backendtexte (bewusst, wie bei W-P07).
4. Treiber: SQLite zeigt Ändern/Verschieben als nicht unterstützt (deaktiviert, Grund sichtbar), Verschieben nur MySQL/MariaDB,
   Auto-Inkrement-Hinweis vorhanden (im Vertrag 0.9 nicht enthalten).
5. Echtläufe: siehe Tabelle.
6. Doku: ehrlich. Der Handoff nennt den fehlenden MySQL/MariaDB-Browserlauf; er ist durch diese Probe nun belegt.

## Nachreview (`feat/w-p08-web` 9dd0704, Web-main 7a83f0e eingemergt)

**Urteil: Freigabe.** F1 bis F4 geschlossen, keine neuen Befunde mit Auswirkung. Läufe nacheinander: `contract:check` 0; `check` 0/0;
`test` 254; `format:check` grün; `test:browser` 35; `test:csp` 2; `test:pwa` 6; `test-real-columns.py` 2; `test-real-tables.py` 10.
Probemerge mit aktuellem Web-main: keine Konflikte (Merge in den Review-Branch ohne Konflikt).

- F1: `parseDatabaseType` belegt nur exakte Treffer vor. Ausgeführt (Auszug): `decimal(10,2)`, `varchar(255)`, `enum('a')`, `set(..)`, `bigint`,
  `bigint(20)`, `int8`, `timestamp`, `timestamp without time zone`, `date`, `boolean`, `bytea`, `blob` werden erkannt; leer bleiben
  `varchar(255) character set latin1`, `tinyint(1)`, `bigint unsigned`, `bigint(20) unsigned`, `timestamp(6)`, `timestamp with time zone`,
  `numeric[]`, `jsonb`, `serial`, `bigserial`, `decimal(10,2) unsigned`, `character varying` ohne Länge, `varchar(10)[]`, SQLite `TEXT`/`INTEGER`.
  Ohne Typ ist „Zur Änderungsliste hinzufügen“ gesperrt; ein Hinweis nennt den bisherigen Typ. Browserprobe MySQL 8.4/MariaDB 12.3: `id BIGINT UNSIGNED`
  → Typ leer, Hinweis „bisheriger Typ bigint unsigned … nicht eindeutig erkannt“, Hinzufügen gesperrt. Folge: es kann keine geratene Konvertierung
  rausgehen; Preis: bei nicht erkannten Typen (z. B. `tinyint(1)`) ist reines Umbenennen über „Ändern“ nicht möglich, dafür gibt es „Umbenennen“
  (eigene Aktion ohne Typ). Der alte Typ wird nie automatisch als Ersatz gesendet, sondern muss bewusst gewählt werden (zulässig, niedrig).
- F2: Bei MySQL/MariaDB Ändern/Verschieben erscheint ein roter Hinweis mit Pflicht-Checkbox (`replaceAck`); ohne Haken bleibt Hinzufügen gesperrt;
  im Plan zusätzlich Hinweis `plan-replaces`. Probe auf beiden Systemen bestanden. Ausreichend.
- F3: Sperre nur bei `driver === 'mysql'` und `storage_engine` ungleich InnoDB; PostgreSQL/SQLite unberührt (Echtläufe grün).
- F4: Nach `rejected`/Fehler bleibt die Liste, der Plan wird verworfen („Zurück zur Liste“); nach `completed`/unbekanntem Ausgang wird sie geleert.
  Ein alter Plan/Hash ist nicht erneut ausführbar: `execute` braucht `phase === 'planned'`, nach `finished` ist die Operation gesperrt,
  jeder weitere Versuch braucht einen neuen Plan (neuer `plan_sha256`).
