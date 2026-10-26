# Unabhängiges Review: Web-Welle (W-P09/10/14/15/16/18/19/26)

Reviewer: unabhängig, nichts implementiert (nur Prüfungen und Angriffs-Specs ergänzt). Geprüft: `integration/web-wave` @ `9dddb99` im Worktree `review/web-wave`. Backend-Gegenstelle: Backend-`main` `3a7e1f1` (v1..v16) und `integration/wave4-backend` (v17..v22).

## Votum

**Freigabe unter Auflagen. Kein Sicherheits-Blocker.** Die Oberflächen sind strukturell XSS-sicher, Pläne sind hash-gebunden, Schreiber sind gegen Doppelklick und Navigation gesperrt, Geheimnisse landen weder in Plan, URL noch Storage. Vor dem Pin ins Backend (`scripts/build-web.py`) beziehungsweise vor einem Release sind jedoch F-1 bis F-4 zu beheben: UI-Aussagen widersprechen dem Backend-Stand `3a7e1f1` (F-1, F-2), die Secret-Abweisung im SQL-Verlauf ist umgehbar (F-3) und der SQL-Editor ist kein gesperrter Writer (F-4). F-1/F-2 sind keine Datenverlust-Risiken (die UI irrt in Richtung Vorsicht oder zeigt die alte Definition weiter an), aber sie geben falsche Sicherheitsauskunft.

## Prüfstand (alle selbst ausgeführt)

| Prüfung | Ergebnis |
| --- | --- |
| `npm run check` | 0 Fehler, 0 Warnungen |
| `npm test` | 54 Dateien, 671 grün (+15 erwartete Fehlschläge = dokumentierte Befunde F-3, siehe unten) |
| `format:check`, `contract:check`, `validators:check` | ok |
| Vertragskopien v1..v16 | SHA-256 und Bytes gleich Backend-`main` **und** `integration/wave4-backend` (v1..v16 dort unverändert); `provenance.json` v16 = `3a7e1f1`, SHA `d90ac3fd…` |
| `npm run build` | ok (Chunk-Warnung >500 kB, bekannt) |
| `test:csp` (Port 4180) | 2 grün |
| `test:pwa` (umgeleitet auf 4481, Port-Assertion mitgezogen) | 6 grün; Worker cached nie `/api`, `/healthz`, `/readyz` (Spec prüft Cache-Schlüssel und `/api/echo` mit Bearer); `dist/sw.js` Kommentar/Logik deckt das |
| Playwright `tests/browser` (Port 4479 statt 4179) | 62 grün vorher, nach den neuen Specs 71 (9 neu) |
| Echtläufe, `DBM_BACKEND_REPO` = Backend-`main` `3a7e1f1`: `test-real-indexes.py`, `-programs.py`, `-search.py` (SQLite), `-sql-batch.py` (SQLite + PostgreSQL 18.6 verify-full) | alle grün |
| axe-core 4.10.2 (`npm i --no-save`, `package.json` unverändert), wcag2a/2aa/21a/21aa/22aa, Endzustand + 320 px, alle 62 Specs | siehe F-6, F-7, F-5 |
| Port 4179 | nicht angefasst |

Nicht möglich/nicht ausgeführt: Echtlauf Konten und Wartung (es gibt kein `test-real-accounts/-maintenance.py`; `tests/real/maintenance.spec.ts` ohne Skript), MySQL/MariaDB-Echtläufe der UI, Screenreader, Safari/Firefox, axe auf Zwischenzuständen (nur Endzustand je Spec).

## Neu committet

- `tests/browser/review-attacks.spec.ts` (9 Tests): feindlicher Text in Konto-/Grant-/Rollen-/Plan-/Programmtexten bleibt Text (`window.__xss`, `img`, `script`), gesendeter Hash und getippter Name exakt, Mehrfachklick = genau ein Execute, Offline bei Listen, Proxy-502-HTML nach Dispatch = `outcome_unknown` ohne Retry, `restore_failed` mit feindlicher Definition. Vier `test.fail()` dokumentieren offene Befunde F-1, F-2, F-4 (schlagen mit der Befundursache fehl, geprüft ohne `test.fail`; beim Beheben `test.fail` entfernen).
- `src/lib/features/sql-editor/review-attacks.test.ts`: 26 Credential-Anweisungen gegen `safeSql`; 15 Umgehungen als `it.fails` (F-3).
- `tests/review/axe-fixture.ts`, `scripts/review-axe.sh`: axe-Lauf über alle Specs (Review-Werkzeug, nicht in CI, benötigt `npm i --no-save axe-core`).

