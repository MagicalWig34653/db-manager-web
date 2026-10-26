# Handoff W-P15 Web: SQL-Stapel, EXPLAIN, DML-Simulation (API 0.12)

Branch `feat/w-p15-web` (Worktree `.worktrees/w-p15-web`), Basis Web-`main` `c14271e`. Status: zur Prüfung, nicht gemergt.
Kein Pin im Root-Lock; `package.json` und `package-lock.json` unverändert.

## Ergebnis

- Vertrag: `src/lib/contract/v12/` ist eine bytegleiche Kopie von `contracts/api-v0.12.0.json` auf Backend-`main` `3a7e1f1`
  (zuletzt geändert in `c562a61`), SHA-256 `7f0446edccdc368a202e4eaae5689d4b44d641e34bdf77ec8314de9f3e3f2dcd`.
  `provenance.json` neu angelegt (fehlte). Die 23 Backend-Fixtures (`contracts/fixtures/sqlbatch`) sind identisch
  vorhanden und werden im Unit-Test geprüft.
- Reiter "SQL-Stapel" auf Datenbank- und Tabellenebene (`src/lib/features/sql-batch/**`): Stapel mit Stop/Fortfahren,
  eigener Trenner und DELIMITER-Hilfe, EXPLAIN, DML-Simulation (nur SQLite, sonst begründet gesperrt), zwei getrennte
  Zustimmungen vor jedem Aufruf, genau ein Versand, Navigations- und beforeunload-Sperre während des Laufs,
  unbekannter Ausgang ohne Wiederholung, Ergebnis je Statement.
- Texte: `sqlBatch.*` an `de.ts` angehängt.

## Änderungen in diesem Lauf (nach abgebrochenem Codex-Lauf)

- Vertragsherkunft dokumentiert (Dateien waren bereits bytegleich zu Backend-main).
- Browser-Spec: 320-px-Viewport erst nach dem Öffnen gesetzt; Aktionsauswahl über `combobox` statt `getByLabel exact`
  (das Label umschließt die Optionen). Gleiche Korrektur im Real-Spec, dort außerdem PostgreSQL-Schaltfläche ohne `exact`.
- `tests/browser/table-create.spec.ts`: Selektor `SQL` auf `exact: true`, weil der neue Reiter "SQL-Stapel" sonst
  kollidiert (bei Integration mit W-P15 nötig).
- Neu: `scripts/test-real-sql-batch.py` (SQLite und PostgreSQL 18.6 verify-full, echtes Go-Backend).

## Prüfungen

`contract:check`, `format:check`, `check` (0 Fehler), `npm test` 373 von 373, `npm run build`, `check-docs.py` 0 Fehler,
`test:browser` 42 von 42 (Playwright-Kopie, Port 4293),
`DBM_BACKEND_REPO=<Backend> DBM_BACKEND_REV=3a7e1f1 python3 scripts/test-real-sql-batch.py` 3 von 3 Fällen grün
(SQLite und PostgreSQL: Stop/Fortfahren mit unabhängigem Zählen, EXPLAIN, SQLite-Simulation mit Rollback einschließlich
Trigger-Schreibzugriffen, 422-Hilfe und DELIMITER-Trigger; PostgreSQL-Simulation als nicht unterstützt gesperrt).

## Offen

- MySQL/MariaDB nur über Fixtures, kein echter Lauf.
- Kein Pin, kein Build über `scripts/build-web.py` (Lead).
