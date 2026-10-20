# Handoff F1b – Standalone-Validierung für strikte CSP

Stand: 20.10.2026. Frontend & UX Engineer (`p1a_parity`), Webrepo,
Branch `feat/web-workbench`, eigener vorhandener Worktree. Begrenzter Folgeauftrag
nach F1-QA-Freigabe: Schema-/Build-/Test-/Dokumentationsänderungen für CSP-Kompatibilität.
Keine Produktfunktion, API-, Credential- oder Sitzungssemantik verändert.

## Anlass und Lösung

Die bisherige Ajv-Schemakompilierung im Browser benötigt `new Function`; eine
sinnvolle CSP des Go-Wrappers mit `script-src 'self'` blockiert dies. Der Lead
hat eine CSP-Aufweichung nicht genehmigt und stattdessen buildzeitliche Validierung
bevorzugt. Offizielle Primärquellen am 20.10.2026 gelesen:
[Ajv Standalone](https://ajv.js.org/standalone.html),
[Ajv Codeoptionen](https://ajv.js.org/options.html#code-v7).

`tests/generate-validators.mjs` generiert mit Ajvs offizieller Standalone-Funktion
alle neun Schemas aus der unveränderten lokalen Vertragskopie als ESM. Vites
Programmatic-Build bündelt den kleinen referenzierten Ajv-Unicode-Längenhelper
in dasselbe Modul; kein Browser-`require`, keine externen Modulimporte und keine
Sourcemaps sind erforderlich. Der Ajv-Compiler wird nicht im Browser initialisiert.
Die API importiert nur fertige Validierungsfunktionen und behält Fehlerschema,
Nichtkonvertierung der Daten und dieselben Request-/Responseprüfungen bei.

Generierte `validators.js` und Typdeklarationen sind eingecheckt.
`validators:check` generiert im ignorierten Cache neu und vergleicht exakte Bytes;
`contract:check` und `build` rufen diese Driftprüfung auf. Der Generator weist
mehrere Chunks, externe Imports und dynamische Evaluation zurück. Das Vorkommen
des Worts `require` in der unbenutzten Ajv-Helper-Code-Metadatenzeichenfolge ist
kein ausgeführter Import. Ajv-/Helperlizenzen bleiben in den bisherigen Notices.
Keine Abhängigkeit oder Lockfileversion geändert.

## Prüfungen und Nachweise

Am 20.10.2026 lokal macOS / Node26.5.0 / npm11.17.0:

| Prüfung | Tatsächliches Ergebnis |
| --- | --- |
| `npm run check` | 0 Fehler / 0 Warnungen |
| `npm test` | 15 Unit-/Komponententests bestanden |
| `npm run contract:check` | APItypes und Standalone-Bytes aktuell; Vertrags-SHA unverändert |
| `npm run test:browser` | 6 bestehende Chromium-Mockfälle bestanden |
| `npm run test:csp` | Produktionsbuild plus eigener strikter CSP-Browserfall bestanden |
| `npm run format:check` | bestanden |
| `python3 scripts/check-docs.py` | 80 Dateien / 0 Fehler |
| `git diff --check` | ohne Befund |

Der zusätzliche Browserfall verwendet den tatsächlichen Produktionsbuild mit
`script-src 'self'`, ohne `unsafe-eval` und ohne Inline-Scripts. Er öffnet den
Zugang-/Verbindungsdialog, führt eine Abfrage gegen synthetische APIantworten aus,
prüft den exakten großen Integer, liefert danach absichtlich einen numerischen
Zellwert statt des vorgeschriebenen Strings und erwartet den Validierungsfehler.
Der Browser meldet null `securitypolicyviolation`-Ereignisse. Stilattribute sind
gezielt für die Dialogdarstellung erlaubt; Inline-Scriptattribute nicht.

JS-Bundle im lokalen Build: 253,50 kB statt zuvor 350,72 kB, jeweils unkomprimiert;
das ist kein Performancebenchmark. Prüfung der generierten Datei auf private Pfade
und dynamische Evaluation ohne Befund. CI erhält einen separaten CSP-Prüfschritt;
dessen GitHub-Lauf ist noch nicht als ausgeführt behauptet.

## Übergabe und Grenzen

F1b erfordert unabhängigen QA-Review, bevor sein veröffentlichter Commit als
F2a-Frontendquelle gepinnt wird. Keine Main-/Go-/Docker-/HTTP-Dateien verändert.
API0.1.0 und SHA `4b598dc69a1904685e67a717997412654440ac10f47c17f7a025ccd114e294be`
bleiben unverändert. Kein echter Backend-/DB-Test oder Gerätesafari-Nachweis;
der CSP-Fall ist Chromium mit Mock-API. Kein geheimer Beispieldatensatz.

Die eigenen Vite-Dev-/Previewserver wurden durch Playwright beendet; Ports 4179
und 4180 haben nach Prüfabschluss keinen eigenen Listener. Keine laufenden Jobs.
Nächster Schritt: QA prüft Clientvalidierung/CSP; danach öffentlicher Commitpin
und reproduzierbarer Assetbuild in F2a. Keine Selbstfreigabe oder Integration.
