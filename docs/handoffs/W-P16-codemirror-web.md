# W-P16 Web: CodeMirror-6-Editor

Stand: 27.10.2026. Branch `feat/w-p16-codemirror`, Basis Web-main `4b24e53`. Nicht gemergt; unabhängiges Review offen.
Stand nach Review-Fixes: siehe Abschnitt "Review-Nachbesserung" am Ende.
Entscheidungen: `docs/decisions/ADR-W-P16-codemirror-editor.md`. Aufbauend auf `W-P16-web.md` (lokaler Verlauf/Lesezeichen, unverändert).

## Umfang

- Editor: `src/lib/features/sql-editor/{SqlEditor.svelte,cm.ts}`; CodeMirror 6 als eigener, lazy geladener Chunk in einem Shadow Root
  (CSP `style-src 'self'`). Textarea-Rückfall bei fehlendem Chunk. Dialekte SQLite/PostgreSQL/MariaDB (Treiber `mysql`) über
  `@codemirror/lang-sql`. Zeilennummern, Klammerpaare/-hervorhebung, Suchen/Ersetzen (Panel, Knopf „Suchen und ersetzen“, Strg/Cmd+F),
  Undo/Redo, Auswahlübereinstimmungen, aktive Zeile. Farben ausschließlich über CSS-Variablen (`theme.css`, hell/dunkel, Kontrast je 4,5:1 getestet).
- Tastatur: Tab rückt ein, Escape (schließt zuerst das Suchpanel) dann Tab verlässt den Editor, `Strg+M` schaltet den Fokusmodus;
  Statusmeldung per `role="status"`, Hinweis per `aria-describedby`. Strg/Cmd+Enter (Ausführen) und Strg/Cmd+K bleiben Shell-Kürzel.
- Formatierung: eigener konservativer Formatierer (`format.ts`, `lexer.ts`), nur Leerraum, Tokenfolge und Idempotenz getestet; verweigert
  bei unterbrochenen Literalen, Routinenkörpern, DELIMITER. Knopf „Formatieren“, ein Undo-Schritt. Kein `sql-formatter`.
- Vervollständigung: Tabellen aus `session.objects`; Spalten aus den vom Tabellenarbeitsplatz ohnehin geladenen Beschreibungen
  (`catalog-hints.svelte.ts`, Aufruf in `TableWorkbench.svelte`), nur für die in FROM/JOIN/UPDATE/INTO genannten Tabellen und nach `tabelle.`.
  Keine zusätzliche Anfrage (Test beobachtet die Requests).
- (Review: Rohtext-Modus entfernt; Text/Zahl/NULL, negative Zahlen in Klammern.)
- Lesezeichenvariablen: `variables.ts`, `VariablesDialog.svelte`, `SqlRunner.execute(session, text?)`/`runWithValues`/`runUnchanged`.
  Reine clientseitige Textersetzung mit sichtbarer Warnung, Vorschau, Art Text/Zahl/NULL/Rohtext. Verlauf/Lesezeichen enthalten
  die Vorlage, nie die Werte. Abbrechen führt nichts aus, „Unverändert ausführen“ sendet `:name` wie geschrieben.
- Schreib-/Navigationssperre unverändert: jede tatsächliche Ausführung läuft weiter über `databaseWriteReceiver`; während der
  Ausführung ist der Editor schreibgeschützt (vorher: Textarea deaktiviert).
- Mehrere Editor-Tabs: bewusst nicht umgesetzt (nicht einfach, siehe ADR).
- Lizenzen: 15 MIT-Pakete in `docs/LIZENZEN.md` (Inventar + Nachtrag) und `src/third-party-notices.txt` (Originaltexte, rein additiv).
  Backend-Repo: Branch `docs/licenses-w-p16` (siehe Bericht).

## Bundle (Build `npm run build`, Summe aller Dateien außer `sw.js`, wie `scripts/build-web.py`)

