# Handoff W-P14 Web: Suche und Ersetzen (API 0.14)

Branch `feat/w-p14-web` (Worktree `.worktrees/w-p14-web`), Basis Web-`main` `c14271e`. Status: zur Prüfung, nicht gemergt.
Kein Pin im Root-Lock; `package.json` und `package-lock.json` unverändert.

## Ergebnis

- Vertrag: `src/lib/contract/v14/` ist eine bytegleiche Kopie von `contracts/api-v0.14.0.json` auf Backend-`main` `3a7e1f1`
  (zuletzt geändert in `d767727`), SHA-256 `b57c3e5dcf403c3e16d8564c68d0220453625b25f6f206fdc128d2e249656c1e`.
  Der Codex-Kandidat (`fda8077...`) war veraltet; Typen und Validatoren neu erzeugt, `provenance.json` aktualisiert.
  Alle 46 Backend-Fixtures (`contracts/fixtures/search`) liegen unter `src/lib/features/search/fixtures` und werden im
  Unit-Test gegen die Validatoren geprüft (positiv und `.invalid.`).
- Datenbankreiter "Suche" (`SearchTab.svelte`, nur lesend: Tabellen und Textspalten wählen, Modi laut Fähigkeit,
  gemeinsames Trefferbudget, Vorschau mit Markierung, Abbruch) und Tabellenreiter "Ersetzen" (`ReplaceTab.svelte`):
  Plan (`PlanPreview`, Beispiele vorher/nachher), Bestätigung mit Tabellenname und Zeilenzahl plus Häkchen, genau ein
  Versand, Sperre nach dem Ergebnis, unbekannter Ausgang mit Warnung, Schreibphase meldet `onwritephase`.
  `ConfirmDestructiveDialog` wird nicht genutzt, weil der Vertrag zwei Bestätigungswerte (Name und Anzahl) verlangt.
- Texte: `search.*` an `de.ts` angehängt.

## Änderungen in diesem Lauf (nach abgebrochenem Codex-Lauf)

- Vertrag auf den endgültigen Stand gebracht (siehe oben), Fixture-Anzahl im Test angepasst.
- Dynamische Textschlüssel (`'search.mode_' + x`) ersetzt durch `modeLabel`, `outcomeLabel`, `reasonLabel` in `model.ts`
  (der Schlüsseltest `keys.test.ts` verlangt Literale; `outcome_unknown` zeigt `search.unknown`).
- Typfehler behoben (`column` nullable beim Planen, Testmock der Objektliste, `exact` bei testing-library).
- Neu: `tests/real/search.spec.ts` und `scripts/test-real-search.py` (SQLite-Wegwerfdatenbank, echtes Go-Backend).

## Prüfungen

`contract:check`, `format:check`, `check` (0 Fehler), `npm test` 325 von 325, `npm run build`, `check-docs.py` 0 Fehler,
`test:browser` 39 von 39 (Playwright-Kopie, Port 4292),
`DBM_BACKEND_REPO=<Backend> DBM_BACKEND_REV=3a7e1f1 python3 scripts/test-real-search.py` 2 von 2 Läufen grün
(SQLite: datenbankweite Suche, Plan ohne Schreiben, Ersetzen mit Bestätigung, ein Versand bei Doppelklick,
unabhängiges Zurücklesen über API 0.1).

## Offen

- Kein Browser-Spec mit Mocks für Suche/Ersetzen (Komponententests vorhanden); kein 320-px-Test.
- PostgreSQL, MySQL/MariaDB und Regex nur über Fixtures, kein echter Lauf.
- Kein Pin, kein Build über `scripts/build-web.py` (Lead).
