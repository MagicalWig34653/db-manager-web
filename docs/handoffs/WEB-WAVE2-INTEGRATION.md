# Handoff Web-Welle 2: Integration W-P17..W-P27, W-P28/W-P29, W-P12/W-P13

Branch `integration/web-wave2` (Worktree `.worktrees/web-wave2-integration`), Basis Web-`main` `f830326`. Nicht nach `main` gemergt; kein Pin/Build ins Backend (macht der Lead mit `scripts/build-web.py`). Backend-Bezug: `main` `d9463ba` (Verträge v1..v23).

## Merges (`--no-ff`, in dieser Reihenfolge)

1. `feat/w-p17-27-web` (9c21693): Serveradmin (v17), Überwachung (v20), Gründe (v23). Konfliktfrei.
2. `feat/w-p28-29-web` (de61952): erweiterte Exportformate (v21), Partitionen/Präfix (v22). Konflikte: `playwright.config.ts`, `scripts/validator-roots.json`.
3. `feat/w-p12-13-web` (399b351): Import (v18), Mehrzeilenaktionen/Dateiwerte/FK-Auswahl (v19). Konflikte: `playwright.config.ts`, `playwright.csp.config.ts`, `scripts/validator-roots.json`.

Auflösung:
- Port-Variable vereinheitlicht: `DBM_E2E_PORT` ist die eine Variable; `DBM_TEST_PORT` und `DBM_PW_PORT` bleiben als Aliase (Reihenfolge E2E, TEST, PW). Standard weiter 4179 (`playwright.config.ts`) und 4180 (`playwright.csp.config.ts`). `tests/csp/source.spec.ts` erwartete den festen Ursprung `http://127.0.0.1:4180` und liest jetzt `baseURL`. `playwright.pwa.config.ts` unverändert (`PWA_TEST_PORT`, Standard 4181).
- `validator-roots.json`: Schlüssel 17..23 per Skript zusammengeführt (numerisch sortiert), Prettier-formatiert; `validators:check` bestätigt.
- Ohne Konflikt, aber geprüft: `de.ts`/`en.ts` (Paritätstest grün), Feature-Registry (Auto-Discovery, Registry-Test grün, Tab-IDs eindeutig), `RowWorkspace.svelte`/`ResultTable.svelte` (nur W-P13 berührt), `scripts/real_wave4.py` (W-P17/W-P27, eigener Helfer) neben den `test-real-*.py` (W-P12/13/28/29 nutzen `test-real-tables.py`-Helfer); beide Gruppen laufen unverändert.
- Export: Zwei getrennte Wege, beide funktionsfähig. W-P28 erweitert das Server-Exportfeature (`src/lib/features/export/`, `/api/v21/export`). W-P13 fügt den Umfang `table_selection` im clientseitigen Ergebnis-Snapshot hinzu (`src/lib/export.ts`, `ExportControls.svelte`, aus der Zeilenauswahl der Tabellenansicht). Sie teilen keinen Code; die Auswahl-Export-Spec (`bulk.spec.ts`) und die erweiterten Export-Specs sind auf dem integrierten Stand grün.

## Verträge

Kopien v2..v23 (`src/lib/contract/vN/api-vX.json`) sind bytegleich (`cmp`) zu `contracts/api-v0.N.0.json` aus Backend `d9463ba`; SHA-256 stimmt mit jeder `provenance.json` überein (v17..v23 geprüft). v1 liegt nicht unter `src/lib/contract`. `contract:check` und `validators:check` grün.

## Precache-Größe

Messung nach `npm run build`: Summe aller `dist`-Dateien außer `sw.js` = 4 502 002 Byte (4,29 MiB, 49 Dateien, davon 39 unter `assets/`). Backend-Grenzen: 8 MiB Precache (Rest 3,7 MiB), `MAX_CHUNKS` 64 (Rest 25). Vorher f830326: 3,6 MB.

## Prüfstand (auf dem integrierten Branch)

- `npm run check`: 0 Fehler, 0 Warnungen. `npm test`: 71 Dateien, 934 Tests grün. `format:check`, `contract:check`, `validators:check`, `scripts/check-docs.py` (0 Fehler) ok. `npm run build` ok.
- `playwright test` (dev-Server, `DBM_E2E_PORT=4391`): 106 grün. `test:csp` (`DBM_E2E_PORT=4392`): 2 grün. `test:pwa` (Standard 4181): 6 grün. Port 4179 wurde nicht angefasst, keine fremden Prozesse beendet.
- Echtläufe gegen Backend `d9463ba` (`DBM_BACKEND_REPO`, `DBM_BACKEND_REV=d9463ba`): `test-real-import.py` (SQLite und PostgreSQL 18.6 TLS, 6 Tests), `test-real-export-formats.py` (SQLite, PostgreSQL, 2), `test-real-partitions.py` (SQLite, PostgreSQL, 4), `test-real-server-admin.py` (SQLite, MySQL, MariaDB, PostgreSQL, je 2): alle grün, Container/Prozesse/Checkouts entfernt.
- i18n de/en: Paritätstest `catalogs.test.ts` grün (Schlüsselgleichheit).
- Schreibsperre: Alle Features erhalten über die Shell `onwritephase` (`databaseWriteReceiver`, Tabellen über `writeReceiver`) in `Session.writeCount`. Import (`ImportPanel`), Mehrzeilenaktionen (`BulkDialog`), Dateiwerte (`FileValuePanel`), Partitionen/Präfix (`StructureCard`, `PrefixTab`) melden `sending`/`settled`/`unknown`. Navigationssperre per Browser-Spec belegt für Import (`import.spec.ts`), Bulk (`bulk.spec.ts` "a pending bulk request locks navigation") und Partitionen (`partitions.spec.ts`). Serveradmin und Überwachung sind lesend und melden keine Schreibphase.

## Offen

- Kein Spec für die Sperre beim Dateiwert-Upload (`FileValuePanel`) und bei SQL-Import-Abbruch; der Code meldet die Phasen, die Sperre ist dort nur durch den gemeinsamen Mechanismus abgedeckt.
- Echtläufe der älteren Pakete (`tests/real/*`, z. B. maintenance) und MySQL/MariaDB für Import, Bulk, Export-Formate und Partitionen nicht ausgeführt (Import/Bulk nur SQLite und PostgreSQL; Export-Formate, Partitionen ebenso).
- Die Browser-Specs für Auswahl-Export und erweiterten Export prüfen beide Wege getrennt; eine gemeinsame UI-Verbindung gibt es nicht (siehe Export oben).
- Unabhängiges Review der Pakete und dieser Integration steht aus; Pin/Build und Status-/Plan-Dateien liegen beim Lead.
- Axe-/Screenreader-Prüfung nicht automatisiert.
