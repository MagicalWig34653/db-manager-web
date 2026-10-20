# Einrichtung und Prüfungen

Svelte-Workbench für die freigegebene API `0.1.0`. Ein sauberer Checkout benötigt keine
Geschwister-Repositories. Eigener Code ist AGPL-3.0-only; Fremdlizenzen und exakte
Versionen stehen in [LIZENZEN](docs/LIZENZEN.md) und `package-lock.json`.

## Voraussetzungen und Start

Node.js mindestens 22.12, npm mit Lockfile-v3-Unterstützung. Geprüfte lokale Umgebung:
Node 26.5.0 / npm 11.17.0; CI verwendet Node 22 und 24. Einmalig:

```sh
npm ci
npm run dev
```

Die Oberfläche läuft standardmäßig auf `http://127.0.0.1:5173`. Für die API wird dieselbe
Origin verwendet. Entwicklung mit separat gestartetem Backend:

```sh
DB_MANAGER_BACKEND_URL=http://127.0.0.1:8080 npm run dev
```

Diese Variable wird nur von Vites Entwicklungsproxy für `/api` ausgewertet und nicht
in Browsercode eingebettet. Sie enthält keine Zugangsdaten. Das Backend muss separat
laufen und die API-Version `0.1.0` unterstützen; der Frontendstart startet keine Datenbank.
Die Oberfläche meldet unerreichbare Instanzen und nicht angebotene Datenbanktreiber als
solche. Es gibt keine eingebauten Demoergebnisse.

Den Backend-Zugriffstoken in „Backend-Zugang“ eingeben. Er wird ebenso wie Datenbank-
Credentials, SQL und Ergebnisse nur im Arbeitsspeicher gehalten; Reload leert die Sitzung.
Kein localStorage, sessionStorage, Cookie-Login, URL-Token, Service Worker oder Telemetrie.
Bei entfernten Instanzen HTTPS verwenden; der Client verweigert API-Zugriffe auf nicht
verschlüsselten Origins außerhalb von localhost/Loopback. Zugriffstoken/Passwörter gehören
weder in `VITE_*`-Variablen noch in URLs, Konfigurationsdateien oder veröffentlichte Logs.

SQLite verwendet einen vom Backend freigegebenen Datenbanknamen, keinen Dateipfad.
MySQL/MariaDB und PostgreSQL werden nur entsprechend der tatsächlichen Backend-
Treiberliste angeboten. Netzwerkverbindungen senden explizit `tls_mode: verify-full`;
einen Klartextschalter gibt es in diesem Zwischenstand nicht. Clientzertifikate und
private CA-Dateien sind durch API 0.1.0 noch nicht als UI-Optionen verfügbar.

## Bedienung

Verbindung testen/öffnen, Objekte filtern und auswählen, SQL prüfen und explizit ausführen.
Objektauswahl erzeugt nur einen korrekt gequoteten SELECT-Entwurf; Tippen führt kein SQL aus.
`⌘/Strg + K` fokussiert den Editor, `⌘/Strg + Enter` führt aus, `Escape` fordert den Abbruch
an. Zeilenlimit und Zeitlimit werden mitgeschickt. Tabellenwerte bleiben getaggt; Integer,
Dezimalwerte und betroffene Zeilen werden nicht in JavaScript-Zahlen umgewandelt.
NULL, Leertext und Base64-Binärwerte sind unterscheidbar; Klick öffnet den vollständigen
Zellwert. Bei Abbruch ist kein Rollback zugesagt und der Serverstatus bleibt zu prüfen.

## Statischer Build und Vertragsbindung

```sh
npm run build
npm run preview
```

`dist/` ist der eigenständig auslieferbare statische Build für spätere Go-Einbettung.
Der Hostingdienst muss `/api/v1/*` zur API derselben Origin leiten und HTTPS anbieten.
`LICENSE.txt` und `THIRD-PARTY-NOTICES.txt` werden neben den Assets ausgegeben.
Vites Preview ist eine lokale Prüfung, kein Produktionsserver. Compose/Swarm werden im
Hauptrepository umgesetzt; ein Frontendbuild allein belegt keine Deploymentabnahme.

Exakte Vertragkopie: `src/lib/contract/api-v0.1.0.json`, Herkunft und SHA-256 in
`src/lib/contract/provenance.json`; Ausgangscommit `80f203b3e0c7fa3f7f4aa5ec06825cb83bc0c5d0`
im Hauptrepo. Generierung aus lokaler Kopie:

```sh
npm run contract:generate
npm run contract:check
```

Generierte Types sind eingecheckt. `--default-non-nullable false` bewahrt die tatsächlich
optionalen Defaultfelder. Die API-Antworten werden zusätzlich gegen die unveränderten
OpenAPI-Schemas geprüft; ungültige Antworten erzeugen keinen Scheinerfolg. Antwortgröße
ist clientseitig auf 8 MiB begrenzt. Rohe Backendfehlermeldungen werden nicht übernommen,
sondern bekannte Fehlercodes verständlich auf Deutsch dargestellt.

## Prüfungen

```sh
npm run check
npm run contract:check
npm test
npm run build
npx playwright install chromium
npm run test:browser
python3 scripts/check-docs.py
```

Vitest prüft API-Transport, Vertragsbytes, flüchtige Credentialübertragung, Fehler,
Abbruch, Fähigkeiten, NULL/Leertext/Binär/Präzision und Komponenten. Playwright startet
einen eigenen Vite-Server auf Port 4179, verwendet ausschließlich synthetische Mock-API-
Antworten und beendet ihn nach dem Lauf. Browserartefakte liegen unter
`node_modules/.cache/playwright-results`; optionale Screenshots unter `/tmp`.
Der Browserfall bei 768 px prüft responsives Layout, kein reales iPad/Safari.
Echte Backend-/DB-Integration ist separat nach B1 zu prüfen; Mocktests belegen sie nicht.
Unabhängige QA-Abnahme bleibt vor Integration/Release erforderlich.
