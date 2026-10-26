# W-P18 Web: Benutzer und Rechte der Datenbankkonten

Stand: 26.10.2026. Branch `feat/w-p18-web`, Basis Web-main `c14271e` (`git merge main`: aktuell).

## Ergebnis und Dateibesitz

- Vertrag: `src/lib/contract/v15/` ist bytegleich `contracts/api-v0.15.0.json` von Backend-main `3a7e1f1`
  (SHA-256 `cd4681a200045c2fdd5ddf9f1bdc2a356c998b30e640495121925ca8a609dad1`, im Test gepinnt). Der vorläufige
  Entwurf `v16` (Branchstand feat/w-p18-backend, SHA 40d1631c...) wurde ersetzt; alle Pfade `/api/v15/...`,
  Texte "API 0.15". Der Backend-Vertrag 0.16 gehört W-P19 (Programme).
- `src/lib/features/accounts/**`: Client mit Validierung gegen v15 (Plan und Ausführung), Operationszustand,
  `AccountsTab.svelte` (Liste, Details, fünf Geltungsbereiche, Rollen, zwölf Aktionen, Plan, Bestätigung),
  synthetische Fixtures, Unit-/Komponententests. Feature-Slot `server-tab`/`benutzer`.
- `src/lib/shell/Shell.svelte`: Server-Tab-Leiste (Übersicht, Benutzer und Rechte), während Writes gesperrt;
  `onwritephase` an `session.databaseWriteReceiver` angebunden (Schreib- und Navigationssperre).
- `src/lib/i18n/de.ts`: angehängter Block `accounts.*` (nur via `t()`).
- `tests/browser/accounts.spec.ts`: fünf synthetische Browserfälle.

## Sicherheitsverhalten (Abbildung der Backend-Regeln)

- Passwort (`secret`) wird erst nach Plan erfragt, ist nie im Plan-Request, nie in Fixtures/Logs/Speicher;
  beim Senden wird Zustand und das DOM-Feld synchron geleert (`bind:this`, auch das abgehängte Feld), Body-Secret
  wird nach dem Aufruf gelöscht. Nur Eingabefeld `type=password`, `autocomplete=off`.
- Getippte Kontokennung (`<Bytes>:<Name>@<Host>`, aus `plan.confirmation.target_name`) wird bei `plan.destructive`
  verlangt. Das Backend setzt `destructive=true` auch für privilegierte Änderungen (GRANT OPTION, mächtige globale
  Rechte, `role_grant`, privilegierte Kopien); dieselbe UI-Pflicht greift daher ohne eigenes Flag. Der Vertrag
  enthält kein separates Feld `privileged`.
- Selbstaussperr-Zusatzbestätigung bei `plan.self` (auch `root`/`postgres`-Zweitbestätigung, Backend setzt `self`).
- Fehlercode `system_account` (Systemkonten, fest gesperrt) sowie `invalid_account_request` (Namens-/Passwortlimits)
  und `result_too_large` haben eigene deutsche Meldungen (neu in dieser Runde).
- Ausführung höchstens einmal je Plan; nach `outcome_unknown` kein Wiederholen; Ergebnis gesperrt bis neuer Plan.

## Änderungen gegenüber dem abgebrochenen Codex-Stand

v16 -> v15 Vertrag/Pfade/Texte; Provenienz-Test auf Backend-main; Komponententest (`getByRole(..., exact)` war
ungültig) und Passwortfeld-Leerung korrigiert; Browserspecs: Verbinden und danach Routenwechsel/Viewport (der
Verbindungsknopf liegt bei 320 px außerhalb des Viewports); neuer Fehlertext-Test.

## Tatsächliche Prüfungen

- `npm run check` 0/0; `npm test` 33 Dateien / 357 Tests bestanden; `npm run format:check`; `npm run contract:check`.
- `npm run test:browser` (gesamte Suite): 44 bestanden.
- `npm run build` und `npm run test:csp`: siehe Commit-Bericht (bestanden, falls hier nicht anders vermerkt).

## Offene Punkte

- Kein echter Datenbanklauf gegen MySQL/MariaDB/PostgreSQL aus dem Web (Backend hat `scripts/test-accounts.py`
  mit Docker); Web-Specs nutzen synthetische Antworten. Kein `test-real-accounts.py` vorhanden.
- Unabhängiges Sicherheitsreview (laut Plan Pflicht für W-P18) und Integration stehen aus.
- Ob die Zusatz-Bestätigung für `root`/`postgres` im Klartext erklärt werden soll, hängt vom Backend-Warntext ab.
