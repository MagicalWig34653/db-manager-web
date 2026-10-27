# W-P16 CodeMirror: unabhängiges Re-Review

Stand: 27.10.2026. Geprüft: `feat/w-p16-codemirror` a3b3aee (Basis 4b24e53), Backend `daceabb`, Vorreview `W-P16-codemirror-review.md` (B-1..B-3, M-1..M-6).
Reviewer hat keinen Produktcode geändert. Ergänzt wurden nur Test-/Prüfdateien (siehe unten); Befunde sind dort als `it.fails`/`test.fail` festgehalten
(Aussage = korrektes Verhalten; wird rot, sobald behoben, dann auf `it`/`test` umstellen).

## Freigabe

**Bedingt freigegeben: kein Blocker.** B-1, B-2, B-3 und M-1 bis M-6 sind wirksam behoben; der Formatierer hat in ca. 24.000 Anweisungen je Dialekt keinen
Fall mehr, in dem Nicht-Leerraum-Zeichen, Literal- oder Kommentarbytes geändert werden (eigener Scanner, eigener Mini-Lexer, ohne `lexer.ts`).
Die Kernzusage „ändert nur Leerraum" gilt textlich. Sie gilt **nicht** in dem Sinn „gleiche Semantik", weil Leerraum in einigen Dialekten
Bedeutung trägt (H-1, M-1, M-2, M-3, N-1). Vor Merge empfohlen: H-1 (PostgreSQL-Zeichenkettenfortsetzung, reale Regression ok->Fehler) und M-1
(Verlaufseintrag/bestätigte Anweisung stimmen nach Bearbeiten nicht überein) beheben oder bewusst als bekannte Einschränkung dokumentieren; die
übrigen Befunde sind niedrig. Die Verifikationsfunktion ist prinzipbedingt blind für Fehler des gemeinsamen Lexers (siehe „Verifikation").

## Befunde nach Schwere

### Hoch (kein Blocker, vor Merge beheben oder dokumentieren)

**H-1 PostgreSQL: Zeilenumbruch zwischen benachbarten Zeichenkettenliteralen wird zu Leerzeichen, Anweisung wird ungültig.**
Echtlauf PostgreSQL 18.6: `SELECT 'x'<LF>'y'` ergibt `'xy'`; formatiert `SELECT 'x' 'y'` ergibt Syntaxfehler 42601. Ebenso `B'1'<LF>'0'`, `X'41'<LF>'42'`,
`'x' /* c */<LF>'y'` (CRLF ebenso). Zeilenkommentar dazwischen bleibt heil. Verifikation und Lexer sehen nur Leerraumänderung. Betrifft Formatierer
(`spaceBetween`) bei Literal gefolgt von Literal. Test `rereview-attack.test.ts` (`it.fails`). Korrektur: zwischen zwei Literalen im Quelltext
vorhandenen Zeilenumbruch erhalten (oder in PostgreSQL verweigern).

### Mittel

**M-1 Bestätigungs-Race Bidi-Warnung: bestätigte Anweisung und Verlaufseintrag können auseinanderfallen.** Die Warnung zeigt die Anweisung nicht an, der Editor
bleibt während der Warnung editierbar. Ändert man den Text und klickt dann „Trotzdem ausführen", läuft die alte (gewarnte) Anweisung `hiddenPending`, im Verlauf
steht aber der neue Editortext (`recordQuery(connection, this.sql, …)`). Das ist keine Umgehung der Warnung (es wird genau das gewarnte SQL ausgeführt),
aber Audit-/Verlaufsfehler und Verwechslung („ich habe doch den Text geändert"). Test `sql-codemirror-rereview.spec.ts` (`test.fail`, „confirmed statement…").
Empfehlung: Warnung beim Bearbeiten zurücknehmen oder die Anweisung in der Warnung anzeigen und genau diese aufzeichnen.

**M-2 Unsichtbare Zeichen außerhalb der Liste werden weder markiert noch gewarnt.** `HIDDEN_CHARACTERS`/`highlightSpecialChars` kennen nicht
U+3164 (Hangul-Füllzeichen), U+FE0F/Variationsselektoren, U+E0041 (Tag-Zeichen), U+2800 (Braille leer), außerdem U+115F/1160, U+17B4/17B5, U+180E, U+FFA0.
In PostgreSQL/MySQL sind sie Bezeichnerzeichen, ein Bezeichner `a<U+3164>b` ist unsichtbar anders als `ab`. Tests: 4x `test.fail`
(`sql-codemirror-rereview.spec.ts`). U+00AD, U+2028/2029 und U+FFF9-FFFC markiert CodeMirror (Standardliste), lösen aber keine Warnung aus.
Verwechslungsgleiche Zeichen (kyrillisches a) sind prinzipbedingt nicht erkennbar.

**M-3 MySQL `NO_BACKSLASH_ESCAPES`: Formatierer kann Literalinhalt still verändern (Vorreview N-1 war „harmlos" eingestuft, das stimmt nicht allgemein).**
Der Lexer nimmt für MySQL immer Backslash-Escapes an. Bei Anweisungen mit mehreren `\'` paart er Hochkommas falsch und die Verifikation (gleicher Lexer)
besteht trotzdem: `select '\','\ '<LF>x\''` wird zu `select '\',' \ '<LF>x\''` (Literal `'\ '` wird zu `' \ '`). Fuzz (200.000 Anweisungen, nur Backslash/Hochkomma/Leerraum):
17 von 96.502 formatierten Fällen ändern Literalbytes. Natürliche Fälle (`'C:\', 'x  y', 'D:\'`) werden dagegen verweigert (null). Test `rereview-modes.test.ts` (`it.fails`).
Empfehlung: in MySQL verweigern, sobald ein Literal mit `\'` endet oder mehr als ein `\'` vorkommt, oder serverseitigen Modus erfragen.

### Niedrig

- **L-1 SQLite `?NNN` wird zerlegt** (`?1` wird `? 1`, Syntaxfehler 1; Original lief). Verifikation sieht gleiche Tokenfolge (`?`, `1`). `rereview-attack.test.ts` (`it.fails`).
- **L-2 SQLite `@name(...)`/`$name(...)`** ist ein einziges Variablentoken mit TCL-Suffix; `@v(1=1)` wird `@v(1 = 1)` und ist dann ein illegales Token. (`it.fails`).
- **L-3 U+000B (vertikaler Tabulator) gilt dem Lexer als Leerraum**, SQLite lehnt ihn ab (Fehler 1); formatiert läuft die Anweisung. Nur Fehler->ok. (`it.fails`).
- **L-4 MySQL/MariaDB ohne `IGNORE_SPACE`:** `count (*)`, `max (x)`, `NOW ()`, `CAST (…)` sind Fehler (1064/1630); der Formatierer entfernt das Leerzeichen und die
  Anweisung läuft (Fehler->ok, ca. 130 von 20.380 Paaren je Server). Kein Datenverlust, aber „ändert nur Leerraum" ist hier semantisch nicht neutral.
- **L-5 Lexer behandelt in MySQL `--x` (ohne folgendes Leerzeichen) als Zeilenkommentar**; MySQL/MariaDB verlangen Leerraum nach `--`. Wirkung nur: Rest der Zeile bleibt unformatiert,
  Bytes bleiben (kein Fehlerfall im Echtlauf).
- **L-6 Dokumentationsreste Rohtext-Modus:** `docs/decisions/ADR-W-P16-codemirror-editor.md` Zeilen 29-30 und `docs/handoffs/W-P16-codemirror-web.md` Zeilen 22 und 64
  nennen den Rohtext-Modus noch (Code, i18n, Tests, Oberfläche sind frei davon: Modi nur text/number/null). Testname `sql-codemirror-attack.spec.ts:51` erwähnt „raw mode".
- **L-7 Test-Flackern `sql-codemirror.spec.ts` „suggestion list stays usable at 320 px":** wartet nicht auf `.cm-editor`, tippt unter Last ins Textarea-Rückfallfeld.
  1 von 12 Läufen seriell, 11 von 12 mit 6 Workern rot (Dev-Server). Produktfehler ist das nicht (Rückfall nimmt den Text auf), aber der Test ist instabil (Vorbild M-6).
- **L-8 SQL-Stapel (`BatchPanel.svelte`)** hat eigenes Textfeld und führt ohne Bidi-Warnung aus. Vorbestehend und außerhalb des W-P16-Umfangs, aber „alle Wege zur Ausführung" gilt nur für den SQL-Editor.
- **L-9 axe:** nur das bekannte Übergangsbild des „Abfrage ausführen"-Knopfes (color-contrast 3,35 direkt nach Klick, label-content-name-mismatch während Lauf; N-3). Editor, Vorschlagsliste bei 320 px, Dialog: keine Befunde (37 saubere Zustände).

## Wirksamkeit der Fixes aus dem Vorreview

| Befund | Ergebnis |
| --- | --- |
| B-1 Operatoren/Präfixe | behoben. Alle PG-Operatoren (`@> <@ #> #>> ? ?\| ?& -> ->> \|\| << >> !~* #- @? @@ ^@ && <->` u. a.), E/U&/X/B/N/_utf8/_binary-Präfixe, MySQL `<=> := &&`, SQLite `-> ->>` bleiben unversehrt; Echtlauf gleiche Ergebnisse |
| B-2 `- -` wird `--` | behoben (`- - -`, `+-`, `<-`, `=-`, `*-`, `/-`, ausgeführt auf allen 4 Systemen identisch) |
| B-3 Literal/Kommentar | behoben (mehrzeilige Strings mit Zeilenende-Leerzeichen, E-Backslash, verschachtelte PG-Kommentare, Dollar-Tags mit Ziffern, CRLF, Unicode, `/*! */`, `/*+ */`, `-- ` am Dateiende ohne Newline). Rest: M-3 (Servermodus) |
| M-1 Bidi | Markierung ok; Warnung auf allen Wegen (Strg+Enter, Knopf, Lesezeichen/Verlauf per „In Editor übernehmen", Variablenwert, „Unverändert ausführen"), Doppelklick auf „Trotzdem" läuft genau einmal; Lücken M-1/M-2 (neu), L-8 |
| M-2 Klammerung | ok: `-:n +:n *:n /:n <:n >:n =:n` mit n=-5 liefern `(-5)`; Testfall vorhanden |
| M-3 Rohtext | Code/UI/i18n/Tests frei davon; Doku-Reste L-6 |
| M-4 Laufzeit | ok (siehe unten) |
| M-5 Listenscroll | ok: Vorschlagsliste bei 320 px ohne axe-Befund |
| M-6 CSP-Flackern | `test:csp` 6/6 Läufe 3/3. Produkt-Rest (offene Liste nicht aktualisiert bei spätem Katalog) wie im Handoff dokumentiert |

## Differenztest (eigener, unabhängig von `lexer.ts`/`format.ts`)

Dateien: `src/lib/features/sql-editor/rereview-corpus.ts` (eigener Scanner `scan`/`summarize`, Generator, Umformulierer `respace`),
`rereview-differential.test.ts`, `rereview-targeted.test.ts`, `rereview-modes.test.ts`, `rereview-attack.test.ts`, `tests/differential/run-differential.py`,
`tests/browser/sql-codemirror-rereview.spec.ts`.

Korpus je Dialekt ca. 24.000 Anweisungen: je 5.000 generierte (typisierte Ausdrücke aus allen PG-/MySQL-/SQLite-Operatoren inkl. `@> <@ #> #>> ?| ?& -> ->> || << >> !~*`,
Literalpräfixen E U& X B N _utf8 _binary, Dollar-Quotes mit Tags, verschachtelten Kommentaren, mehrzeiligen Strings mit Zeilenende-Leerzeichen, Unicode, CRLF, Tabs,
`--` am Ende ohne Newline, `/*! */`, `/*+ */`), 20-40 Dokumentationsbeispiele je Dialekt, 1.305 SELECT/DML-Texte aus dem Backend-Repo (Fixtures/Tests), ca. 200 handgeschriebene
Angriffsanweisungen (`rereview-targeted`), jeweils plus 2 zufällig umformulierte Varianten und eine CRLF-Variante.

| Prüfung | SQLite | PostgreSQL 18.6 | MySQL 8.4 | MariaDB 12.3 |
| --- | --- | --- | --- | --- |
| Anweisungen / formatiert (Rest verweigert) | 23.982 / 23.691 | 24.039 / 23.323 | 24.028 / 23.577 | (MySQL-Korpus) |
| statisch: Nicht-Leerraum-Folge, Literal- und Kommentarbytes identisch (eigener Scanner) | 0 Verstöße (23.239 verglichen) | 0 (23.323) | 0 (23.043) | – |
| Idempotenz | 0 Verstöße | 0 | 0 | – |
| Echtlauf formatiert vs. unformatiert (reine SELECT) | 20.882 Paare, 14.442 ok, 0 Abweichungen | 19.859 Paare, 14.411 ok / 5.448 Fehler, 2 Abweichungen (H-1) | 20.380 Paare, 11.815 ok / 8.565 Fehler, 173 Abweichungen | 20.380 Paare, 7.868 ok / 12.512 Fehler, 138 Abweichungen |

Abweichungen im Detail: PostgreSQL 2 (ok->Fehler, H-1) plus 5 im Angriffssatz (alle H-1). MySQL/MariaDB: 132/126 Fehler->ok sowie 40/11 Fehler->anderer Fehler, alle durch
Funktionsname-Leerzeichen (L-4, jede Abweichung enthält `count (`/`max (`/`NOW (`…); je 1x ok->ok-Unterschied bei `SELECT @a := 1, @a + 1` (`2.0` vs `2`): Sitzungsvariable bleibt
zwischen den beiden Läufen auf derselben Verbindung stehen, Artefakt des Tests, kein Formatiererfehler. In keinem Fall unterscheidet sich ein erfolgreiches Ergebnis zwischen Original
und Formatierung (ok->ok) außer diesem Artefakt. Die Echtläufe nutzen eigene Wegwerf-Container (`scripts/dbfix.py`, Label `w-p16-rr`, alle entfernt), PostgreSQL mit `default_transaction_read_only`,
MySQL/MariaDB mit `SESSION TRANSACTION READ ONLY`; ausgeführt wurden nur Texte, die mit `select/values/with` beginnen und keine Nebenwirkungs-Wörter enthalten.
Fehlerklasse = SQLSTATE bzw. MySQL-Fehlernummer bzw. SQLite-`errcode`.

Zusätzlich: Zeichenfuzz je Dialekt (60.000 zufällige Kurztexte aus Quote-, Kommentar-, Operator-, Dollar-, Bidi-Bausteinen): gegen den eigenen Scanner 0 Literal-/Kommentarabweichungen
in SQLite und MySQL; PostgreSQL 8 Abweichungen, alle Scanner-Differenz bei `$a$` hinter Bezeichnerzeichen (PG-Bezeichner dürfen `$` enthalten; Lexer ist hier korrekt), kein Formatiererfehler.

## Verifikation (`format.ts`: `strip(out) === strip(sql)` plus erneutes Lexen)

Nicht umgehbar durch Eingaben, die der Lexer selbst richtig tokenisiert: jede Änderung an Nicht-Leerraum-Zeichen oder an Token-Text/-Art liefert `null`
(geprüft im 60.000er-Fuzz und in allen Korpora; `1 . 5` wird verweigert). Grenzen, weil Prüfer und Formatierer denselben Lexer verwenden:
(a) Fehler des Lexers selbst (M-3, L-1, L-2, L-5) sind unsichtbar; (b) Leerraum mit Bedeutung (H-1, L-3, L-4) ist per Definition erlaubt.
Empfehlung: Verifikation um dialektspezifische „Leerraum ist bedeutsam"-Regeln ergänzen (Literal+Literal, `?NNN`, `@v(`) oder die Fälle verweigern.

Verweigerung geprüft: `DELIMITER`, `CREATE FUNCTION/PROCEDURE/TRIGGER`, `BEGIN`, `DO`, offene `'`, `"`, `[`, `/*`, `$a$` ergeben `null` in allen zutreffenden Dialekten (Test).

## Grenzen und Laufzeit

- 100.000 Zeichen: genau 100.000 wird formatiert (1 ms), 100.001 ergibt `null`. Verschachtelung: 40 Klammern ok, 41 `null`, 40 Unterabfragen ok, 41 `null`; je unter 1 ms.
- Laufzeit: 84 kB (1.500 Anweisungen) 16 ms (vorher 1,4 s); 15.000 `) AND`, 40.000 Spalten, 4.000 `BETWEEN … AND`, 30.000 geschachtelte `/*`, 99.000 Operatoren, 9.000 `select (1)`:
  alle unter 500 ms. Keine pathologische Eingabe über 0,5 s gefunden. Platzhaltersuche und Ersetzung bei 30.000 Platzhaltern 9/11 ms.

## Läufe (Worktree `.worktrees/w-p16-cm-rereview`, eigene Ports 4391-4434, 4481; Port 4179 nicht berührt, keine fremden Prozesse beendet)

| Lauf | Ergebnis |
| --- | --- |
| `npm run check` | 0 Fehler, 0 Warnungen |
| `npm test` | 82 Dateien, 1037 Tests grün, 6 erwartete Fehler (`it.fails`, H-1, L-1, L-2, L-3, M-3, wie oben) |
| `npm run format:check`, `contract:check`, `validators:check` | ok |
| `npm run build` | ok (nach Commit, sauberer Baum) |
| `test:csp` | 3/3 in 6 Läufen (jeweils eigener Port, gegen den frisch gebauten `dist`) |
| `test:pwa` | 6/6 |
| Playwright `tests/browser` (ganz) | 139/140; Ausfall war ein Wartefehler meines neuen Bidi-Specs bei beschäftigter Verbindung (Strg+Enter wird dann ignoriert), mit `toPass` stabilisiert, danach 101/102 in 6 Wiederholungen mit 4 Workern (Ausfall L-7) |
| `scripts/test-real-sql-editor.py` | 5/5 (SQLite und PostgreSQL), einmal mit dem gepinnten Backend `3a7e1f1`, einmal mit `DBM_BACKEND_REV=daceabb` |
| axe (`sql-codemirror`, `sql-editor`) | 23 Specs, 37 saubere Zustände, nur L-9 |

Nicht geprüft: echter Screenreader, `DBM_EMBEDDED=1` (eingebettetes Bundle enthält den Editor erst nach Repin), PostgreSQL mit `standard_conforming_strings=off` und MySQL `ANSI_QUOTES` im Echtlauf
(nur als Lexerüberlegung: bei `ANSI_QUOTES` kann `"a\"` analog zu M-3 mispaaren), Windows/Safari.
