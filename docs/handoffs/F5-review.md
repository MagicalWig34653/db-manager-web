# Unabhängiger Review F5

Stand: 23.10.2026. Reviewer ist nicht F5-Autor. Eigener Worktree
`.worktrees/f5-review`, Branch `review/f5`. Geprüfter eingefrorener Quell-/Teststand
`87751cceed47332f2164f2c3c584ddcd0ef2edd8`, zusätzlicher reiner Autorenhandoff
`6d8aa5ed7aa1db12461e8ca80031c8a3a3df481f`. Produktbytes seit `f407e5b`
unverändert; der spätere CDP-Beobachtungsfix ändert nur Test und Dokumentation.
Keine Produktdatei vom Reviewer geändert.

## Urteil des Erstreviews

Ein bestätigter **niedriger Darstellungsbefund QA-F5-01** ist offen. Vor der
Quellfreigabe ist eine gezielte Korrektur/Nachprüfung vorgesehen. Alle anderen
hier geprüften Kriterien bestanden; kein bestätigter Datenintegritäts- oder
Sicherheitsbefund. Keine Root-Einbettungs-, AllDB-Browser-, DDL- oder
Gesamtparitätsfreigabe aus diesem Review.

## QA-F5-01 – bekannte leere Spaltennamen werden unsichtbar

Echte eigene SQLite-Probe über den tatsächlichen gepinnten Go-Server:

```sql
CREATE TABLE review_empty_identifier ("" TEXT PRIMARY KEY NOT NULL)
```

`POST /api/v5/tables/structure` für diese Tabelle meldet tatsächlich einen
Primärschlüssel mit `columns_known: true` und `columns: [""]`. Der neue
Constraintbereich zeigt bei **Spalten** jedoch ein vollständig leeres `dd`.
Derselbe leere Name wird in den Indexterms ausdrücklich als `""` dargestellt.
Der bestätigte Fall betrifft die Darstellung einer bekannten leeren Identität,
nicht fehlende Serverdaten oder veränderte Datenbankwerte.

Ursache: der neue `names`-Helper verbindet bekannte Werte direkt mit `join`,
ohne einzelne leere Bezeichner sichtbar zu repräsentieren. Die eng erforderliche
Korrektur muss bekannte leere Bezeichner gegenüber unbekannten Angaben und einer
tatsächlich leeren Spaltenliste erhalten. Keine Ausweitung auf alte Oberflächen
ist für diesen Befund nötig. Referenz-/Kollationsnamen dürfen bei einer gezielten
Helperkorrektur ebenfalls konsistent behandelt werden, sind hier aber kein
separat behaupteter Livebefund.

Eine temporäre unabhängige Browserprobe bestätigte echte Servermetadaten,
`columns_known: true`, den leeren `dd` und das Fehlen einer sichtbaren
Leerbezeichnerdarstellung. Sie lief zusammen mit den zehn unveränderten echten
F5-/F6-/CRUD-/Pagingfällen erfolgreich (11/11, 17,9 s); anschließend entfernt.
Das war eine bestätigende Gegenprobe des Fehlers, kein behaupteter grüner
Solltest oder Produktfix durch den Reviewer.

## Unabhängig geprüft und bestanden

- Frischer eigener Reviewworktree und `npm ci --ignore-scripts`; kein zuvor
  laufender F5-Testjob übernommen oder blind neu gestartet.
- `npm run check`: 0 Fehler/0 Warnungen. `npm test`: 46 Tests bestanden.
  `npm run contract:check`: alle fünf Typen-/Standalonebyteprüfungen aktuell.
  `npm run format:check`, `npm run build`, Dokumentation131/0 bestanden.
- Pin/Herkunft von API0.5: Backend
  `ac9542d81e6f096626c24bc1e0cb9bccb3a62a7c`, Schema-SHA256
  `b5225339511d80fe4f52f09118fdad2060d8a92f31d44b73dd89fe9f76178c95`.
  Keine neue Dependency. API1–4-Kopien, npm-Lock, F6-Exporthelper/-komponente und
  CRUDclient/-komponente bytegleich zum integrierten F6-Stand204cb07.
- Quellprüfung: getaggte konservative Zustände/Abdeckung; geordnete Indexterms,
  separate gleichnamige Constrainttypen, kein Ausdrucks-/CHECK-SQL, keine
  erfundene FK-Navigation, zusätzliche Felder und widersprüchliche Angaben
  werden durch den Standalonevalidator abgewiesen. Insgesamt höchstens8192
  Indexterms und eindeutige Positionen je Index, genaue angeforderte
  Tabellen-/Schemaszuordnung. Response-/Requestbytegrenzen aus unverändertem
  ApiClient. Svelte-Textinterpolation, keine HTML-/SQL-Zusammensetzung.
