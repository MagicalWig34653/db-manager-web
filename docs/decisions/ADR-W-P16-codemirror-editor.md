# ADR W-P16: CodeMirror-6-Editor für den SQL-Arbeitsbereich

Stand: 27.10.2026. Status: umgesetzt auf `feat/w-p16-codemirror`, unabhängige Abnahme offen.
Grundlage: Entscheidung E8 (CodeMirror 6, MIT, vorab freigegeben), ADR-W-P16-browserlokaler-sql-komfort.

## Entscheidungen

1. **Editor.** CodeMirror 6 (`@codemirror/{state,view,language,commands,search,autocomplete,lang-sql}`,
   `@lezer/highlight`), ausschließlich per dynamischem Import als eigener Chunk (`cm-*.js`). Bis der Chunk da ist, oder wenn
   er nicht lädt, bleibt ein einfaches Textfeld mit gleichem Namen und gleicher Id (`#sql-editor`) aktiv.
2. **CSP.** Die Produktions-CSP erlaubt `style-src 'self'`. CodeMirror legt im Dokument ein `<style>`-Element an, das blockiert
   würde. Der Editor hängt deshalb in einem offenen Shadow Root; dort nutzt style-mod ein konstruiertes Stylesheet
   (`adoptedStyleSheets`), das die CSP nicht verletzt. Die Theme-Variablen (`--foreground`, `--sql-*` …) vererben sich in den
   Shadow Tree. Der Tastaturhinweis liegt im Shadow Root, damit `aria-describedby` greift. Prüfung: `tests/csp/editor.spec.ts`.
3. **Tab-Falle.** Tab rückt ein (Auswahl: einrücken), `Escape` schaltet in den Fokusmodus, der nächste Tab verlässt den
   Editor; jede andere Taste, Fokusverlust oder `Strg+M` beendet den Fokusmodus. Escape schließt zuerst ein offenes
   Suchpanel. Strg/Cmd+Enter (Ausführen) und Strg/Cmd+K (Editor fokussieren) bleiben bei der Shell.
4. **Dialekte.** `@codemirror/lang-sql`: SQLite, PostgreSQL, MariaDB-Dialekt für den Treiber `mysql` (MySQL und MariaDB).
5. **Formatierung.** Eigener, konservativer Formatierer (`format.ts`) statt `sql-formatter` (MIT, 3,1 MB entpackt): ändert
   nur Leerraum, nie Schreibweise, Zeichenketten, Kommentare, Bezeichner, Dollar-Quotes oder die Tokenfolge (per Test
   bewiesen, einschließlich Idempotenz). Bei unterbrochenen Literalen, Routinenkörpern (`BEGIN`, `CREATE FUNCTION/PROCEDURE/TRIGGER`,
   `DO`, …) und `DELIMITER` formatiert er nicht und meldet es. Ein Undo-Schritt stellt den Text wieder her.
6. **Vervollständigung.** Tabellen kommen aus dem bereits geladenen Katalog (`session.objects`). Spalten stammen nur aus
   Tabellen, die der Tabellenarbeitsplatz ohnehin geladen hat (Beschreibung, `remember`-Aufruf); der Editor stellt keine
   eigene Anfrage. Spalten werden für Tabellen angeboten, die die Anweisung hinter FROM/JOIN/UPDATE/INTO nennt, sowie nach
   `tabelle.`. Die Hinweise sind an die Verbindungsidentität (ohne Passwort) gebunden und werden bei anderer Verbindung verworfen.
7. **Lesezeichenvariablen.** `:name` wird mit demselben Lexer wie der Formatierer gefunden (nicht in Zeichenketten,
   Kommentaren, quotierten Bezeichnern, Dollar-Quotes, nicht bei `::`/`:=` oder `a[1:2]`). Vor dem Ausführen öffnet sich ein
   Dialog mit Warnung „reine Textersetzung im Browser“, Art je Variable (Text, Zahl, NULL, Rohtext) und Vorschau des
   gesendeten SQL. Text wird mit verdoppelten Hochkommas (MySQL zusätzlich Backslash) gequotet, Zahl streng geprüft, Rohtext
   unverändert eingefügt (gekennzeichnet). Ersetzt wird ausschließlich clientseitig; das Backend sieht nur den fertigen Text und
   kennt keine Platzhalter. Eingefügte Werte werden nie erneut gescannt. Verlauf und Lesezeichen speichern die Vorlage mit
   `:name`, nie die Werte; die Werte bleiben nur im Arbeitsspeicher der Seite. „Unverändert ausführen“ sendet den Text wie
   geschrieben. Schreib-/Navigationssperre (`databaseWriteReceiver`) gilt unverändert für jede tatsächliche Ausführung.
8. **Mehrere Editor-Tabs.** Nicht umgesetzt (nicht einfach: Zustand, Verlauf und Schreibsperre sind an einen Runner gebunden).
9. **Vorcache.** Der Chunk wird vorgecacht (Zuwachs unter 1,5 MiB), damit der Editor offline funktioniert.

## Folgen

Neue Laufzeitabhängigkeiten (alle MIT, im Lockfileinventar und in `THIRD-PARTY-NOTICES` eingetragen). Der Textarea-Rückfall
bleibt als Absicherung. Die Eingabe per Assistenztechnik prüft axe (WCAG 2.2 AA) ohne Befund am Editor.