## Befunde

### F-1 (mittel) Programme ersetzen: UI widerspricht dem Backend-Auto-Restore und verbirgt die Backend-Meldung

Backend `3a7e1f1` (`internal/database/programs.go:294,415-491`): MySQL/MariaDB-Ersetzen ist DROP+CREATE; die alte Definition steht in der Plan-Warnung; scheitert das CREATE, wird automatisch wiederhergestellt (`outcome=rejected`, `statements_executed=1` von 2, Meldung „… automatisch wiederhergestellt (restored)“) oder bei Fehlschlag `outcome_unknown` mit der alten Definition in `message` („restore_failed“). `message` und `reason` tragen dies; der Vertrag v16 hat kein eigenes Feld.

Web:
- `ProgramsTab.svelte` zeigt `result.message` nie an. Die einzige Quelle für „wiederhergestellt“ und die Backend-Definition bei `restore_failed` fehlt.
- `programs.nonAtomic` (de.ts) sagt im Plan weiterhin „keine automatische Wiederherstellung“; das steht im selben Plan neben der Backend-Warnung „… automatisch wiederhergestellt“.
- `programs.partial` erscheint bei jedem `0 < statements_executed < statements_total` und behauptet „möglicherweise entfernt und nicht wiederhergestellt“, auch wenn das Backend gerade erfolgreich wiederhergestellt hat. Der Benutzer könnte das Objekt unnötig neu anlegen.
- Veralteter Code-Kommentar in `ProgramsTab.svelte` („the backend never returns it in plan or result“).
- Teil-Entlastung: bei `restore_failed` bleibt `previousDefinition` aus `describe` sichtbar (Spec grün), daher kein Datenverlust.

Reproduktion: `tests/browser/review-attacks.spec.ts` „REVIEW F-1“ (Mock mit der Backend-Antwort; erwartet Meldungstext sichtbar und kein „nicht wiederhergestellt“). Fix: `message` als Text anzeigen; `partial` nur bei `outcome_unknown` oder `restore_failed`; `nonAtomic`-Text korrigieren (de/en).

### F-2 (mittel, repo-übergreifend) Konten: `grant_without_effect` verletzt den Vertrag, die UI zeigt „Ausgang unbekannt“

Backend `internal/database/accounts.go:254` antwortet bei PostgreSQL-GRANT ohne Wirkung `outcome=rejected, reason="grant_without_effect"` („Es wurde nichts geändert“). `AccountResult.reason` in v15 (Backend `contracts/api-v0.15.0.json` und Web-Kopie) kennt den Wert nicht. Der generierte Validator weist die Antwort ab (nachgewiesen: `validators.AccountResult(...)` = false), `AccountsClient.execute` macht daraus `outcome_unknown`. Der Benutzer sieht „Ausgang unbekannt, nicht erneut senden“, obwohl das Backend ausdrücklich „nichts geändert“ meldet. Das ist der sichere Fehlerfall, aber falsch und führt zu unnötiger manueller Prüfung.
Zusätzlich: `AccountResult.message` wird nie angezeigt (nur `reason`-Katalogtexte).
Der Zustand ist ein Backend-Vertragsfehler (Wert im Code, nicht im Vertrag; v15 ist gepinnt und bytegleich, also nur über eine neue Version zu beheben). Systemkonto-Ablehnung `system_account` ist dagegen als Fehlercode abgebildet (`accounts.systemAccount`), `privileged → destructive` greift über `plan.destructive` (getippte Kennung), Selbstaussperr-Zusatzbestätigung über `plan.self` (alles per Spec bestätigt).
Reproduktion: „REVIEW F-2“ (`test.fail`). Fix: Vertrag/Backend um den Wert ergänzen (nächste Version), Web `accounts.grant_without_effect` plus `message` anzeigen.

### F-3 (mittel) SQL-Verlauf: Secret-Abweisung ist per Muster umgehbar

