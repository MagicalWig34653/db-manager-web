# Unabhängiges Review: Web-Welle 2 (W-P12/13/17/27/28/29)

Reviewer: unabhängig, nichts implementiert (nur Prüfungen und Angriffs-Specs ergänzt). Geprüft: `integration/web-wave2` @ `757a203` im Worktree `review/web-wave2`. Backend-Gegenstelle: Backend-`main` `cf3d406` (Verträge v1..v23, Wave 4). Vorbild: `WEB-WAVE-REVIEW.md`.

## Votum

**Freigabe unter einer Auflage. Kein Sicherheits-Blocker.** Es gibt kein `{@html}`, `innerHTML`, `eval`, `new Function` oder `srcdoc` im Produktcode; Dateinamen für Downloads kommen nie roh aus Server- oder Tabellennamen; Geheimnisse landen weder in Logs (kein `console.*`), Storage (nur UI-Einstellungen) noch URLs. Serveradministration und Überwachung sind nachweislich rein lesend. Alle Schreiber (Import, Bulk, Dateiwerte, Partitionen, Präfix-Stapel) sind doppelklicksicher und plan-gebunden.

**Auflage vor dem Pin (F-1, mittel):** Der Mehrzeilen-Dialog (Bulk) lässt sich während eines laufenden Execute-Requests per Escape, Klick außerhalb oder Schließen-Symbol beenden. Dabei wird die Schreibsperre gelöst, obwohl der Write beim Server noch laufen kann. Das Ergebnis geht verloren, und ein zweiter Schreiber oder ein Reload ist ungebremst möglich. Fix ist klein (siehe F-1). Alles andere sind niedrige Befunde oder Hinweise.

## Prüfstand (alle selbst ausgeführt)

| Prüfung | Ergebnis |
| --- | --- |
| `npm run check` | 0 Fehler, 0 Warnungen (5234 Dateien) |
| `npm test` | 73 Dateien, 964 grün, 1 erwarteter Fehlschlag (= F-2, dokumentiert) |
| `format:check`, `contract:check`, `validators:check` | ok |
| `npm run build` | ok; Chunk-Warnung >500 kB (bekannt). Precache: 49 Dateien, 4 502 002 Byte (4,29 MiB), 39 unter `assets/`; Grenzen 8 MiB und `MAX_CHUNKS` 64 eingehalten |
| Playwright `tests/browser` (Port 4586) | 115 grün (106 vorhanden + 9 neue) |
| `test:csp` (Port 4582) | 2 grün |
| `test:pwa` | 6 grün, Standardport 4181. Mit `PWA_TEST_PORT` schlägt es fehl (F-3) |
| Echtläufe `scripts/test-real-*.py`, `DBM_BACKEND_REPO` = Backend-`main`, Revision `cf3d406` | `import` (SQLite + PostgreSQL TLS, 6 Tests), `export-formats` (SQLite, PostgreSQL, 2), `partitions` (SQLite, PostgreSQL, 4), `server-admin` (SQLite, MySQL, MariaDB, PostgreSQL, je 2): **alle grün**; Container, Prozesse, Checkout entfernt |
| Vertragskopien v1..v23 | Bytes gleich Backend-`main` (`cmp`), SHA-256 von v17 und v23 gleich `provenance.json` |
| Validator-Slimming, differenziell | siehe unten |
| axe-core (wcag2a/2aa/21a/21aa/22aa, Endzustand + 320 px) über import, bulk, server-admin, partitions, export (38 Specs) | nur `color-contrast` (siehe F-7); kein Überlauf, kein `scrollable-region-focusable` mehr |
| Port 4179 / fremde Prozesse | nicht angefasst; verwendet wurden 4581..4586 (Playwright), 4585 (axe), 4181 (PWA, war frei) |

Nicht ausgeführt: MySQL/MariaDB-Echtläufe für Import, Bulk, Export-Formate, Partitionen (Skripte decken dort nur SQLite und PostgreSQL ab); Screenreader; Safari/Firefox; echte große Importe (>64 MiB) und Exporte im Browser.

### Validator-Slimming (differenziell)
Alle 592 JSON-Fixtures aus Backend `contracts/fixtures/**` gegen jede Wurzel jeder Vertragsversion in `scripts/validator-roots.json` (v2..v23): schlanker, generierter Standalone-Validator gegen einen frisch kompilierten Ajv-2020-Validator des vollen Schemas, zusätzlich je sieben Mutationen pro namensgleichem Fixture (null, Array, leeres Objekt, String, Zahl, Zusatzfeld, fehlendes Feld). **147 506 Vergleiche, 0 Abweichungen, 0 fehlende Exporte.** Vollständigkeit der Wurzelliste: alle 47 statischen `validators.X`-Zugriffe sowie alle Namensliterale der dynamischen Aufrufe (accounts, bulk, import, overview, search, sql-batch) stehen in der jeweiligen Wurzelliste der benutzten Version; die schmalen `.d.ts` machen Lücken zusätzlich zur Entwicklungszeit zu `svelte-check`-Fehlern (grün).

