# F6 – unabhängiger Exportreview

Prüfung am 23.10.2026, eigener Branch `review/f6`, Worktree `.worktrees/f6-review`.
Quell-/Testkandidat `1e2fbb6ab2e58773a6ae281ffcbe7bf644eb516a`, Gesamtdiff ab
`bf75748`; reiner Autoren-Handoff/Statusnachtrag
`708a3284092b2db3b5b296679d185603ff9cfca8` ebenfalls gelesen.
[Autorenübergabe](F6.md). Keine Produktänderung durch den Reviewer.

## Urteil und offener Befund

Noch keine Integrations-/Quellpinfreigabe: ein enger niedriger Format-/Consumerbefund
**QA-F6-01** ist offen. Keine weiteren bestätigten Findings.

Gezielte temporäre reine Encoderprobe: Text mit NUL U+0000, SOH U+0001, TAB U+0009,
CR/LF, Quote und Literal `\N`; zusätzlich echte NULL-Zelle. JSON-Rücklesen erhält
sämtliche getaggten Werte exakt. Beide CSVvarianten behalten die Steuerbytes
unverändert; Rohvariante enthält tatsächlich 00/01/09 in gequoteten Feldern.
Quotes/CRLF und ungequotetes NULL gegenüber gequotetem Literalmarker sind in den
Dateibytes unterscheidbar. Kein heimliches Ersetzen oder Producerdatenverlust.

[RFC4180 Abschnitt2](https://www.rfc-editor.org/rfc/rfc4180) erlaubt in seiner
ABNF neben TEXTDATA nur Komma, CR/LF und verdoppelte Quotes innerhalb gequoteter
Felder. NUL/SOH/TAB sind darin nicht enthalten. Die bisherige eigene Profilbeschreibung
erläutert NULL/Präfix/UTF8 und allgemeine Quote-/Typverluste, aber nicht diese
zusätzliche Steuerbytegrenze. Ein gewöhnlicher Consumer kann solche Werte ablehnen
oder abweichend verarbeiten; keine konkrete Consumerdatenverlustprobe behauptet.

Vor Annahme entweder diese Zeichen vor CSVdownload ausdrücklich ablehnen, ohne sie
heimlich zu verändern, oder das eigene erweiterte Profil und seine Steuerbyte-/
Consumergrenzen in sichtbarem CSVhinweis und Verhaltensdokumentation präzisieren.
JSON muss weiterhin exakt bleiben. Keine pauschale RFC-/Excel-/Roundtripzusage.
Die gezielte QA-Testdatei wurde nach bestandenem Bytevergleich entfernt.

## Tatsächlich unabhängig bestanden

- Frischer Reviewworktree, `npm ci --no-audit --no-fund`, Typecheck0/0, 34 Units,
  Format, vier OpenAPI-Typ-/Standaloneprüfungen und Produktionsbuild.
- Reine Format-/Whitelist-/Snapshotprüfungen, finale inklusive8MiB-Grenze aller
  drei Formate einschließlich UTF8/Envelope/Präfix/Quotes/CRLF. Übergröße erzeugt
  keine BlobURL. Keine zusätzliche DBabfrage oder Persistenz im Exporthelper.
- Sechs bestehende SQL/Auth/iPad/Sessionfälle und zwei Produktions-CSP-/Quelllink-/
  Originalnoticetests bestanden. Lizenz-/Lockdateien unverändert; ausgelieferte
  Originaltexte bytegleich, keine Maps oder privaten Pfade. Bekannte Chunkwarnung
  bei ungefähr728kB, Build erfolgreich.
- Acht tatsächliche Browserfälle über `python3 scripts/test-real-tables.py`,
  frisch öffentlich gepinntes Go-Backend, SQLite und PostgreSQL verify-full.
  Positive TLSverbindung vor falschem Hostnamen, deterministische TCP-Readiness.
  Tatsächliche Downloadbytes und feste Dateinamen, doppelte Spalten, Int64-/Decimal-
  Präzision, NULL/Leertext/Binary, beide CSVvarianten, Trunkierung und Seite mit
  Offset25/page_size25/has_more geprüft. Downloadklicks erzeugen keine APIanfragen.
- BlobURLs bei nächstem Download/neuem Resultat/Tokenwechsel widerrufen;
  nach bereits beobachtetem Downloadstart sofort Token wechseln, erst anschließend
  gespeicherte Datei lesen: unverändert vollständiges Seiten-JSON. Kein alter
  Downloadbutton, null CSPverletzungen. Browsernachweis gilt für Chromium.
- Sechs unveränderte F4-/F3-Kernfälle einschließlich bestätigter Mutationen,
  Konflikt, echtem Commit vor Antwortverlust und Sitzungswechsel bestanden.

## CI und Ressourcen

Alle drei genannten öffentlichen CIs autoritativ erfolgreich am exakten Quell-SHA:
[Frontend](https://github.com/MagicalWig34653/db-manager-web/actions/runs/39903195022),
[echter Download-/CRUDpfad](https://github.com/MagicalWig34653/db-manager-web/actions/runs/39903194959),
[Dokumentation](https://github.com/MagicalWig34653/db-manager-web/actions/runs/39903194991).

Keine Root-/API0.5-/Dependencyänderung. F6b/Rootartefakt und Deployment benötigen
eigenen Auftrag und Review; keine Mehrbrowser-/Excel-/Gesamttabellenexportfreigabe.
Eigene Prozesse, Fixtures und temporäre QA-Dateien beendet beziehungsweise entfernt;
vier fremde Entwicklungscontainer unverändert. Keine OSrechte geändert.
Reviewdokumentation und eigener Diff geprüft. Nächster Schritt: enger Autorenfix
für QA-F6-01, danach gezielte unabhängige Nachprüfung.