`safeSql` (`features/sql-editor/storage.svelte.ts`) lehnt nur `password|passwd|token|secret` gefolgt von `=`/`:`, `identified by/with` und `password '…'` ab. Nicht abgewiesen (15 von 26 Testfällen, jeweils mit Klartextwert): `SET PASSWORD FOR 'u'@'%' = PASSWORD('x')`, `SET PASSWORD FOR u = 'x'`, `ENCRYPTED PASSWORD E'x'`, `PASSWORD $$x$$` / `$tag$x$tag$`, `IDENTIFIED VIA mysql_native_password USING PASSWORD('x')` bzw. `USING 'x'`, `PASSWORD U&'x'`, `PASSWORD/**/'x'`, `CHANGE MASTER TO MASTER_PASSWORD='x'`, `SOURCE_PASSWORD='x'`, `ATTACH … KEY 'x'`, `PRAGMA key='x'`. Die aktiven Verbindungs-/Backend-Geheimnisse selbst werden dagegen sicher abgewiesen (Substring-Prüfung).
Abmilderung: Verlauf ist standardmäßig aus (Opt-in) und nur lokal; Lesezeichen ohne Ablaufzeit. Reproduktion: `npx vitest run src/lib/features/sql-editor/review-attacks.test.ts`. Fix: konservativ ablehnen, sobald `password`/`passwd` (auch nach `_`), `identified`, `key =`, `$$`-/`E'`-Literale in Nähe davon vorkommen, oder Verlauf mit deutlichem Hinweis „Klartext“ ausweisen.

### F-4 (mittel) SQL-Editor ist kein Writer im Sinne der Sperre

`SqlRunner.execute` (`shell/sql.svelte.ts`, `/api/v1/query`, kann DDL/DML) meldet nichts an `Session.writeCount`. Während der Ausführung ist `beforeunload` nicht geblockt, Hash-Navigation und Reiter bleiben frei, andere Writer-Reiter sind erreichbar (gleichzeitige Schreiber). Das Handoff behauptet „alle Writer“ meldeten Phasen; der Editor ist dort nicht aufgeführt.
Reproduktion: „REVIEW F-4“ (`test.fail`): Abfrage hängt, `beforeunload` wird nicht verhindert. Fix: `onwritephase`-Anbindung (sending/settled/unknown) für `sql.execute`, ggf. nur für nicht-lesende Anweisungen.

### F-5 (niedrig) 320 px: Tabelle anlegen, Überprüfungsschritt

axe-Lauf (Endzustand nach Verkleinerung auf 320 px) meldet Horizontalüberlauf in vier `table-create`-Zuständen (Überschrift/Hinweisblöcke ragen über die Breite). Die vorhandene 320-px-Spec ist grün (anderer Ablauf: von Anfang an 320 px). Möglicherweise nur Nachlauf nach Resize; nicht isoliert. Paket gehört nicht zu dieser Welle, bitte prüfen.

### F-6 (niedrig/mittel, A11y) Scrollbare Tabellenbereiche ohne Tastaturzugang

axe `scrollable-region-focusable` (serious, 22 Knoten, 8 Specs): `.table-scroll` in Konten (Rechte je Bereich), Spalten, Suche hat kein `tabindex="0"`/Rolle/Name; SQL-Stapel macht es richtig (`role="region" tabindex="0" aria-label`). Gleiche Lösung dort anwenden.

### F-7 (niedrig, A11y) Zielgröße

axe `target-size` (WCAG 2.2 AA 2.5.8): Radiobuttons „Struktur/Daten/Beides“ in Objektoperationen (Tabelle kopieren) 13x13 px. Nicht Teil dieser Welle.

### F-8 (niedrig) i18n unvollständig

Englisch ist nur teilweise: hart codierte deutsche Texte in `ConnectionEditor`, `ResultTable` (aria-label), `ExportControls`, `StructurePanel`, `TableWorkbench`, `SourceInformation`, und die Fehlertexte in `src/lib/api.ts`/`session.svelte.ts`. Das Handoff behauptet Parität der Kataloge (zutreffend für die Kataloge, nicht für die Oberfläche).

### F-9 (niedrig) Doppelte Ansage

Bei unbekanntem Ausgang erscheinen in Konten (und vergleichbar in anderen Panels) zwei `role="alert"` mit demselben Satz (Fehlertext plus Hinweis). Screenreader lesen ihn doppelt.

### F-10 (niedrig) SQL-Stapel: gekürzte Ergebnismengen als „Ausgang unbekannt“

