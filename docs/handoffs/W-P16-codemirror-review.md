# W-P16 CodeMirror: unabhängiges Review

Stand: 27.10.2026. Geprüft: `feat/w-p16-codemirror` b0d0429 (Basis 4b24e53), Backend `daceabb`, Lizenzvorabeintrag `origin/docs/licenses-w-p16` e40f7ae.
Reviewer hat nichts am Produktcode geändert; ergänzt wurden nur Angriffstests (`src/lib/features/sql-editor/attack.test.ts`,
`tests/browser/sql-codemirror-attack.spec.ts`). Bestätigte Defekte sind dort als `it.fails`/`test.fail` festgehalten (Aussage = korrektes
Verhalten; wird rot, sobald behoben, dann auf `it`/`test` umstellen).

## Freigabe

**Nicht freigegeben (Blocker B-1, B-2, B-3).** Lizenz-, CSP-, Bundle- und Variablen-Sicherheit sind in Ordnung; der Formatierer verletzt
aber die zugesicherte Eigenschaft „ändert nur Leerraum" und ist damit für Freigabe nicht tauglich, solange er nicht korrigiert oder
auf eine harte Allowlist/Verweigerung begrenzt ist.

## Befunde

### Hoch (Blocker)

**B-1 Formatierer zerlegt Operatoren und Literalpräfixe (ändert SQL-Semantik bzw. macht sie ungültig).** Der Lexer behandelt `@`, `#`
(nur MySQL ist Kommentar) und `<` falsch, und `E'`, `U&'`, `X'`, `B'`, `N'`, `x'` als Wort + String; der Formatierer setzt dazwischen ein Leerzeichen.
Reproduktion `formatSql(..., 'postgresql')`:
- `d @> '{}'` -> `d @ > '{}'`; `e <@ x` -> `e < @ x`; `j #>> '{a}'` -> `j # >> '{a}'`; `k #- '{b}'` -> `k # - '{b}'`; `b#>'{y}'` -> `b# > '{y}'`
  (JSONB-/Array-Operatoren werden ungültig oder bedeuten anderes).
- `E'a\nb'` -> `E 'a\nb'` (ein E-String wird zu Alias plus normalem String: andere Escape-Semantik, Syntaxfehler);
  `U&'d\0061t'` -> `U & 'd\0061t'` (Bitweises Und!); `X'41'` / `x'41'` / `B'101'` -> mit Leerzeichen (MySQL/SQLite/PG).
Der vorhandene Test „Tokenfolge gleich" nutzt denselben Lexer und kann geteilte Tokens nicht sehen (Orakelproblem). Tests: F-1, F-2 und
unabhängiges Orakel (Whitespace-bereinigter Text gleich, Operatorläufe erhalten).
Empfehlung: Operatorzeichen-Menge um `@ # & |` etc. erweitern, Präfix (`[EeUuXxBbNn]&?` direkt vor `'`) im Lexer als Teil des Strings behandeln,
Orakel-Test (Entfernen aller Leerzeichen außerhalb von Literalen/Kommentaren ergibt gleichen Text) einführen.

**B-2 Formatierer erzeugt Kommentar aus zwei Minuszeichen.** `SELECT - -1` -> `SELECT --1` (alle Dialekte), `+ +1` -> `++1`. `--1` ist ein
Zeilenkommentar: der Rest der Zeile, auch eine nachfolgende WHERE-Bedingung, wird stillschweigend entfernt. Test F-3.

**B-3 Formatierer verändert Literal-/Kommentarinhalt.**
- Mehrzeilige Literale: Wegschneiden von Leerzeichen am Zeilenende durch `out.replace(/[ \t]+$/gm,'')` auch innerhalb von Strings/Block-Kommentaren
  (`'line1   \nline2'` -> `'line1\nline2'`). Test F-4.
- PostgreSQL: Backslash in `E'..\'..'` wird nicht erkannt (Lexer kennt Backslash nur für `mysql`): `E'a\'   b\''` -> `E 'a\' b \ ''`, also Inhalt neu verteilt. Test F-5.
- PostgreSQL verschachtelte Kommentare: Ende beim ersten `*/`; `/* /* */ ' */ SELECT 'x  y'` -> `' x y '` (Literalinhalt geändert). Test F-6.
- Dollar-Quote-Tags mit Ziffern (`$t1$ a   b $t1$`) werden nicht erkannt, Inhalt neu gesetzt (`a b`). Test F-7.
Empfehlung: Lexer dialektgenau (PG: E-Strings mit Backslash, `standard_conforming_strings`-Annahme dokumentieren, verschachtelte Kommentare mit Tiefe, Tag-Regex `[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*`),
Zeilenende-Bereinigung nur auf Nicht-Literal-Positionen; sonst im Zweifel verweigern (Zweifel = `null`).

