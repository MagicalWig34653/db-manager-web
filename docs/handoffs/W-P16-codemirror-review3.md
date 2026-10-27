# W-P16 CodeMirror: Review 3 (fokussierter Kurzreview)

Stand: 27.10.2026. Geprüft: `feat/w-p16-codemirror` 6efbf6b, Backend `daceabb`. Nichts am Produktcode geändert.

## Freigabe

**Freigegeben, kein Blocker, keine offenen Befunde mit Handlungsbedarf.** H-1, M-1..M-3 und L-1..L-8 sind wirksam behoben.

## 1. Leerraum-Semantik gegen echte Server (neuer Korpus)

Neuer Korpus (`src/lib/features/sql-editor/rereview3-corpus.test.ts`), andere Quellen und andere Erzeugung als beim Autor: 221 Anweisungen aus dem Repo
db-cluster-manager, 1.305 aus dem Backend-Repo, neue Generatorseeds, Dokumentationsbeispiele und PG-Dollar-Quote-Körper; jede Quelle mutiert
(Zeilenkommentare `-- `, `--<Tab>`, `--` + LF/CRLF, `#`, `--x`, `/*! */`, `/*!50000 */`, `/*M!100000 */`, `/*+ */`, Blockkommentare mit Umbruch,
zusätzliche Umbrüche, `-- ` am Ende ohne Newline, `--` am Textende, jedes Leerzeichen durch `-- c<LF>` ersetzt).
Echtlauf formatiert gegen unformatiert (eigene Container `w-p16-rr`, entfernt, nur lesend):

| System | neue Paare | ok | Fehler | Abweichungen |
| --- | --- | --- | --- | --- |
| PostgreSQL 18.6 | 15.006 | 9.525 | 5.481 | 0 |
| MySQL 8.4 | 12.762 | 5.922 | 6.840 | 1 (Testartefakt `@a := 1, @a + 1`: Sitzungsvariable bleibt stehen) |
| MariaDB 12.3 | 12.762 | 4.412 | 8.350 | 1 (dasselbe) |
| SQLite (`node:sqlite`) | 15.646 | – | – | 0 |

Darin u. a. 11.409 PG-Paare mit Zeilenkommentar plus Umbruch, 1.749 MySQL-Paare mit `/*!`, 957 mit `/*+`, 18 mit `--x`, 238 mit Dollar-Quote, 7 Literal-Fortsetzungen.
Statisch (eigener Scanner): 0 Verstöße gegen "nur Leerraum" und gegen Idempotenz. Ein Zeilenkommentar behält in jedem Fall seinen Umbruch; Fehler->ok und
ok->Fehler: 0. DELIMITER, Routinenkörper, offene Literale, zwei Literale in Folge, MySQL-Backslash-Literale werden verweigert.

## 2. M-1, M-2, L-8 (neue Specs `tests/browser/sql-codemirror-review3.spec.ts`, 9 Specs, 27/27 bei 3 Wiederholungen)

- M-1: Editor ist während der Warnung `contenteditable=false`, Tippen wird verweigert, fünf weitere Strg+Enter erzeugen keine zweite Warnung und keine Abfrage,
  Doppelklick auf "Trotzdem ausführen" sendet genau eine Abfrage; Verlauf = exakt ausgeführter Text; nach Abbrechen ist der Editor wieder bearbeitbar und läuft normal.
- M-2 Falsch-Positive: Umlaute, CJK/Koreanisch/Arabisch/Hebräisch, Emoji ohne Variationsselektor, Tab, typografische Anführungszeichen lösen keine Warnung aus.
  Hinweis (kein Befund): Emoji mit U+FE0F oder ZWJ-Folgen (z. B. Herz-Emoji) lösen als Default-Ignorable die Warnung aus; das ist gewollt konservativ.
- L-8: SQL-Stapel: "Bestätigt ausführen" bleibt mit unsichtbarem Zeichen ohne zusätzliches Kontrollkästchen gesperrt, die Anforderung entfällt und setzt sich zurück, wenn das Zeichen entfernt wird.

## 3. Läufe

| Lauf | Ergebnis |
| --- | --- |
| `npm run check` | 0 Fehler, 0 Warnungen |
| `format:check` | ok |
| `npm test` | 83 Dateien, 1050 Tests grün |
| `npm run build` | ok |
| `test:csp` | 5 Läufe je 3/3 |
| `test:pwa` | 6/6 |
| Playwright `tests/browser` (Port 4462, nicht 4179) | 149/149 |
| `scripts/test-real-sql-editor.py` (Backend daceabb) | 5/5 |
