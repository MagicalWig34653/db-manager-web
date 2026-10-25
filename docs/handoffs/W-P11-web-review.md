# Review W-P11 Web: Export und SQL-Dump (API 0.11)

Unabhängiger Review von `feat/w-p11-web` (`d78c968`, abgeglichen mit Web-main). Review-Branch `review/w-p11-web`, eigener Worktree,
`node_modules` als `cp -cR`-Kopie; Autorenbranch unverändert, nichts gemergt. Backend: Root-`main` `c331c64`.

## Urteil

**Freigabe mit Auflagen (F1 mittel, F2 und F3 niedrig bis mittel).** Die Schlussmarken-Prüfung ist in allen getesteten Schnitt-
und Chunkfällen für SQL, JSON und GZip korrekt; eine unvollständige Datei wird nie committet, gespeichert oder zum Download
angeboten. Offen sind eine Speicheraufblähung durch `tee()` bei langsamer Senke (F1) und zwei dokumentierte Lücken der
Marken-Erkennung (CSV-Kontrollsatz ohne Feldzahl, SQL-Marke im Literal).

## Prüfungen (nacheinander; Last 8 bis 270)

| Befehl | Ergebnis |
| --- | --- |
| Vertragskopie `v11/api-v0.11.0.json` | SHA-256 `b3bcc38b44b020335151aead207e281f9c54bdc7463d6fb1ddd7a6cc22396620`, byteidentisch zu Root `contracts/api-v0.11.0.json` |
| `npm run contract:check` / `check` / `format:check` | aktuell / 0 Fehler, 0 Warnungen / bestanden |
| `npm test` | 28 Dateien, 220 bestanden, 4 erwartete Fehlschläge (`it.fails`, F1 bis F3, in `review.test.ts`) |
| `npm run test:browser` | 36 bestanden |
| `npm run test:csp` | 2 bestanden |
| `scripts/test-real-export.py` (`DBM_BACKEND_REPO=<Root>`, `REV=main`) | 2 bestanden (SQLite, PostgreSQL verify-full) |
| `scripts/test-real-tables.py` | 10 von 10 |
| `test-real-object-ops.py` / `test-real-create.py` / `test-real-overview.py` | 4 / 2 / 2 bestanden |
| Eigene Probe MySQL 8.4 und MariaDB 12.3 (Wegwerf über `scripts/dbfix.py`, Go-Backend aus Root-main, Skript nicht im Repo) | Tabelle mit Sondernamen (`p11 odd"t`), NULL, Leerstring, Binär, Dezimal, BIGINT-Maximum, Unicode/Backslash/Anführungszeichen und Text mit Markerzeile als Dateninhalt: SQL-Dump (DROP, IF NOT EXISTS, Transaktion, erweiterte INSERTs), JSON und CSV enden mit Schlussmarke; SQL-Dump per `mysql`/`mariadb`-Client in frische DB eingespielt (rc 0), Zeilen byteidentisch (5 Zeilen); gekürzter Dump hat keine Marke. Container danach entfernt |

## Befunde

### F1 (mittel) `tee()` puffert den gesamten Strom, wenn die Senke langsamer als das Netz ist
Beleg: `run.ts` teilt `response.body.tee()` in Senke und Prüfer; `tee()` hat keinen Gegendruck zwischen den Zweigen. Probe
(`review.test.ts`, 600 Blöcke à 64 KiB, Senke mit 2 ms Verzögerung): der Prüfzweig läuft 598 von 600 Blöcken voraus, der Rest
(37 MiB) liegt im Speicher. Bei File System Access auf langsamer Platte und bis 1 GiB `max_bytes` widerspricht das der Aussage
"konstanter Speicher".
Fix: ohne `tee()` mit einer Leseschleife: Block lesen, `await sink.write`, dann denselben Block an den Prüfer geben; bei GZip den
komprimierten Block in einen `DecompressionStream`-Writer schreiben (`await writer.write`) und die Ausgabe parallel lesen.
Test: der als `it.fails` markierte Fall wird grün.