| Stand | Größe | Asset-Chunks |
| --- | --- | --- |
| Basis `4b24e53` | 4.530.880 B (4,321 MiB) | 39 |
| mit CodeMirror | 4.979.073 B (4,748 MiB) | 40 |
| Zuwachs | +448.193 B (+0,427 MiB) | +1 (`cm-*.js`, 409 kB, gzip 134 kB) |

Zuwachs unter 1,5 MiB: der Chunk wird deshalb vorgecacht (Offline-Start inklusive Editor); Grenzen 8 MiB und 64 Chunks eingehalten.
Die Shell lädt den Chunk erst beim Öffnen des SQL-Arbeitsbereichs.

## Tatsächliche Prüfungen

- `npm run check` 0/0, `npm run format:check` ok, `npm test` 76 Dateien / 990 Tests ok (neu: Formatierer, Lexer/Variablen, Hinweise, Kontrast der Syntaxfarben).
- `npm run test:browser`: 128/128 (neu `tests/browser/sql-codemirror.spec.ts`, 8 Fälle: Farben, Zeilennummern, Klammern, Suchen/Ersetzen,
  Tab/Escape, Strg+Enter, Vervollständigung ohne Request, Formatieren/Undo, Variablen, Schreibsperre, 320 px, Textarea-Rückfall).
  Bestehende Specs lesen den Editortext über `tests/browser/editor.ts` (contenteditable statt `toHaveValue`).
- `npm run test:csp`: 3/3 (neu `tests/csp/editor.spec.ts`: keine CSP-Verletzung bei Editor, Suche, Vervollständigung, Formatieren).
  Erster Versuch ohne Shadow Root scheiterte an `style-src-elem` (siehe ADR) und ist der Grund für die Shadow-Root-Lösung.
- `npm run test:pwa`: 6/6.
- axe (WCAG 2.0 A/AA, 2.1, 2.2 AA, `scripts/review-axe.sh sql-codemirror sql-editor`, Endzustand und 320 px): keine Verstöße am Editor.
  Ein `scrollable-region-focusable` bei 320 px wurde durch `tabindex="0"` auf dem Inhalt behoben. Zwei einmalige `color-contrast`-Befunde
  am „Ausführen“-Knopf sind ein Übergangsbild direkt nach dem Klick (mit 600 ms Wartezeit 0 Befunde; Knopf unverändert).
  Das Skript kopiert jetzt auch Hilfsdateien aus `tests/browser/`.
- Echtlauf `python3 scripts/test-real-sql-editor.py` (Port frei gewählt, nicht 4179), Backend `daceabb` lokal gebaut, SQLite und
  PostgreSQL 18.6 (verify-full): 3/3 (Farben, Formatieren, Katalogvervollständigung, Variablen mit feindlichem Textwert bleibt Literal,
  Tabelle bleibt, Rücklesen über v1, PostgreSQL `::`/Dollar-Quote/Backslash). `DBM_EMBEDDED=1` nicht gelaufen: der im Backend eingebettete
  Bundle-Stand enthält den Editor noch nicht (erst nach Repin sinnvoll).

## Offen