### Mittel

**M-1 Trojan Source: bidi- und Steuerzeichen werden nicht markiert.** Die Extensionliste enthält kein `highlightSpecialChars`; `‮`, `⁦`, `​`, `\u0001` im SQL sind
unsichtbar bzw. ändern die Anzeigereihenfolge (Test `sql-codemirror-attack.spec.ts` „Trojan Source", `test.fail`). Ausführung bleibt wie angezeigt/gepastet. Empfehlung:
`highlightSpecialChars({ addSpecialChars: /[؜​-‏‪-‮⁦-⁩﻿]/ })`. Das Textarea-Fallback markiert ebenfalls nichts.

**M-2 Variablen: negative Zahl nach Minus.** `SELECT 10 -:n` mit `n=-5` ergibt `10 --5 AND x`: der Rest der Zeile wird Kommentar (nur Zahl-Modus; der Dialog zeigt die Vorschau, aber die Vorschau ist
die einzige Warnung). Test F-10. Empfehlung: Zahl in Klammern ausgeben oder Vorzeichen-Verklebung verhindern (Leerzeichen vor negativem Wert, wenn das Zeichen davor `-` ist).

**M-3 Rohtext-Modus.** Fügt Wert unverändert ein (`1 OR 1=1; DROP TABLE t` getestet). Die Schreibsperre (`databaseWriteReceiver`) gilt, aber der Modus ist reine SQL-Injektion durch den Benutzer.
Er ist gekennzeichnet und nur für den Benutzer selbst wirksam (kein Fremdwert, Werte nie persistiert), daher kein Sicherheitsbruch, aber kein Nutzen, den „SQL bearbeiten" nicht schon bietet.
**Empfehlung: entfernen** (Text/Zahl/NULL genügen; für Bezeichner/Listen ggf. spätere, strikt validierte Modi).

**M-4 Formatierer skaliert quadratisch.** 84 kB (2000 Anweisungen) in rund 1,4 s, 168 kB in 5,6 s; 500 verschachtelte `SELECT (` rund 79 s (Haupt-Thread blockiert; 1.000.000 Zeichen erlaubt).
Ursache vermutlich Neuaufbau des Strings (`out.replace` je Zeilenumbruch) und `hasTopLevelComma`/`isBetweenAnd` (Rückwärts-/Vorwärtsscan je Token). Test F-9. Empfehlung: Teile in Array sammeln,
Scans begrenzen, Eingabegrenze (z. B. 100 kB) bzw. Abbruch mit Meldung.

**M-5 `scrollable-region-focusable` bei 320 px.** Offene Vorschlagsliste (`ul[role=listbox]` in `.cm-tooltip-autocomplete`) wird von axe bei 320 px bemängelt (2 Treffer, Spec „hostile variable values…", während der Liste).
Die Behebung im Handoff betraf nur den Inhalt. Empfehlung: `tabindex`-freie Lösung (Liste nicht scrollbar machen / `max-height` anpassen) und axe-Nachweis mit offener Liste.

**M-6 Flackernder CSP-Test.** `tests/csp/editor.spec.ts` schlug in 4 von 6 Läufen fehl (`option /customers/` nicht gefunden, Zeile 44): Wettlauf zwischen Tippen und Katalogbefüllung bzw. Vervollständigungsquelle.
Mit `DBM_E2E_PORT` auf eigenem Port; ein vollständiger Lauf aller 3 bestand. Ob auch das Produkt betroffen ist (Liste wird nicht aktualisiert, wenn der Katalog nach dem Tippen eintrifft), ist offen. Empfehlung: Test auf `expect.poll`/erneutes Tippen stabilisieren
und Produktverhalten prüfen.

### Niedrig / Hinweise

- N-1 MySQL `NO_BACKSLASH_ESCAPES`: Text-Modus verdoppelt `\` zu `\\`. Das Quoting bleibt sicher (Hochkommas werden verdoppelt, beide Servermodi lesen `''` als ein Hochkomma), nur der Wert wird bei diesem Servermodus um Backslashes verändert (Datenkorrektheit, keine Injektion).
  Der Client kennt den Modus nicht; im Handoff dokumentieren. Der Lexer nimmt immer Backslash-Escapes an, bei `NO_BACKSLASH_ESCAPES` kann ein `'a\'` fälschlich als offen gelten (Formatierer verweigert dann, harmlos).
- N-2 PostgreSQL Text-Modus ist nur bei `standard_conforming_strings=on` (Standard seit 9.1) sicher; Test dokumentiert das. Echtlauf PostgreSQL 18.6 bestätigt.
- N-3 `label-content-name-mismatch` am Knopf „Abfrage ausführen" (`aria-label` ohne sichtbaren Text, während der Ausführung) und einmaliger `color-contrast` direkt nach dem Klick: nicht Teil des Diffs, vorbestehend/Übergangsbild wie im Handoff.
- N-4 Platzhaltererkennung: korrekt (Strings, Kommentare, Bezeichner, Dollar-Quotes, `::`, `:=`, `a[1:n]`, offene Literale, Limit 32) laut Tests; Werte werden nicht neu gescannt; NUL und >10000 Zeichen verweigert; Zahlmodus strikt.
- N-5 Werte erscheinen weder in `localStorage`/`sessionStorage`/Cookies noch im Verlauf (Spec bestätigt); `variableValues` liegt nur im Speicher.

## Positiv geprüft (kein Befund)

- Formatierer erhält Hints `/*+ */`, Versionskommentare `/*!50000 */`, `#`-Kommentare, Backslash-Escapes (MySQL), Backtick-/Doppelquote-/`[..]`-Bezeichner, getaggte Dollar-Quotes (Buchstaben), und verweigert offene Literale, `BEGIN`, `CREATE FUNCTION/TRIGGER`, `DO`, `DELIMITER` (Tests).
- CSP: `test:csp` 3/3 (bei eigenem Port, Ausnahme siehe M-6); kein `{@html}` in `src/lib/features/sql-editor`; Shadow Root mit `adoptedStyleSheets`; keine `unsafe-inline`-Aufweichung.
- Schreibsperre unverändert: Ausführung weiterhin über `databaseWriteReceiver`; Editor `contenteditable=false` während der Ausführung (Spec); Textarea-Rückfall getestet.
- Vervollständigung ohne zusätzliche Anfrage; Hinweise an Verbindungsidentität gebunden (`ownerKey`), bei anderer Verbindung verworfen.
- Tastatur: Tab/Escape/Strg+M, kein Fallenbefund; Strg/Cmd+Enter und Strg/Cmd+K bleiben Shell-Kürzel.
- axe (WCAG 2.2 AA) für `sql-codemirror`/`sql-editor`: 14/14 Läufe; Befunde nur M-5, N-3 (Kontrast Knopf Übergang).

## Bundle und Lizenzen

- Build 4.979.073 B (4,748 MiB), 40 Chunks, `cm-*.js` vorhanden; Precache unter 8 MiB/64 Chunks, wie im Handoff.
- 15 MIT-Pakete: Versionen in `package.json`/`package-lock.json`/`node_modules` identisch zu `docs/LIZENZEN.md`; `npm ls --omit=dev --all` zeigt exakt diese 15 (8 direkt, 7 transitiv, keine weiteren);
  Lizenzfeld jeweils MIT; jeder LICENSE-Text steht bytegleich in `src/third-party-notices.txt` (Notices rein additiv, Datei wird als `THIRD-PARTY-NOTICES.txt` in `dist` ausgeliefert).
- Backend-Branch e40f7ae: identische Paketliste/Versionen; Verweis auf Web-Commit b0d0429 (muss beim Repin aktualisiert werden); Dateiname `THIRD-PARTY-NOTICES.txt` stimmt mit dem Build-Artefakt überein.

## Läufe (Worktree `.worktrees/w-p16-cm-review`, eigene Ports, Port 4179 nicht berührt)

| Lauf | Ergebnis |
| --- | --- |
| `npm run check` | 0 Fehler, 0 Warnungen |
| `npm test` | 77 Dateien, 1006 Tests grün, 10 erwartete Fehler (`it.fails`, bestätigte Defekte) |
| `npm run format:check` | ok |
| `npm run contract:check`, `validators:check` | ok |
| `npm run build` | ok (nach Commit; Provenienzprüfung verlangt sauberen Baum) |
| `test:csp` | 3/3 (Editor-Spec flackert, M-6) |
| `test:pwa` | 6/6 |
| Playwright `tests/browser` | 128/128 (plus 3 neue Angriffs-Specs, 3/3 mit `test.fail` für M-1) |
| `scripts/test-real-sql-editor.py` | 3/3, SQLite und PostgreSQL, Backend daceabb |
| axe `sql-codemirror`, `sql-editor` | 14 Läufe, Befunde siehe M-5/N-3 |

Nicht geprüft: Kontrast hell/dunkel über das vorhandene Unit-Test-Maß hinaus, echter Screenreader, `DBM_EMBEDDED=1`, MySQL-Echtlauf.