### F2 (niedrig-mittel) CSV-Kontrollsatz wird ohne Feldzahl geprüft
Beleg: die Prüfung nimmt `^"'?complete"(,"'?")*$`. Das Backend schreibt den Kontrollsatz mit Spaltenzahl plus 1 Feldern
(`export_format.go`, `finish`). Ein Datensatz, dessen erste Spalte `complete` ist und der sonst leer ist, sieht gleich aus; endet ein
abgebrochener Strom genau nach einem solchen Satz, wird er als vollständig akzeptiert (Probe: Test "CSV: a data record that looks like
the control record", `it.fails`). Das Kürzen an genau dieser Zeilengrenze ist unwahrscheinlich, aber die Pflichtprüfung soll nicht
von Dateninhalt abhängen.
Fix: Feldzahl der Kopfzeile merken und verlangen, dass der Kontrollsatz genau eine Spalte mehr hat (Anführungszeichen-Zustandsmaschine
zählt Felder bereits mit). Ohne Kopfzeile (falls das Backend sie ausschalten kann): Feldzahl der Datensätze verwenden.

### F3 (niedrig, bekannt) SQL-Marke innerhalb eines Zeichenkettenliterals
Beleg: ein Datentext mit Zeile `-- DBMANAGER EXPORT COMPLETE` und genau dort abgeschnittener Strom wird akzeptiert (Probe
`it.fails`); vom Autor dokumentiert. Die Marke steht im echten Strom immer nach `COMMIT;`/`SET ...;`-Zeilen. Fix (optional):
Einfachanführungszeichen-Parität außerhalb von `--`-Kommentaren mitzählen (`''` verdoppelt sich, ändert die Parität nicht) und die
Marke nur bei gerader Parität akzeptieren; für MySQL (Backslash-Escapes) ist das nicht exakt, daher alternativ die Zeile davor
(`COMMIT;` oder `SET ...`) verlangen. Bis dahin Dokumentation beibehalten.

### F4 (niedrig) Doppelklick auf "Exportieren": zwei Speicherdialoge möglich
Beleg: `ExportPanel.svelte` `start()` prüft `running`, setzt `phase = 'running'` aber erst nach `await openSink(...)`. Ein zweiter
Klick in dieser Zeit erhöht `generation`, öffnet einen zweiten `showSaveFilePicker` (schlägt in Chromium bei offenem Dialog fehl und
fällt auf die Speicher-Senke zurück) und verwirft die erste Senke. Es entsteht höchstens ein Request, aber der Nutzer kann eine
Dateiauswahl treffen, die verworfen wird. Fix: ein Flag `starting` sofort beim Klick setzen und den Knopf sperren.

### F5 (niedrig) Hinweise, Dateinamen, Doppelungen
- Bei File System Access legt der Browser die gewählte Datei beim Bestätigen des Dialogs bereits (leer) an; `abort()` verwirft die
  Daten (Swap-Datei), die leere Platzhalterdatei kann bleiben. Der Text "wurde nicht gespeichert" ist leicht ungenau; Hinweis ergänzen,
  dass eine leere Datei mit dem gewählten Namen übrig sein kann.
- `safeFilename`: kürzt auf 150 Zeichen und kann die Endung (`.sql.gz`) abschneiden; behandelt reservierte Windows-Namen (`CON.sql`)
  und einen endenden Punkt nicht; Unicode wird zu `_`. Das Backend liefert nur ASCII bis 120 Zeichen, die Wirkung ist gering. Pfadtraversal
  (`../`, `%2F`, Backslash, Laufwerk), Steuerzeichen und Punktnamen werden korrekt auf einen Basisnamen reduziert.
- `src/app.css`: die Zeile `flex-wrap: wrap` im Block `.table-tabs, .workspace-tabs` ist ein Duplikat der bereits auf main stehenden
  Regel in `.workspace-tabs` (W-P07) und ändert zusätzlich `.table-tabs`. Zeile entfernen (Merge-Duplikat).
- Fehlermeldung bei abgewiesenem Schreib-SQL im Abfrage-Export ist die allgemeine "Exportoptionen ungültig"; der Grund (nur lesende
  Abfrage) wird nicht genannt (Backend lehnt zuverlässig ab, UI zeigt den Vorbehalt `read_only_best_effort` vorab).

## Prüfung nach Punkten

1. Vertrag: byteidentisch, `contract:check` aktuell, Provenienz im Test geprüft.
2. Schlussmarke (`verify.ts`, `run.ts`), alle mit eigenen Tests in `src/lib/features/export/review.test.ts`:
   - Kürzung an jeder Bytegrenze von SQL, JSON (inkl. mitten in Strings, Escapes, `\u`-Paaren, UTF-8-Surrogatpaaren), CSV und Excel-CSV:
     kein echtes Präfix wird akzeptiert (JSON nur ohne das letzte Zeilenende, dann ist das Dokument vollständig).
   - Vollständige Dokumente sind für jede Zweiteilung und 300 zufällige Mehrfachteilungen je Format vollständig, die Prüfung ist
     chunkunabhängig (Grenzen mitten in UTF-8-Sequenzen und in der Marke).
   - `"complete":true` als Datenwert, ein CSV-Kontrollsatz in einem Anführungsfeld, CRLF-Marke, leere Antwort: korrekt.
   - GZip (Node und echtes Chromium 156): abgeschnitten an jedem Offset, verfälschte Prüfsumme/Nutzbyte, Müll nach dem Member, leere
     Antwort werden nie committet (Chromium: `Compressed input was truncated`, `Junk found after end`, `incorrect data check`); zwei
     Member werden als Fehler gewertet (sicher, das Backend schreibt einen Member); Marke nur im ersten Member reicht nicht.
   - Speichern: `commit` nur nach bestandener Prüfung, sonst `abort()` (Speicher verworfen bzw. Swap-Datei der Writable verworfen);
     Download nur nach Prüfung; nichts landet bei Fehlern im Blob-Link. Abbruch und Zeitwächter stoppen beide Zweige. Lücke: F1, F5.
3. Transport: Token nur im `Authorization`-Header (nicht in URL/Storage; kein Storage im Paket), `credentials: 'omit'`,
   `redirect: 'error'`; späte Antworten nach Token-/Verbindungswechsel werden per Generationszähler verworfen und der laufende Export
   abgebrochen; `export_busy` (503) erhält deutschen Text; kein `{@html}`. Export meldet keine Schreibphasen
   (`onwritephase` wird nicht genutzt), zählt also nicht als Schreibvorgang und sperrt die Navigation nicht; ein Seitenwechsel
   zerstört das Panel und bricht den Export ab. Kein Schutz vor versehentlichem Verlassen der Seite während eines langen Exports
   (bewusst, lesende Aktion).
4. Optionen: `buildRequest` spiegelt Vertrag und Backend (100 Tabellen, 20 Datenbanken, Grenzen für Zeilen, Bytes, Zeit, Dateiname
   per Vertragsmuster, CSV nur eine Tabelle, Server-SQL nur MySQL/MariaDB, FK-Schalter nicht PostgreSQL, Speichergrenze 256 MiB ohne
   File System Access); Validator `ExportRequest` prüft zusätzlich vor dem Senden. Die Datenbankliste des Serverbereichs ist ein
   Textfeld (eine je Zeile, getrimmt, ohne Duplikate); Injektion ist nicht möglich, da nur strukturierte Namen gesendet werden.
   Abfrage-Export sendet die Abfrage unverändert; die Schreibgrenze ist die read-only-Transaktion im Backend (Backend-Review).
5. Echtläufe und MySQL/MariaDB: siehe Tabelle.
6. Doku: ehrlich (nennt die SQL-Lücke, die fehlenden Trailer, MySQL/MariaDB nicht im Weblauf); 320 px und Export-Browserfälle laufen;
   i18n über `exportDump.*` im Katalog (Schlüsseltest grün); `app.css`-Duplikat siehe F5.

## Nicht geprüft
- Kein Browserlauf des Export-Assistenten gegen MySQL/MariaDB (nur API-Ebene plus Restore mit dem Datenbankclient).
- File System Access API im echten Browser nur über die Doppel (Mock) getestet; das Verhalten der Swap-Datei ist aus der Spezifikation
  abgeleitet, nicht gemessen. Firefox/Safari nicht geprüft.
- Keine Messung bei 1 GiB.
