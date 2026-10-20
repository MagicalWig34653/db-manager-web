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
| F3 | Strukturierter Tabellenarbeitsplatz und Quellcode-/Lizenzverweise | Phase A/B beauftragt, `feat/table-workbench`, `.worktrees/table-workbench`, Basis `ec8dcea`; API0.2.0 für Bindung freigegeben | strikte CSP/Sessiongrenzen erhalten, genaue Metadaten/Sortierung/parametrisierte Filter/Pagination und echte Browserfälle gegen reproduzierbar gepinnten öffentlichen Backendcheckout; unabhängige QA und CI vor Integration |

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
