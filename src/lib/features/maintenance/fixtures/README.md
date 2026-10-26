<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Wartungsfixtures

Unveränderte JSON-Kopien aus `contracts/fixtures/maintenance/` des Backendrepos,
API 0.10.0, 25.10.2026. `*-placeholder.json` sind synthetische Beispiele;
`real-*` stammen laut Backend-Integrationshandoff aus dessen Wegwerf-Engine-Läufen
(SQLite, MySQL, MariaDB, PostgreSQL). Das sind keine eigenen Web-Echtlaufnachweise.
`*.invalid.json` müssen die generierten Validatoren ablehnen.

`maintenance.test.ts` prüft jede JSON-Datei anhand des Schemanamens im Dateinamen.
