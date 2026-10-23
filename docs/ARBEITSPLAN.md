# Arbeitsplan

Stand: 23.10.2026. Lead koordiniert; freigegebene Integrationsagents pflegen zugewiesene Statusdateien;
Frontend & UX implementiert in eigenen Worktrees, QA prüft unabhängig.

| ID | Auftrag | Status | Abnahme |
| --- | --- | --- | --- |
| P0 | Eigenständiges öffentliches Repo mit Agent-Einstieg/Lizenz/CI | abgeschlossen | saubere Checkouts, öffentliche main und Dokumentations-CI |
| F1 | Svelte/shadcn-svelte-Workbench mit API0.1.0 | nach QA und CI integriert | 15 Unitprüfungen, sechs funktionale Browserfälle, Build/Typ/Vertrag/Lizenzen; Session-/Zeilenzahlfixes geschlossen |
| F1b | CSP-taugliche Standalone-Validatoren | nach QA und CI integriert, Quelle 4e5abee | reproduzierbarer Generator und tatsächlicher strikter Produktions-CSP-Test |
| F2a | Gepinnte Webassets/Go-Webwrapper | nach unabhängiger QA im Hauptrepo integriert | saubere öffentliche Quelle, Hash-/Lizenzprovenienz, isoliertes Goembed/Routing |
| F2b | Echte Web→Go→DB-/Containerintegration | nach unabhängiger QA im Hauptrepo integriert (`df0b291`/`c7e1a1d`) | echter SQLite-/PostgreSQL-TLS-Browserpfad, beobachteter Abbruch und Compose-/isolierte-Swarm-Persistenz; vier öffentliche CIs erfolgreich |
| F3 | Strukturierter Tabellenarbeitsplatz und Quellcode-/Lizenzverweise | nach unabhängigem Gesamt- und Fixreview integriert (`8ab07fb`), Quelle `6c6eb33` für F3b freigegeben | strikte CSP/Sessiongrenzen erhalten, genaue Metadaten/Sortierung/parametrisierte Filter/Pagination und echte Browserfälle gegen reproduzierbar gepinnten öffentlichen Backendcheckout; unabhängige QA und CI vor Integration |

Keine weiteren Featureänderungen ohne begrenztes Ticket/Vertragsabstimmung.
F1-Branch `feat/web-workbench`, Worktree `.worktrees/web-workbench`, sauber und ohne
laufende Testserver. F3 besitzt Webprodukt/Vertragskopien/Build/Tests/Lizenzen,
README/Einrichtung/Handoff; zentrale Dateien beim Lead. Neuer Root-Webpin folgt
erst nach Webabnahme als getrenntes Integrationspaket F3b.
Gemeinsame Integration, Zeitgrenze und weitere Paritäts-/Vaultpakete im Hauptplan.

API0.2.0 ist ausdrücklich freigegeben: öffentlicher Backendquellstand
`427444d7bcb8e30c9563ded2000ec3d5e19646c4`, Schema-SHA256
`c15a848f01bb779429fd68a2b6eb6bba1575d3e07a4c68e6796cf7840a661838`.
V1 bleibt unverändert; neue Fähigkeiten über `/api/v2/capabilities`. B2a-Findings
unabhängig geschlossen und alle vier nativen Fix-CIs erfolgreich. F3 darf diesen
Stand konsumieren; Mutationskandidat0.3 gehört nicht zum Auftrag.

F3-Abnahme: P0-Erstreview vollständig grün bis QA-F3-01; P3-Nachreview schloss den
atomaren Filter-/Sortzustandsfix unabhängig gegen beide echten Engines. Alle drei
Fix-CIs39500902843/39500903174/39500902856 erfolgreich. Integrierter Typecheck,
19 Units, Dualvertrag und Build bestanden. Originalquelle bleibt in main-Ancestry.
F3b neuer Root-Webpin und TCP-/TLS-Testreadiness nach eigener Hauptrepo-Zuweisung;
keine nachträgliche Veränderung freigegebener Webartefakte. F4-Schreiboberfläche
benötigt eigenen Auftrag und sicheren gepinnten Backendstand.

## F4-Abnahme und F4b-Integration

F4 ist nach unabhängigem P0-Review ohne Findings und drei erfolgreichen exakten
Quell-CIs integriert. Quelle `3a4a3fd0a345f8c127758ac5eadc4e6feb8d21ec` und Review
`01933d5c247dd790748e7733b56e5eea12008d55` bleiben in main-Ancestry.
[Review](handoffs/F4-review.md), [Handoff](handoffs/F4.md).
Neue Web-main-CIs kontrollieren; keine nachträglichen Produktbyteänderungen.

