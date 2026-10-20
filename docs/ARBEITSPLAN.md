# Arbeitsplan

Stand: 20.10.2026. Lead koordiniert und pflegt zentrale Statusdateien;
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

## Aktueller Auftrag F4 und F3b-Abnahme

F3b ist nach unabhängiger Prüfung im Go-Hauptrepo integriert, zentraler Stand
f46cafe. Alle sechs Feature-CIs erfolgreich; neue kombinierte Main-CIs kontrollieren.
Freigegebene Quelle6c6eb33 bleibt unverändert. Kein Mutationsumfang in diesem Build.

F4 beauftragt: feat/row-workbench, .worktrees/row-workbench, Basisffdd2a0. Besitz
Webprodukt/Vertragskopien/Build/Tests/Lizenzen/README/Einrichtung/Handoff; keine
zentralen Statusdateien. API0.3-SHA ec77c9739cda11df3f4cb9fe756a632e67840fdc0f6190deee1aa1d1333dc308,
API0.4-SHA 4763ebf8632a9ef977cf7d3a6037299fc4dafde0a581fe10cb34d844f8356fbf,
Referenzbackend72855cf57ceb6620dead42856ee6c9d52d0612bd enthält beide v3-Fixes.
V4-Fähigkeiten und passende v3-Eignung sind Schreibgate. Ältere Backendstände behalten
bisherige Funktionen ohne neue Schreibaktionen. Einzelzeilen-Insert/Edit/Delete,
Default/NULL/Leer/Präzision explizit, alte vollständige Snapshots, bestätigte Aktionen,
frische Eignung, 409 verlangt Neuladen; unbekannter Ausgang und Transportfehler nach
Versand bedeuten möglichen Commit, keine automatischen Retries. Quellen-/Tokenwechsel
verwirft Editorwerte; generischer Unknown-Hinweis ohne alte Werte darf bleiben.

Abnahme: echte SQLite-/PG-TLS-Browserfälle für CRUD, konkurrierende Fremdänderung,
Default/Null/AutoPK/Präzision/Unsupported und Tokenwechsel während Request. Realen
Commit mit verlorener Browserantwort prüfen, nur ein Request; keine erfundene
Mock-DB-Antwort. CSP-/Session-/Lizenzregression erhalten. Unabhängige QA vor Webmerge,
Rootartefaktpin F4b als eigenes Folgepaket. Keine Schema-/Export-/Vaultfunktionen.