- Unabhängiges Review (Formatierer-Randfälle, Lexer für MySQL-Spezialsyntax wie `\`-Escapes, Dialogtexte de/en).
- Repin im Backend (`scripts/build-web.py`: MAX_CHUNKS 64, 8 MiB eingehalten) und Doku des Chunks in `docs/WEBBUILD.md`.
- Mehrere Editor-Tabs, Spaltenvorschläge für nicht geöffnete Tabellen (benötigen eine eigene, begrenzte Strukturabfrage).
- Rohtext-Modus der Variablen ist bewusst mächtig; gekennzeichnet, aber nicht verboten. Falls unerwünscht: Modus entfernen.

## Review-Nachbesserung (Review ad498a2: B-1..B-3, M-1..M-6)

- **B-1/B-3 Lexer** (`lexer.ts`) dialektgenau: Operatorläufe sind EIN Token (`@>`, `<@`, `#>>`, `#-`, `||`, `<=>`, `->>`); `#` und `@`
  sind je Dialekt Kommentar/Variable bzw. Operatorzeichen. Literalpräfixe `E'' U&'' X'' B'' N''` gehören zum Literal. Backslash
  nur MySQL und PostgreSQL-E-Strings; PostgreSQL-Blockkommentare verschachteln; Dollar-Tags mit Ziffern. Leerraum ist nur
  `[ \t\r\n\f\v]` (kein NBSP).
- **B-2 Adjazenz** (`format.ts`): Zwischen getrennten Tokens wird nie Leerraum entfernt, wenn Operatorzeichen oder Wortzeichen
  verschmelzen könnten (`- -` bleibt `- -`); Wort direkt am Literal (`_utf8'x'`) bleibt verklebt.
- **Verifikation im Formatierer** (Verweigerung statt Raten): Text ohne Leerraum von Ein- und Ausgabe identisch, Tokenfolge nach
  erneutem Lexen identisch, sonst `null`. Trailing-Blank-Regex entfernt; Ausgabe wird als Teilearray gebaut (linear). Grenzen:
  100.000 Zeichen, Verschachtelung 40; darüber `null` (kein Web-Worker; Grenze statt Abbruch).
- **Unabhängiger Nachweis** (`format-oracle.test.ts`, ohne den Lexer des Formatierers): (a) Whitespace-freier Text gleich,
  (b) Pool-Literale/-Kommentare byte-exakt in gleicher Anzahl, (c) Idempotenz, jeweils auf 4000 generierten Anweisungen je Dialekt
  (deterministischer Zufall), (d) Ausführung formatiert/unformatiert auf echtem SQLite (`node:sqlite`) mit gleichen Ergebnissen,
  (e) Echtlauf gegen SQLite und PostgreSQL 18.6 (`tests/real/sql-editor.spec.ts`, Korpus inkl. Operatoren, Präfixen, Dollar-Quotes,
  verschachtelten Kommentaren). Die `it.fails`/`test.fail` des Reviews sind auf `it`/`test` umgestellt.
- **M-1**: `highlightSpecialChars` mit Bidi/Nullbreite markiert Zeichen sichtbar; vor jeder Ausführung (auch nach Variablenersetzung)
  mit solchen Zeichen erscheint eine Warnung mit „Trotzdem ausführen“/„Abbrechen“ (`SqlRunner.hiddenPending`).
- **M-2**: negative Zahl wird geklammert (`10 -(-5)`). **M-3**: Rohtext-Modus entfernt.
- **M-4**: linear (siehe oben); 84 kB in unter 400 ms (Test).
- **M-5**: Vorschlagsliste ist kein Scrollcontainer mehr (`overflow: hidden`, Selektor mit höherer Spezifität); axe mit offener Liste
  bei 320 px ohne Befund. **M-6**: Ursache war ein Rennen im Test: der Katalog trifft nach dem Editor ein, vorher kann keine Tabelle
  vorgeschlagen werden. Test wartet nun auf den Katalog; 6 von 6 Läufen von `test:csp` grün. Produkt: eine bereits offene Liste
  wird bei spät eintreffendem Katalog nicht aktualisiert (nächster Tastendruck zeigt sie); bewusst nicht behoben.
- Noch offen/Hinweise: N-1/N-2 (MySQL `NO_BACKSLASH_ESCAPES`, PG `standard_conforming_strings=off`) unverändert dokumentiert.
  Verbleibende axe-Befunde sind nur das vorbestehende Übergangsbild des „Abfrage ausführen“-Knopfes (Kontrast/label-content-name-mismatch, N-3).

Prüfstand: check 0/0, format ok, vitest 78 Dateien / 1018 Tests, Playwright 133/133, `test:csp` 6x 3/3, `test:pwa` siehe Bericht,
axe ohne Editorbefund, `scripts/test-real-sql-editor.py` 5/5 (SQLite und PostgreSQL).