- Lifecycle gelesen: Abbruch/Generation/Unmount verhindern späte Übernahme;
  Tabellenwechsel wird im Elternknoten neu instanziiert, Tokenwechsel löscht
  den vorherigen Arbeitsplatz. Alte v2-Spaltenstruktur bleibt bei v5-Fehlen.
- `python3 scripts/test-real-tables.py`: ursprüngliche zehn echten Fälle in
  18,2 s unabhängig bestanden. Frischer öffentlicher Backendcheckout,
  fünf Schemahashes, native Go-CLI, ausschließlich eigene SQLite- und
  PostgreSQL-TLS-Fixtures. Socket-only-Bootstrapbarriere, anschließende
  endgültige TCP-Readiness, positive verify-full-Verbindung vor
  falscher-Host-Verweigerung tatsächlich ausgeführt.
- UI: echte Partial-/Expression-/DESC-Indexe und FK-Aktionen, PostgreSQL-INCLUDE,
  CHECK und aufgeschobener FK; SQLite-rowid/Hilfsterm und ehrliche CHECK-/
  Aufschiebbarkeitslücke. Reale gehaltene v5-Antwort nach Tokenwechsel zeigt
  keine alten Metadaten. Fehlende Route wird separat und ausdrücklich per404
  simuliert, nicht als echter alter Server ausgegeben. Die korrigierte
  unabhängige Same-origin-Metadatenprobe ersetzt nur CDP-Bodycachebeobachtung;
  fachliche UIassertions bleiben erhalten, keine Mock-DB-Antwort.
- Acht vorhandene F6-Download-/CRUD-/Conflict-/Unknown-/F3-Pagingfälle im selben
  echten Lauf weiter grün. Keine zusätzlichen SQL-/Mutationsrequests durch den
  Strukturpfad. CSP-Verstoßsammler leer.
- `npm run test:browser`: sechs alte Auth-/SQL-/iPadbreiten-/Cancel-/Sessionfälle
  bestanden (7,0 s). `npm run test:csp`: zwei Produktions-CSP-/Source-/
  Originalnotice-/Fokusfälle bestanden (1,3 s).
- Öffentlicher exakter87751cc-Clone ohne Nachbarcheckout: npmci und Build,
  fünf Artefakte, exakter gebauter SourceURL, Original-AGPL und Notices aus
  `src/third-party-notices.txt`, keine Sourcemaps, Git sauber. Ein anfänglicher
  eigener Prüfhelper adressierte die Notice am falschen Rootpfad; nach
  Korrektur wurde der frische Gesamtcheck erneut ausgeführt. Kein Produktfehler
  oder bestandenes Ergebnis aus diesem Fehlversuch abgeleitet.

## Exakte öffentliche CIs

Alle drei am richtigen SHA87751cc unabhängig mit `gh run view` als
`completed/success` bestätigt:

- [Frontend39906977846](https://github.com/MagicalWig34653/db-manager-web/actions/runs/39906977846)
- [Echte Browser39906977849](https://github.com/MagicalWig34653/db-manager-web/actions/runs/39906977849)
- [Dokumentation39906977828](https://github.com/MagicalWig34653/db-manager-web/actions/runs/39906977828)

Der frühere f407-Linux-Lauf39906592949 bleibt historisch fehlgeschlagen; kein
nachträglich umgedeuteter Erfolg. Aktuelle grüne CI ersetzt die offene gezielte
Darstellungskorrektur nicht.

## Grenzen, Ressourcen und nächster Schritt

Echte UIproben ausschließlich SQLite/PostgreSQL; MySQL-/MariaDB-Besonderheiten
nur synthetische Renderer-/Validierungsrepräsentationen, keine Livebrowserabnahme.
Keine atomare oder vollständige Schemasnapshotzusage, kein DDL-/Gerätenachweis.
Bekannte Vite-Chunkwarnung bei etwa958kB JS bleibt als Warnung dokumentiert.

Alle eigenen echten Fixtureläufe sind beendet; zufälliger F5-Container samt Volume,
Server-/Browserprozesse, temporäre Token/Passwörter/Backendclones wurden durch den
Runner entfernt. Dockerlabelabfrage F5 leer. Kein eigener DinD-/Swarm-/weiterer
Heavytest gestartet; fremde Container/Host-Swarm unangetastet. Temporäre eigene
Gegenprobe entfernt. Keine eigenen laufenden Testjobs. Öffentlicher Prüfclone
entfernt. Nur dieser Reviewhandoff wird committed.

Nächster Schritt: Autor korrigiert QA-F5-01 eng mit zunächst roter Regression;
unabhängige enge Nachprüfung und genaue neue CI vor Quellfreigabe. Erst danach
separate Webintegration und Rootpaket F5b(F5+F6) nach Leadfreigabe.
