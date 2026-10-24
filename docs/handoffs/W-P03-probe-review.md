# Review PWA-Fix: Probe-Body (`fix/w-p03-probe-body` 7d14c80, Basis main 6cb9613)

**Urteil: Freigabe.**

- Ursache getroffen: `register.ts` las den Body von `/healthz` nie, die Anfrage blieb offen und verhinderte `networkidle`.
- Fix `src/lib/pwa/probe.ts`: `serverReachable()` verwirft den Body (`response.body?.cancel()`, Fehler ignoriert), jeder
  HTTP-Status zählt als erreichbar, Netzwerkfehler/Timeout (5 s per `AbortController`) als nicht erreichbar, Timer wird im
  `finally` freigegeben. Keine neue Abhängigkeit; `cache: 'no-store'`, `credentials: 'omit'` bleiben; kein Token wird gesendet.
- Sicherheit: kein Inhalt der Antwort wird ausgewertet oder angezeigt; kein Caching der Anfrage; Service-Worker-Verhalten
  unverändert (SW-Fetches reichen Antworten durch bzw. lesen sie für `cache.put`).
- Tests: `probe.test.ts` (200/401/503, fehlender Body, fehlschlagendes `cancel`, Netzwerkfehler, Timeout); Browserfall mit
  endlosem `/healthz`-Body in `tests/pwa` (Stub), belegt Regression. Auf dem Probemerge: `test:pwa` 6 bestanden und
  `tests/real/export.spec.ts` über `test-real-tables.py` grün (10 bestanden).
- Kleinigkeit (niedrig): `AbortController.abort()` nach Antwort ist unkritisch; ein hängender Body nach dem Timeout wird durch
  `cancel` freigegeben, nicht durch den Timer. Kein Befund.
- Probemerge mit W-P05 und W-P06-web konfliktfrei; alle Läufe siehe `W-P06-web-review.md` (Abschnitt Probemerge).