## Neu committet

- `tests/browser/review-wave2-attacks.spec.ts` (9 Tests, davon 1 `test.fail` für F-1): Auto-Refresh unter kontrollierter Uhr (`page.clock`): hängende Antwort erzeugt nie eine zweite gleichzeitige Anfrage, auch nicht nach Minuten, Abbruch beim Abschalten; verdeckte Seite bricht die Anfrage ab, sendet nichts und läuft beim Sichtbarwerden sofort weiter; exponentieller Backoff 10 s, 20 s, 40 s und endgültiger Stopp nach der Fehlergrenze; Verlassen der Ansicht bricht ab und stoppt den Timer; Inventar aller Anfragen von Serveradministration und Überwachung (nur die dokumentierten Lesepfade, richtige Methode, keine Schreib-Schlüssel im Body); Dateiwert-Upload sperrt Navigation und `beforeunload` und gibt beides danach frei (schließt die im Handoff genannte Lücke, kein Befund); SQL-Import-Abbruch beim Hochladen löst die Sperre und sendet nichts erneut; Verwerfen des Zeileneditors während des Uploads; F-1 als `test.fail`.
- `src/lib/features/export/review-wave2.test.ts` (27 Tests, 1 `it.fails` für F-2): feindliche `Content-Disposition`-Namen (`../`, `..\`, RTL-Override, Windows-Gerätenamen, NUL, Punktdateien, 5000 Zeichen, leer, prozentkodiert) und `filename*`, Dateiwert-Downloadnamen.
- `src/lib/features/server-admin/review-readonly.test.ts` (4 Tests): Quelltext von `server-admin` und `monitor` enthält nur die dokumentierten `/api/v17|v20`-Pfade, keine Schreibverben (`KILL`, `FLUSH`, `PURGE`, `SHUTDOWN`, `pg_terminate_backend`), kein PUT/DELETE/PATCH und keinen `onwritephase`-Aufruf.

Werkzeug für Wiederholung: `npm i --no-save axe-core && AXE_PORT=4585 scripts/review-axe.sh import bulk server-admin partitions export`.

## Befunde

### F-1 (mittel) Bulk-Dialog: Schließen während des Execute-Requests löst die Schreibsperre

`BulkDialog.svelte` ruft bei jedem `onOpenChange(false)` `close()` auf, auch wenn `operation.phase === 'executing'`. `close()` ruft `operation.reset(onwritephase)`; ein gemeldetes `sending` wird dabei als `unknown` abgeschlossen (Zähler sinkt, globaler Hinweis „Ausgang unbekannt“). Der Request ist damit aber nicht abgeschlossen: `reset` bricht ihn nur clientseitig ab (`controller.abort()`), der Server kann den Write trotzdem ausführen oder gerade ausführen; eine spätere Antwort wird wegen `mine !== generation` verworfen. Folgen:
- `beforeunload` und Navigation sind während des laufenden Writes nicht mehr gesperrt, andere Schreiber können gleichzeitig starten.
- Das echte Ergebnis (gelöscht oder nicht) wird nie angezeigt, nur „unbekannt“.
- `back()` hat die Wache `if (busy) return`, `close()` nicht.

Reproduktion: `tests/browser/review-wave2-attacks.spec.ts` „REVIEW F-1“ (`test.fail`): Execute hängen lassen, Escape drücken, `beforeunload` ist nicht mehr verhindert. Fix: in `onOpenChange` (und im Verwerfen-Button) bei `operation.phase === 'executing'` das Schließen ignorieren (Dialog bleibt offen, Schließen erst nach dem Ergebnis), danach den `test.fail` entfernen.

### F-2 (niedrig) SQL-Abschlussprüfung: Schlussmarke in mehrzeiligem Textliteral wird akzeptiert

Der SQL-Verifier prüft nur `;\n-- DBMANAGER EXPORT COMPLETE\n` am Ende. SQLite und PostgreSQL schreiben Text mit rohen Zeilenumbrüchen im Literal (`exportLiteral`, Backend `export_format.go`). Eine Zelle `x;\n-- DBMANAGER EXPORT COMPLETE\n` führt, wenn der Strom genau nach dieser Zeile abgeschnitten wird, zu „vollständig“ (`INSERT INTO t VALUES ('x;\n-- DBMANAGER EXPORT COMPLETE\n`). Der vorhandene Test deckt nur die Variante ohne `;` ab. Voraussetzung ist ein Abschneiden exakt an dieser Stelle (praktisch nur mit böswilliger Zelle plus gezieltem Abbruch); die anderen Formate sind durch die Backend-Escapes (XML, JSON-Strings, PHP `\xNN`, LaTeX, Wiki `&#N;`) nicht betroffen. Reproduktion: `review-wave2.test.ts`, `it.fails`. Fix: im Verifier Anführungszeichen-Parität (`'`, verdoppelt) mitführen und die Marke nur außerhalb eines offenen Literals zulassen; Kommentarzeilen mit `'` im Kopf beachten (`safeExportComment`), oder die Marke im Backend zusätzlich mit Prüfsumme/Längenangabe versehen.

### F-3 (niedrig) Port-Konsolidierung unvollständig

`DBM_E2E_PORT` wirkt in `playwright.config.ts` (Aliase `DBM_TEST_PORT`, `DBM_PW_PORT`) und `playwright.csp.config.ts` (nur Alias `DBM_PW_PORT`, nicht `DBM_TEST_PORT`). Ein gesetztes `DBM_TEST_PORT` verschiebt also den Dev-Server, nicht den CSP-Server (Standard 4180). Die PWA-Konfiguration ist nicht konsolidiert: `tests/pwa/serve.mjs` liest `PWA_TEST_PORT`, aber `playwright.pwa.config.ts` (`baseURL`, `webServer.url`) und `pwa.spec.ts` (Scope-Assertion) sind auf 4181 festgeschrieben. Mit `PWA_TEST_PORT=4583` läuft der Server auf 4583, Playwright wartet auf 4181 und läuft in den 60-s-Timeout (reproduziert). Keine Seiteneffekte auf Produktcode; belegt: mit Standardports und mit `DBM_E2E_PORT` alles grün. Fix: Port in beiden Konfigurationen aus derselben Variable lesen und in der PWA-Spec den Scope aus `baseURL` ableiten.

### F-4 (niedrig) i18n: hart codierte deutsche Texte in neu angefassten Oberflächen

Katalogparität de/en ist gegeben (Test grün; keine deutschen Wörter in en; identisch sind nur Fachbegriffe). Hart codiert bleiben (englische Oberfläche zeigt Deutsch): `RowWorkspace.svelte` („Zeile hinzufügen“, „Angabe für …“, „Wert angeben“, „Werttyp für …“, „Ganze Zahl“, „Fließkommazahl“, „Binär (Base64)“, und in Welle 2 neu eingeschleppt „Verwerfen“ und „Änderung prüfen“), außerdem wie im vorigen Review (F-8) `SourceInformation`, `StructurePanel`, `TableWorkbench`. Die neuen Paket-Verzeichnisse (import, bulk, server-admin, monitor, export, partitions) sind nach Heuristik-Scan frei von hart codierten Texten.

### F-5 (info) Upload-Abbruch: Fenster zwischen „Body gesendet“ und `upload.onload`

`ImportOperation.execute` wertet einen Abbruch in Phase `uploading` als „Server kann nichts gestartet haben“ (`settled`, Plan nicht verbraucht, SQL erneut startbar). Das Backend liest die Datei vollständig (`io.ReadAll` mit Limit), bevor die erste Anweisung läuft, und `upload.onload` wird beim vollständigen Absenden ausgelöst; das Fenster ist also nur die Latenz zwischen letztem Byte und Ereignis. Bei einem Abbruch genau in diesem Fenster wäre die Aussage falsch. Im Test mit abgefangenem Request (Playwright hält den Request vor dem Netz) bleibt die Phase `uploading`, auch wenn der Body angeblich komplett ist; das ist ein Test-Artefakt. Empfehlung: nach `onProgress` mit `loaded === total` Abbruch wie in Phase `starting` behandeln (unbekannt).

### F-6 (info) Import: fehlgeschlagener Abbruchaufruf nicht wiederholbar

`ImportOperation.cancel` setzt `cancelRequested = true` vor dem Aufruf; schlägt der Aufruf fehl (Netz), bleibt der Hinweis „Abbruch angefordert“ stehen, ein zweiter Versuch ist gesperrt. Der Job läuft dann bis zum Ende weiter (Status-Poll liefert das Ergebnis, kein Datenrisiko).

### F-7 (info) axe `color-contrast` (9 Knoten, 7 Specs)

Primäre Buttons (`bg-primary`) werden mit `#6787df` statt Token `#315dd4` gemessen (Kontrast 3,38). Wie im vorigen Review ein Übergangsartefakt der Einblend-Animation im Endzustand der Specs, nicht bestätigt. Andere Verstöße wurden nicht gemeldet; die früheren Befunde F-6 (Tastaturzugang scrollbarer Bereiche) und F-5 (320-px-Überlauf) treten in den Wave-2-Specs nicht mehr auf.

### F-8 (info) Sonstiges, bewusst festgehalten

- Serveradministration: Maskierung entscheidet allein das Backend (Whitelist + numerisch, `serveradmin.go`); der Client erzwingt zusätzlich „masked ⇒ value null“ und zeigt nie einen Wert maskierter Zeilen. Paging nutzt Offset/Limit des Servers und prüft die Antwort auf Konsistenz.
- Überwachung: nicht verfügbare Quelle (`state: unavailable`) und Rechtefehler sind getrennt dargestellt (vorhandene Specs plus meine Pfadprüfung). Replikation „leer“ trägt den Hinweis „kein Beweis“.
- Poller: fatale Codes beenden, übrige Fehler verdoppeln den Abstand bis zu 5 Fehlschlägen; ein manueller Refresh bricht eine laufende Poll-Anfrage ab und wird vom Poller als Erfolg gewertet (harmlos). Pause bei verdeckter Seite bricht auch einen manuell gestarteten Refresh ab.
- Export: Download/Datei erst nach Verifikation (`sink.commit` nur bei `complete`), `FileSystemSink` bricht über `abort()` ab; Speicher-Fallback 256 MiB; `export_busy` (503) wird erklärt. Truncation-Sweeps und gzip-Fälle in `review.test.ts` bestätigt.
- Partitionen/Präfix: Plan gilt einmal (`phase` kippt synchron vor dem ersten `await`), Anfragekörper ist beim Plan eingefroren, getippter Name stammt aus dem Plan (`confirmation.target_name`), Teilzustand je Tabelle (`applied/not_applied/unknown`) sichtbar, feindliche Namen nur als Text.
- Bulk/Dateiwerte: Dateigröße lokal und im Client (512 KiB) begrenzt, Download prüft `Content-Length` gegen Bytes und lässt nur `application/octet-stream` oder `image/png` zu; `plan_conflict` und `row_conflict` machen den Plan unbrauchbar (neue Vorschau nötig).

## Schwerpunkte im Überblick

1. **XSS/Dateinamen.** Keine Senken im Produktcode; feindliche Texte in Prozessnamen, Importdateinamen, Plan-/Vorschauzellen, FK-Anzeigetexten, Präfixnamen als Text (Specs + neue Namensprüfung).
2. **Geheimnisse.** Kein `console.*` im Produktcode; `localStorage` nur in Einstellungen und SQL-Bibliothek (bestehend), nicht in den neuen Features; kein Wert in URLs (nur Hash-Routen). Profiling-SQL und Binlog-Texte gehen nur im Request-Body.
3. **Schreib-/Navigationssperre.** Import (SQL und CSV), Bulk, Dateiwert-Upload, Partition, Präfix melden `sending`/`settled`/`unknown` genau einmal je Dispatch; Lücke Dateiwert-Upload und SQL-Import-Abbruch ist jetzt per Spec belegt und geschlossen. Einzige echte Lücke: F-1.
4. **Doppelklick.** Import (zweifacher Klick im selben Tick), Bulk, Partitionen, Export, Dateiwert: je ein Request (Specs).
5. **Auto-Refresh.** Siehe neue Specs; kein Stau, Backoff, Pause, Abbruch beim Verlassen, Stopp bei fatalen Fehlern.
6. **Verträge/Slimming/Precache.** Siehe oben; 4,29 MiB, 49 Dateien.
7. **PWA.** Service Worker precacht nie `/api`, `/healthz`, `/readyz` (unverändert seit `f830326`; `dist/sw.js` geprüft).
8. **i18n.** F-4. **320 px.** Pakete-Specs und axe-Überlaufprüfung grün.

## Empfehlungen (Reihenfolge)

1. F-1 beheben (Dialog nicht schließbar während `executing`), `test.fail` entfernen.
2. F-2 und F-3 einplanen (Verifier-Literalzustand, einheitliche Portvariablen inklusive PWA).
3. F-4 (RowWorkspace-Texte in Kataloge) zusammen mit den älteren i18n-Resten.
4. MySQL/MariaDB-Echtläufe für Import, Bulk, Export-Formate und Partitionen ergänzen.