`BatchOperation.run` setzt `unknown`, wenn eine Ergebnismenge `truncated` ist. Ein per `max_rows` gekürztes SELECT ist aber kein unbekannter Ausgang; die UI meldet „nicht erneut senden“ und setzt `writeNotice`. Per Code-Lektüre, nicht per Spec nachgestellt.

### F-11 (info)

- Kontopasswort-Feld nutzt `autocomplete="off"`; Browser ignorieren das bei `type=password`. `new-password` verhindert Autofill gespeicherter Passwörter.
- Fehlerantworten mit gültigem Error-JSON (ohne `outcome_unknown`) nach einem Write-Dispatch gelten als endgültig; HTML-Seiten/Abbrüche/Netz gelten korrekt als unbekannt (getestet). Eine Proxy-5xx mit JSON-Fehler-Body wäre theoretisch falsch eingestuft.
- axe `color-contrast` (4 Knoten, primäre Buttons) ist ein Übergangsartefakt (gemessen `#5076db` statt Token `--primary #315dd4`; Kontrast des Tokens ca. 6:1); nicht bestätigt.
- Ergebnistabellen sind nicht virtualisiert (eine Schaltfläche je Zelle); durch Zeilenlimits (SQL-Editor 1000) begrenzt, SQL-Stapel/Tabelle bis `max_rows`; Last bei großen Mengen nicht gemessen.
- Kein `{@html}`, `innerHTML`, `eval`, `new Function`, `srcdoc` im Produktcode; Links nur `#`-Routen und die feste Quell-URL mit `rel=noopener`.

## Schwerpunkte im Überblick

1. **Sicherheit.** XSS: Konten, Grants, Rollen, Notizen, Plan-Statements/Warnungen/Betroffene, Programmnamen/-definitionen/-warnungen, Fehlerzustände: nur Texte (Spec grün). Fehlertexte stammen aus Katalogen (Codes), nicht aus Backend-Freitext. Passwörter: Kontenpasswort nur im Execute-Body, Feld und Zustand werden beim Absenden geleert, nicht im Plan (Spec), nicht in Storage/URL; `localStorage` nur Verlauf (Opt-in) und Theme/Sprache (Allowlist). Verlauf: F-3. Getippter Name: Konten (`plan.destructive`, Kennung `n:name@host`), Programme (Replace/Drop), Indizes (Dialog, Enter bestätigt nie), Suche (Name und Anzahl), Wartung (je Eintrag). Hash-Bindung: Konten/Programme per Spec exakt; Indizes/Suche/Wartung per Code (Basis wird beim Planen geklont, `expected_plan_sha256` aus dem bestätigten Plan). Replay: Phase wird vor dem ersten `await` gesetzt, Mehrfachklick = ein Request (Spec). Sperre: alle Pakete-Writer melden Phasen; Ausnahme SQL-Editor (F-4). Backend-Abgleich: v1..v16 identisch; F-1/F-2 aus den Backend-Änderungen von Welle 3 (3a7e1f1). Wave-4-Backend ändert v13..v16 nicht.
2. **Robustheit.** Offline bei Listen (Konten, Programme): Fehlermeldung, kein veralteter Stand (Spec). `outcome_unknown` ohne Retry in allen Writern (Spec: Konten, Programme; bestehende Specs: übrige). Timeout: Writes 75 s, danach `outcome_unknown`. Leere Ergebnisse und 8-MiB-Antwortgrenze (`result_too_large`) vorhanden.
3. **A11y.** axe: nur F-6, F-7 (und das Übergangsartefakt) in den Endzuständen; Tabellen mit Caption/`scope`, Labels vorhanden, `aria-pressed`, Dialogfokus auf dem Namensfeld. 320 px: Specs der Pakete grün; axe-Nachlauf F-5.
4. **PWA.** Service Worker precacht nie `/api` (siehe Prüfstand).
5. **Verträge.** v1..v16 bytegleich, `validators:check` ok.

## Empfehlungen (Reihenfolge)

1. F-1 und F-2 beheben (Web: `message` anzeigen, Texte korrigieren; Backend/Vertrag: `grant_without_effect`), danach `test.fail` in den Specs entfernen.
2. F-4 (SQL-Editor als Writer) und F-3 (Secret-Muster) beheben.
3. F-6 (Tastaturzugang) und F-9 beheben, F-5/F-8 einplanen.
4. Echtläufe für Konten und Wartung (und MySQL/MariaDB) ergänzen, bevor Welle 4 (v17..v22) darauf aufsetzt.
