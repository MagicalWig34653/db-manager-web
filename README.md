# db-manager-web

Svelte/shadcn-svelte-Weboberfläche. Eigener Projektcode: **AGPL-3.0-only**.

Deutscher SQL-Arbeitsplatz mit flüchtigen Verbindungen, Objektnavigation, expliziter
SQL-Ausführung und typisierten Ergebnissen. Ein separat versionierter freigegebener Stand wird im
Go-Server eingebettet; das Hauptprojekt prüft den echten SQLite-/PostgreSQL-Pfad.
Der freigegebene Tabellenarbeitsplatz bietet Daten/Struktur, Pagination, Sortierung
und getaggte UND-Filter über API0.2.0. F4 ergänzt als noch nicht abgenommenen
Prüfkandidaten einen bestätigten Einzelzeileneditor für geeignete Tabellen über
API0.3/0.4. Konflikte erfordern erneutes Laden; verlorene Schreibantworten können
bereits gespeicherte Änderungen bedeuten. Keine vollständige Administrationsparität;
Prüfstand siehe [F4](docs/handoffs/F4.md).

„Quellcode & Lizenzen“ im Arbeitsplatz führt zu Webquelle, Serverprojekt und originalen
Lizenztexten. Produktionsbuilds verwenden einen festen Quellcommit; Produktänderungen
vor `npm run build` committen. Gemeinsame Anforderungen und Verträge liegen im
[Hauptprojekt](https://github.com/MagicalWig34653/db-manager).

- [Agent-Einstieg](AGENTS.md), [Claude Code](CLAUDE.md)
- [Status](docs/STATUS.md), [Arbeitsplan](docs/ARBEITSPLAN.md)
- [Einrichtung](EINRICHTUNG.md), [Lizenz](LICENSE)
