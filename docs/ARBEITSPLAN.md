# Arbeitsplan

Stand: 20.10.2026. Lead koordiniert und pflegt zentrale Statusdateien;
Frontend & UX implementiert in eigenen Worktrees, QA prüft unabhängig.

| ID | Auftrag | Status | Abnahme |
| --- | --- | --- | --- |
| P0 | Eigenständiges öffentliches Repo mit Agent-Einstieg/Lizenz/CI | abgeschlossen | saubere Checkouts, öffentliche main und Dokumentations-CI |
| F1 | Svelte/shadcn-svelte-Workbench mit API0.1.0 | nach QA und CI integriert | 15 Unitprüfungen, sechs funktionale Browserfälle, Build/Typ/Vertrag/Lizenzen; Session-/Zeilenzahlfixes geschlossen |
| F1b | CSP-taugliche Standalone-Validatoren | nach QA und CI integriert, Quelle 4e5abee | reproduzierbarer Generator und tatsächlicher strikter Produktions-CSP-Test |
| F2a | Gepinnte Webassets/Go-Webwrapper | im Hauptrepo in Arbeit | saubere öffentliche Quelle, Hash-/Lizenzprovenienz, isoliertes Goembed/Routing |
| F2b | Echte Web→Go→DB-/Containerintegration | nach B1/F2a zu beauftragen | reale Wegwerf-DB, Query-/Cancel-/Fehlerpfad und Compose/Swarm |

Keine weiteren Featureänderungen ohne begrenztes Ticket/Vertragsabstimmung.
F1-Branch `feat/web-workbench`, Worktree `.worktrees/web-workbench`, sauber und ohne
laufende Testserver. F2a besitzt ausschließlich abgestimmte Hauptrepodateien.
Gemeinsame Integration, Zeitgrenze und weitere Paritäts-/Vaultpakete im Hauptplan.
