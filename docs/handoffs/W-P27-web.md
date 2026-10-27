# Handoff W-P27 Web: Monitor, Replikation, Binärlog, Profiling (API 0.20, nur lesend)

Branch `feat/w-p17-27-web`, Basis Web-`main` `f830326`, Backend-`main` `d9463ba`. Status: zur Prüfung, nicht gemergt.

## Ergebnis

- Vertrag: `src/lib/contract/v20/` (bytegleiche Kopie von `contracts/api-v0.20.0.json`, SHA-256
  `83b49461222f4d79690bd645fea12cfe2427d9fb0bddb9bd21a51ce0c34b63b0`, `provenance.json` auf `d9463ba`). Roots in
  `scripts/validator-roots.json` (`20`): `MonitorCapabilities`, `MonitorRequest`, `MonitorResult` (260 KB Validatorcode).
  Precache/dist: 3,65 MiB (Main 3,45 MiB), weit unter der Backend-Grenze von 8 MiB.
- Oberfläche `src/lib/features/monitor/**` als Server-Reiter `monitor` (`#/server/monitor`) mit den Ansichten Messwerte,
  Hinweise (Advisor), Abfrageanalyse, Replikation, Binärlogs (mit Ereignissen je Log), Profiling (EXPLAIN), Engines.
  - Zustände: `state=unavailable` wird nur bei echter Abwesenheit/fehlenden Systemrechten als "Quelle nicht verfügbar" mit
    Grund des Backends dargestellt (nicht als Fehler); Anmeldefehler, Rechtefehler und fehlerhafte Profiling-Anweisung kommen
    vom Backend als HTTP-Fehler und erscheinen als Fehler mit Wiederholen-Knopf, nie als "unavailable" oder leere Liste.
    Fehlende Felder werden als "unbekannt" (–) gezeigt, nie als 0. Leere Replikationsliste trägt den Hinweis, dass sie keine
    gesunde Replikation beweist. `truncated`, `reason`, Quelle, Dauer und Beobachtungsbeginn werden angezeigt.
  - Fähigkeiten: `MonitorCapabilities.drivers` (24 Einträge) wirken als Einschränkung: `unsupported` zeigt Hinweis und sendet
    keine Anfrage (z. B. SQLite: nur Messwerte und Engines), `limited` als Textzeile; `available=false` blockiert alles.
  - Raten: Der Client berechnet Raten aus zwei aufeinanderfolgenden Messungen derselben Ansicht (BigInt-Differenzen); sinkt
    `uptime` oder ein Zähler (Neustart/Reset), werden keine Raten gezeigt, die Reihe beginnt neu. Verlauf als einfaches SVG
    (`Sparkline.svelte`, ohne Bibliothek, 60 Punkte, nur im Speicher, mit `aria-label` und Zahlen als Text).
  - Binärlog: Liste, je Log "Ereignisse" (Position 0 bis 2^53-1 validiert, Log aus der Liste), Seiten per Offset/Limit.
  - Profiling: SQL-Eingabe (max. 16 KiB, Zähler in Bytes), EXPLAIN nur nach ausdrücklichem Klick, kein ANALYZE; Hinweis auf die
    erlaubte einfache SELECT-Form.
  - Advisor-Hinweise: Regel, Messwert, Schwelle, Quelle und Text; Hinweis "heuristisch, keine Diagnose".
  - Identifikatoren (`digest`, `log_name`, `queryid`, `pid`, `server_id`, `version`) werden nie wie Zahlen gruppiert; große
    Zähler behalten alle Stellen. Alle Werte nur als Text.
  - Tabellen: `<caption>`, `scope="col|row"`, scrollbarer Bereich ist tastaturfokussierbar; 320 px ohne Seitenscroll.
- Auto-Refresh nur für Messwerte, Hinweise, Replikation (siehe [W-P17-web](W-P17-web.md) für das Verhalten).
- Texte: `monitor.*` in `de.ts` UND `en.ts` (inklusive Feld- und Quellennamen).

## Prüfstand

Auf dem Branch (Arbeitsbaum committed): `npm run check` 0 Fehler/Warnungen; `npm test` 780 grün (60 Dateien, neu: Poller 10,
Server-Admin 33, Monitor 43); `npm run format:check`, `contract:check`, `validators:check` ok; `npm run build` ok (Precache
3,65 MiB); `npm run test:csp` 2 grün; Browser-Specs mit gemocktem Backend `tests/browser/server-admin.spec.ts` 6 grün
(`DBM_E2E_PORT=4391`, Port 4179 nicht verwendet). Vollständige Browser-Suite (`DBM_E2E_PORT=4391 npx playwright test`): 78 grün.

## Echtlauf

`scripts/test-real-server-admin.py` baut das Backend aus `DBM_BACKEND_REPO`/`DBM_BACKEND_REV` (hier `d9463ba`; prüft SHA-256 der
Verträge v17/v20), startet Vorschau auf freiem Zufallsport und fährt `tests/real/server-admin.spec.ts` für SQLite und, falls
Docker verfügbar ist, nacheinander MySQL 8.4, MariaDB 12.3, PostgreSQL 18.6 über `scripts/dbfix.py` des Backends (TLS
verify-full, eigene CA über `DBM_DB_CA_FILE`). 
Ergebnis (Backend `d9463ba`, macOS arm64, Colima): SQLite, MySQL 8.4, MariaDB 12.3 und PostgreSQL 18.6 je 2/2 Tests grün
(Status/Variablen/Prozesse inkl. unabhängigem Rücklesen von `max_connections` über `/api/v1/query`, self-Markierung, Filter,
Scope; Messwerte mit Raten, Engines, Analyse, Hinweise, Replikation als Daten/leer/erklärt-unavailable ohne Fehler, Binärlogs mit
Ereignissen bei MySQL, EXPLAIN `SELECT 1` und fehlerhafte Anweisung als Fehler). Fixtures danach entfernt (0 Container
mit Label `dbmanager.task=wp1727`). Die Prüfungen auf Netzwerkengines sind bewusst tolerant gegenüber Rechte-/Konfigurationsunterschieden
(Daten, leer oder erklärt nicht verfügbar), aber nie gegenüber Fehlern.

## Offen

- Replikation ist nur gegen Einzelserver (leere Liste) getestet; konfigurierte Replikas, WAL-Receiver, Mehrkanal nicht live
  belegt (wie im Backend-Handoff). Kein pg_stat_statements im Fixture (Analyse zeigt "nicht verfügbar").
- `monitor/engines` und `binary-events` ohne eigene Live-Prüfung des Erfolgsfalls für MariaDB (log_bin standardmäßig aus).
- Kein unabhängiges Review; nur Lesen (E9): keine Replikationssteuerung, kein PURGE, keine Logkonfiguration.
