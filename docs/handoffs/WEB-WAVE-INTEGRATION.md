# Handoff Web-Welle: Integration W-P10, W-P09, W-P14, W-P15, W-P16, W-P18, W-P19, W-P26

Branch `integration/web-wave` (Worktree `.worktrees/web-wave-integration`), Basis Web-`main` `c14271e`. Nicht nach `main` gemergt; kein Pin/Build ins Backend (macht der Lead mit `scripts/build-web.py`).

## Merges (`--no-ff`, in dieser Reihenfolge)

`feat/w-p10-web` (44c336a), `feat/w-p09-web`, `feat/w-p14-web`, `feat/w-p15-web`, `feat/w-p16-web`, `feat/w-p18-web`, `feat/w-p19-web`, `feat/w-p26-web`.

Konflikte und Auflösung:
- `src/lib/i18n/de.ts`: bei jedem Merge nur angehängt (beide Seiten behalten, Reihenfolge maintenance, indexes, search, sqlBatch, sqlEditor, accounts, programs).
- `src/lib/shell/builtin/SqlTab.svelte` (W-P26): beide Importe behalten (`SqlLibraryPanel` aus W-P16 und `formatNumber` aus W-P26).
- Feature-Registry: kein Konflikt (Auto-Discovery per `import.meta.glob`); alle Tab-IDs/Reiter eindeutig.
- Contract-Kopien v6..v16 ohne Konflikt; `table-create.spec.ts` hatte bereits `exact: true`.

## Nachbesserungen

- `src/lib/i18n/en.ts`: englische Texte für maintenance, indexes, search, sqlBatch, sqlEditor, accounts, programs ergänzt (Paritätstest `catalogs.test.ts` grün).
- `src/lib/features/maintenance/model.ts` importierte `$lib/i18n` (Runes-Datei `locale.svelte.ts`) und brach damit Playwright-Specs, die `testing.ts` im Node-Kontext laden ("$state is not defined"). `reasonText` liegt jetzt in `reason.ts`; `model.ts` ist i18n-frei.
- Neue Browser-Spec `tests/browser/search.spec.ts` (gemocktes Backend, W-P14): Suche (Auswahl, Treffer, feindlicher Zelltext bleibt Text, 320 px ohne Horizontalscroll), Ersetzen (Plan schreibt nichts, Name und Anzahl zur Bestätigung, genau ein Schreibaufruf bei Doppelklick, Sperre danach, 320 px) und Navigationssperre während des Schreibens.

## Verträge

Backend-`main` (3a7e1f1) hat v1..v16. Web-Kopien v1..v16 sind bytegleich (cmp) und SHA-256 stimmt mit jeder `provenance.json` überein. Benötigt: v6..v9, v11..v16, v10 (W-P10). v17..v22 (Backend `integration/wave4-backend`) sind nicht enthalten und werden später gebraucht.

## Prüfstand (auf dem integrierten Branch)

- `npm run check`: 0 Fehler, 0 Warnungen. `npm test`: 53 Dateien, 658 Tests grün. `format:check`, `contract:check`, `validators:check` ok. `npm run build` ok.
- `npm run test:csp`: 2 grün. `test:pwa`: 6 grün (nur mit Portumleitung 4381 inkl. Port-Assertion; Service-Worker-Cache enthält nie `/api`, `/healthz`, `/readyz`).
- Browser-Specs (`tests/browser`): 62 grün (inkl. neuer search.spec.ts), mit temporärer Konfiguration auf Port 4379; Port 4179 (fremder Prozess) wurde nicht angefasst.
- Echtläufe gegen Backend-`main` 3a7e1f1 (`DBM_BACKEND_REPO`): `test-real-indexes.py` (SQLite), `test-real-programs.py` (SQLite), `test-real-search.py` (SQLite), `test-real-sql-batch.py` (SQLite und PostgreSQL 18.6 verify-full): alle grün.
- Schreib-/Navigationssperre: alle Writer (create-table, object-ops, columns, indexes, maintenance, sql-batch, search/replace, accounts, programs) melden Phasen über `onwritephase` (Shell: `databaseWriteReceiver`/`writeReceiver`) in den Zähler `Session.writeCount`; `writeInFlight` sperrt Hash-Navigation, Reiter, Objektliste, `beforeunload`. Per Browser-Specs je Paket geprüft.
- Kein Passwort in Logs/Storage: nur `sql-editor` (Verlauf, standardmäßig aus, Geheimnisse werden abgewiesen) und Einstellungen (Theme/Sprache) nutzen `localStorage`; Kontenpasswort wird nur beim Ausführen gesendet und danach geleert, nie im Plan.

## Offen

- Kein Echtlauf für MySQL/MariaDB (Indizes, Suche, Programme nur SQLite; PostgreSQL nur SQL-Stapel). `tests/real/maintenance.spec.ts` hat kein Skript und wurde nicht ausgeführt.
- Axe-/Screenreader-Prüfung nicht automatisiert; 320 px nur für Pakete mit Spec geprüft (Indizes, Wartung, Programme, Konten, Export, Tabelle anlegen, Suche/Ersetzen). W-P09/W-P15/W-P16/W-P18/W-P19/W-P26 unabhängiges Review der Pakete steht laut jeweiligen Handoffs teils aus.
- Vertragsstände v17..v22 folgen mit Backend-Welle 4.
