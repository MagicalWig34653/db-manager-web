# Handoff W-P09 Web: Indizes, Schlüssel, Fremdschlüssel (API 0.13)

Branch `feat/w-p09-web` (Worktree `.worktrees/w-p09-web`), Basis Web-`main` `c14271e`. Status: zur Prüfung, nicht gemergt.
Kein Pin im Root-Lock; `package.json` und `package-lock.json` unverändert.

## Ergebnis

- Vertrag: `src/lib/contract/v13/` ist eine bytegleiche Kopie von `contracts/api-v0.13.0.json` auf Backend-`main` `3a7e1f1`
  (zuletzt geändert in `84f9d7e`), SHA-256 `e05a2402a8e6ec6a1901afeac03969e34d4fa1821e50a5c8675a6e20f5c1d3d7`
  (verglichen, `provenance.json` auf den endgültigen Stand gesetzt). Typen und Validatoren per `contract:generate`.
- Tabellenreiter "Indizes" (`src/lib/features/indexes/**`, Slot `table-tab`, Reiter `indizes`): Bestandsliste aus API 0.5,
  Fähigkeiten aus `GET /api/v13/capabilities`, Aktionen laut Fähigkeit. Plan, Bestätigung, Ausführen mit
  vorhandenen `PlanPreview` und `ConfirmDestructiveDialog` (zerstörend: Tabellenname eintippen), genau ein Versand,
  Schreibsperre während des Schreibens, unbekannter Ausgang sperrt die Ausführung und verweist auf Prüfung der Datenbank.
- Texte: `indexes.*` an `de.ts` angehängt (nur über `t()`).

## Änderungen in diesem Lauf (nach abgebrochenem Codex-Lauf)

- Vertragsherkunft auf Backend-`main` umgestellt; Dateien waren bereits bytegleich.
- `testing.ts`: JSON-Importe mit `with { type: 'json' }` (Playwright konnte das Modul sonst nicht laden).
- Browser-Spec korrigiert: v5-Fähigkeitsmock entsprach nicht dem Vertrag, Katalog/Struktur mit gleichem Schema `main`,
  Viewport 320 px erst nach dem Öffnen, Schaltflächenname "Endgültig ausführen".
- Real-Spec: Tabellenschaltfläche `main.orders`, Schaltflächenname korrigiert, Fehlertext der Hilfsabfrage.
- Neu: `scripts/test-real-indexes.py` (SQLite-Wegwerfdatenbank, echtes Go-Backend).
- Prettier auf die neuen Dateien angewendet.

## Prüfungen

`contract:check`, `format:check`, `check` (0 Fehler), `npm test` 354 von 354, `npm run build`, `check-docs.py` 0 Fehler,
`test:browser` (Playwright-Kopie auf Port 4291) 42 von 42 bei vorherigem Lauf mit 39, danach alle drei Index-Specs grün,
`DBM_BACKEND_REPO=<Backend> DBM_BACKEND_REV=3a7e1f1 python3 scripts/test-real-indexes.py` 3 von 3 Läufen grün
(SQLite: Index anlegen und per Namensbestätigung entfernen, Katalog unabhängig über API 0.1 gelesen, Zeilenzahl unverändert).

## Offen

- PostgreSQL und MySQL nur über Mock/Fixture geprüft, kein echter Lauf (Skript ist SQLite-only).
- Primär-/Fremdschlüsselpfade der Oberfläche nur mit Mocks, SQLite unterstützt sie nicht.
- Kein Pin, kein Build über `scripts/build-web.py` (Lead).