F4b: eigener Hauptrepo-Worktree/Branch. Exakte öffentliche Quelle reproduzieren,
API1–4-/npm-Pins und Originalnotices/Manifest prüfen. Echter eingebetteter Go-Browserpfad
gegen SQLite/PostgreSQL verify-full mit CRUD, Konflikt, Default/NULL/Präzision,
verlorener tatsächlicher Commitantwort und Sitzungswechsel. Compose und eigener
isolierter DinD-Swarm mit tatsächlichem Schreibpfad, SQLite-Neustart-/Taskersatzpersistenz.
Keine DB-/Core-/HTTP-/GoMod-/Vertragsänderung, kein Verbrauch des neuen API0.5-Kandidaten.
Unabhängige QA vor Rootintegration. WebSTATUS/ARBEITSPLAN für dieses Release exklusiv
Frontend & UX zugewiesen; Lead koordiniert ohne Dateischreiben.

## F6 – begrenzter lokaler Ergebnisexport

`feat/result-export` abbf75748, eigener Worktree. Besitz Helper/Komponente/enge Ergebnis-
anbindung/Tests/Doku/Handoff sowie exklusiv WebSTATUS/Plan. JSONversion1 bevorzugt,
CSVroh oder offengelegt präfixiert, unquotedNULL\N versus quotedTextmarker, keine
gewöhnlicheCSV-Roundtrip-/Excel-Sicherheitsgarantie. Tatsächlicher Snapshot ohne
Clientstate/SQL/Token/Profile, nur expliziterDownload,8MiB fertigeBytes vorBlobURL,
saubererURL-/Sessionlebenszyklus. Keine API-/Root-/Apple-/0.5-/Dependencyänderung.
Abnahme: reine Grenz-/Formatprüfungen, echte SQLite-/PG-Downloads mit Inhaltsbeleg,
Umfang/Trunkierung/Seitenstatus und Requestzählung, Source-/Tokenwechsel/CSP, bestehende
CRUDregression, frischeröffentlicherBuild undCI. UnabhängigeQA vorIntegration;
RootpinF6b bleibt separatesPaket. Frist heute23.10.2026 10:00Berlin.

F6-Autorenabschluss:1e2fbb6 öffentlich,34Units/Typecheck/Format/vierVerträge/Build/
Originalnotices sowie8echteDownload-/CRUD-/Pagingbrowserfälle und6LegacySQL-/2CSP-
Browserfälle grün. SaubereröffentlicherBuild bestanden; finaleFrontend-/EchtCIaktiv,
Docsgrün. UnabhängigeQA alsnächstes; keineSelbstintegration oderRootpinänderung.
DateibesitzWebSTATUS/Plan bleibt bisLeadneuzuweisungexklusiv;Workerjetztidle.

F6 gezielter Fix QA-F6-01: rote Regression belegt, CSV-Steuerzeichenprofil ausdrücklich
ablehnen statt ersetzen; JSON unverändert.37Units und8echteBrowserfälle15,9s grün.
Code eingefroren; öffentliche exakte Fix-CIs und unabhängige P0-Nachprüfung sind die
nächsten Gates. Kein API0.5-Verbrauch, kein F5-UIumfang in diesem Fixpaket.

## F6 integriert, F5 als nächstes begrenztes Paket

F6 nach unabhängiger Fixnachprüfung8301b0c und drei grünen exakten CIs integriert;
37Units/Typecheck/vier freigegebeneVerträge, Build/Originalnotices und
Docsprüfungen werden als Kombinationscheck ausgeführt. Neue Main-CIs beobachten.
Kein separates RootpaketF6b: erst nach unabhängigem F5-Review gemeinsames F5b.

F5 erhält neuen eigenen Worktree/Branch ab integriertemF6-Main: unveränderte API0.5-
Kopie/Herkunftac9542d, geordneteIndexterms/Rollen/Flags und Constraints/FK/Checks mit
Coverage/Unknown. ÄlteresBackend behält v2Struktur ohneZusatz. BesitzWebprodukt/
Vertragskopien/Build/Tests/Doku/HandoffF5 und exklusivSTATUS/Plan; keineRoot/Apple/Go-
Dateien, keinDDL. EchteSQLite/PG-TLS-Proben, Unitrepräsentationen für weitereTreiber,
keine pauschaleAllDBbehauptung. LegacyCRUD/F6/Session/CSP erhalten, frischeröffentlicher
Build/CI und unabhängigeQA vorIntegration. Frist heute10Berlin.

Prioritätscheckpoint: F5 jetzt WIP sichern und Slot für Swift/TestFlight freigeben.
Client/Komponente/v5-Kopie vorhanden;41Units grün,2 Testfixturefehler bekannt.
Nach neuer Aktivierung diese korrigieren, dann echte Struktur-/Legacyprüfungen und
unabhängige QA. Keine F5-Freigabe oder gemeinsamer Rootpin vor diesem Gate.
