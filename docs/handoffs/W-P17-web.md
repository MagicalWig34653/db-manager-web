# Handoff W-P17 Web: Serverstatus, Variablen, Prozesse (API 0.17, nur lesend)

Branch `feat/w-p17-27-web` (Worktree `.worktrees/w-p17-27-web`), Basis Web-`main` `f830326`. Status: zur Prüfung, nicht gemergt.
Backend: Root-`main` `d9463ba` (Verträge v1..v23). Gemeinsamer Branch mit W-P27 ([W-P27-web](W-P27-web.md)).

## Ergebnis

- Vertrag: `src/lib/contract/v17/` (bytegleiche Kopie von `contracts/api-v0.17.0.json` aus Backend-`d9463ba`, SHA-256
  `ec2f75e2159f06fcc841c19089ba82fa9e58b998f55dfc27efcabed6771b39f3`, `provenance.json`); Typen und schlanke Validatoren per
  `contract:generate`. `scripts/validator-roots.json`, Eintrag `17`: `ServerAdminCapabilities`, `ServerAdminReadRequest`,
  `ServerAdminReadResult` (87 KB Validatorcode statt >1 MB bei vollem Export).
- Oberfläche `src/lib/features/server-admin/**` als Server-Reiter `serververwaltung` (`#/server/serververwaltung`) mit den
  Bereichen Status, Variablen, Prozesse (WAI-ARIA-Tabs mit Pfeiltasten/Home/End, `SubTabs.svelte`).
  - Nur lesend: keine Route, kein Button und kein Text für SET/KILL/FLUSH; ein Hinweis nennt das ausdrücklich.
  - Serverseitiger Namens-/Benutzerfilter (max. 128 UTF-8-Bytes, clientseitig geprüft), Seitengröße 50/100/200, Blättern per
    `offset`/`has_more` ohne Gesamtzahl; Hinweis, dass wechselnde Listen kein Schnappschuss sind.
  - Variablen: Geltungsbereich SESSION/GLOBAL (PostgreSQL nur SESSION, GLOBAL würde 422 liefern); `masked=true` wird als Marke
    "maskiert" gezeigt (nie als Wert), mit Erklärung; nicht numerische/unklassifizierte Werte bleiben so verborgen.
  - Prozesse: Eigene Verbindung (`self`) gekennzeichnet (Badge und fett); Sichtbarkeitshinweis (MySQL ohne PROCESS-Recht nur
    eigene Sitzungen, PostgreSQL schränkt Metadaten ein, keine SQL-Texte/Hosts); Laufzeit mit Tooltip "d h min s".
  - Zählerwerte bleiben Strings und werden per BigInt gruppiert (keine Rundung über 2^53).
  - Fähigkeiten: pro Treiber `supported/limited/unsupported` mit Grund; `unsupported` sendet keine Anfrage.
  - Fehler: Antworten die Schema oder Anfrage-Konsistenz (kind/driver/offset/limit, masked-ohne-Wert) verletzen, werden als
    `invalid_response` abgewiesen. 401/422/408/Netz erscheinen als Fehler mit lokalisierter Meldung (Treibertext wird nie
    angezeigt); eine fehlende API (404) wird als "nicht angeboten" erklärt.
  - Hostile Werte (Namen, Benutzer) nur als Text (`{@html}` wird nirgends verwendet).
- Gemeinsame Bausteine (auch von W-P27 genutzt): `src/lib/resource.svelte.ts` (Kopie des Overview-Resource-Musters mit Abbruch
  und Retry bei `database_busy`), `src/lib/poller.ts` + `components/shared/AutoRefresh.svelte` (Auto-Refresh, siehe unten),
  `components/shared/SubTabs.svelte`, `src/lib/format.ts` (Dezimalstring-Gruppierung, Zeitstempel).
- Auto-Refresh: nur auf Wunsch (Schalter, Standard aus, nicht gespeichert), Intervalle 10/30/60 s. Nächster Lauf wird erst nach
  Ende des vorigen eingeplant (kein Request-Stau), exponentieller Backoff nach Fehlern (max. 5 Minuten, Stopp nach 5 Fehlern),
  sofortiger Stopp bei `unauthorized`, `invalid_*`, `unsupported_*`, `not_found`, `invalid_response`; im Hintergrund
  (`visibilitychange`) wird pausiert und der laufende Request abgebrochen, bei Rückkehr sofort neu geladen; Abbruch beim
  Verlassen/Verbindungswechsel.
- Texte: `serverAdmin.*`, `autoRefresh.*` in `de.ts` UND `en.ts` (Katalogtest prüft Schlüsselgleichheit).
- `playwright.config.ts`: Port über `DBM_E2E_PORT` überschreibbar (Standard weiter 4179).

## Prüfstand

Siehe [W-P27-web](W-P27-web.md) (gemeinsame Läufe): `npm test` 780 grün (60 Dateien), `npm run check` 0 Fehler,
`format:check`, `contract:check`, `validators:check`, `build`, `test:csp` ok; Browser-Specs `tests/browser/server-admin.spec.ts`
(6, gemocktes Backend, davon 3 für W-P17, 320 px) grün. Unit: `client.test.ts` (Fixtures aus dem Backend gegen die Validatoren,
Anfragekörper, Fehlerabbildung, Konsistenzprüfung), `components.test.ts` (Maskierung, self, Paging, Filter, Scope, Fehler,
Auto-Refresh).

## Offen

- Echtlauf: siehe W-P27-web (gemeinsames Skript `scripts/test-real-server-admin.py`).
- Kein unabhängiges Review. Kein ADR (keine neue Architekturentscheidung außer den geteilten Bausteinen oben).
- Stufe 2 (SET/KILL/FLUSH) bleibt Backend-seitig ausgeschlossen (eigener Vertrag nötig).
- `Resource` existiert nun zweimal (Overview und `src/lib/resource.svelte.ts`); Zusammenführung wäre ein Folgepaket.
