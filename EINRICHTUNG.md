# Einrichtung und Prüfungen

Svelte-Workbench für die freigegebenen APIs `0.1.0` (SQL) und `0.2.0` (Tabellen). Ein sauberer Checkout benötigt keine
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

Diese Variable wird nur von Vites Entwicklungs-/Previewproxy für `/api` ausgewertet und nicht
in Browsercode eingebettet. Sie enthält keine Zugangsdaten. Das Backend muss separat
laufen und die API-Version `0.1.0` sowie für die Tabellenansicht `0.2.0` unterstützen; der Frontendstart startet keine Datenbank.
Die Oberfläche meldet unerreichbare Instanzen und nicht angebotene Datenbanktreiber als
solche. Es gibt keine eingebauten Demoergebnisse.

Den Backend-Zugriffstoken in „Backend-Zugang“ eingeben. Er wird ebenso wie Datenbank-
Credentials, SQL und Ergebnisse nur im Arbeitsspeicher gehalten; Reload leert die Sitzung.
Ein geänderter Zugriffstoken eröffnet einen neuen Sitzungskontext: Verbindung, Catalog,
SQL, Ergebnisse und laufende Anfragen werden vor Übernahme des neuen Tokens abgeräumt.
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

Verbindung testen/öffnen und Objekt auswählen: „Tabelle“ zeigt Daten und Struktur über
strukturierte Backendanfragen, ohne SQL im Browser zusammenzubauen. Seiten werden ohne
COUNT-Gesamtzahl angezeigt. Mehrspaltensortierung und UND-Filter verwenden ausschließlich
vorhandene Metadatenspalten. NULL-Bedingungen sind getrennt von getaggten Werten;
Dezimalwerte bleiben Strings mit Dezimalpunkt, Binärfilter erwarten Base64. „Anwenden“
übernimmt Änderungen ausdrücklich und startet auf der ersten Seite. Während unübernommener
Änderungen ist die Seitennavigation gesperrt. Fehlende PK-/stabile Reihenfolge werden
angezeigt; auch eindeutige Sortierung ist kein Snapshot bei parallelen DB-Änderungen.
Diese Tabellenansicht verändert keine Zeilen. „Struktur“ zeigt PK-Position, NULL, Default,
Generated-/Read-only-Metadaten; unbekannte Angaben bleiben unbekannt.

„SQL“ öffnet den freien Editor. Tippen führt kein SQL aus; Ausführung nur ausdrücklich.
`⌘/Strg + K` fokussiert den Editor, `⌘/Strg + Enter` führt aus, `Escape` fordert den Abbruch
an. Zeilenlimit und Zeitlimit werden mitgeschickt. Tabellenwerte bleiben getaggt; Integer,
Dezimalwerte und betroffene Zeilen werden nicht in JavaScript-Zahlen umgewandelt.
Eine nicht gemeldete Anzahl betroffener Zeilen wird als unbekannt angezeigt, nicht als null.
NULL, Leertext und Base64-Binärwerte sind unterscheidbar; Klick öffnet den vollständigen
Zellwert. Bei Abbruch ist kein Rollback zugesagt und der Serverstatus bleibt zu prüfen.

## Statischer Build und Vertragsbindung

```sh
npm run build
npm run preview
```

`dist/` ist der eigenständig auslieferbare statische Build für spätere Go-Einbettung.
Der Hostingdienst muss `/api/v1/*` und `/api/v2/*` zur API derselben Origin leiten und HTTPS anbieten.
`LICENSE.txt` und `THIRD-PARTY-NOTICES.txt` werden neben den Assets ausgegeben.
Vites Preview ist eine lokale Prüfung, kein Produktionsserver. Compose/Swarm werden im
Hauptrepository umgesetzt; ein Frontendbuild allein belegt keine Deploymentabnahme.

Exakte Vertragkopie: `src/lib/contract/api-v0.1.0.json`, Herkunft und SHA-256 in
`src/lib/contract/provenance.json`; Ausgangscommit `80f203b3e0c7fa3f7f4aa5ec06825cb83bc0c5d0`
im Hauptrepo. Generierung aus lokaler Kopie:

```sh
npm run contract:generate
npm run contract:check
npm run validators:check
```

Generierte Types sind eingecheckt. `--default-non-nullable false` bewahrt die tatsächlich
optionalen Defaultfelder. Validierungsfunktionen werden nach der [offiziellen Ajv-Standalone-Anleitung](https://ajv.js.org/standalone.html)
bereits beim Entwickeln/Build aus der unveränderten Spezifikation generiert und als
selbstständiges ESM-Modul eingecheckt. Der Browser importiert fertige Funktionen,
keinen Schemacompiler; `eval` oder `new Function` sind zur Laufzeit nicht erforderlich.
Der kleine Ajv-Unicodehelper wird beim Generieren mit Vite eingebündelt, ohne externe
Imports oder Sourcemaps. `npm run validators:check` prüft deterministisch alle generierten
Bytes; auch der Build führt diese Driftprüfung aus. Die API-Antworten werden gegen
die unveränderten OpenAPI-Schemas geprüft; ungültige Antworten erzeugen keinen Scheinerfolg. Antwortgröße
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
npm run test:csp
python3 scripts/check-docs.py
```

Vitest prüft API-Transport, Vertragsbytes, flüchtige Credentialübertragung, Fehler,
Abbruch, Fähigkeiten, NULL/Leertext/Binär/Präzision und Komponenten. Playwright startet
einen eigenen Vite-Server auf Port 4179, verwendet ausschließlich synthetische Mock-API-
Antworten und beendet ihn nach dem Lauf. Browserartefakte liegen unter
`node_modules/.cache/playwright-results`; optionale Screenshots unter `/tmp`.
Der Browserfall bei 768 px prüft responsives Layout, kein reales iPad/Safari.
Ein zusätzlicher Chromiumfall prüft den Produktionsbuild auf Port 4180 mit einer
Content-Security-Policy ohne Inline-Scripts und ohne `unsafe-eval`: gültige Antwort
wird gerendert, ungültige Antwort abgelehnt, keine CSP-Verletzung registriert.
Inline-Stilattribute bleiben für Dialogpositionierung zulässig; die CSP erlaubt keine
Inline-Scriptattribute.
Echte Backend-/DB-Integration ist separat nach B1 zu prüfen; Mocktests belegen sie nicht.
Unabhängige QA-Abnahme bleibt vor Integration/Release erforderlich.


## Quellherkunft im Produktionsbuild

Der sichtbare Quellen-/Lizenzdialog erhält seinen Weblink aus dem tatsächlichen
Git-Commit beim Vite-Build. Produkt-/Builddateien vor `npm run build` committen;
uncommittete Dateien unter `src/`, `public/`, Paket-/Buildkonfiguration oder der Lizenz
verhindern einen Produktionsbuild, statt einen unzutreffenden Quellstand zu zeigen.
`npm run dev` bleibt für die Arbeit an Änderungen nutzbar. Keine frei überschreibbare
Commit-/Quell-URL-Umgebungsvariable. Der Build benötigt deshalb einen Git-Checkout.
Der Hauptrepo-Buildpfad erzeugt diesen ohnehin frisch mit festem öffentlichem Commit.

`npm run test:csp` prüft neben der Standalonevalidierung auch den sichtbaren Quellen-
Dialog: exakter Commitlink, originale lokale Lizenzbytes, Dialog-/Tastaturfokus und
strikte Script-CSP. Der neue Tabellenvertrag wird erst nach Freigabe gebunden;
aktueller Paketstand und offene Prüfungen im [F3-Handoff](docs/handoffs/F3.md).


## Freigegebene Tabellen-API und echte Kernpfadprobe

Die unveränderte zusätzliche Vertragskopie liegt unter `src/lib/contract/v2/`.
[Herkunft](src/lib/contract/v2/provenance.json): öffentlicher Backendcommit
`427444d7bcb8e30c9563ded2000ec3d5e19646c4`, SHA256
`c15a848f01bb779429fd68a2b6eb6bba1575d3e07a4c68e6796cf7840a661838`.
V1-Datei und deren SHA bleiben unverändert. TypeScript und CSP-taugliche Standalone-
Validatoren beider Versionen werden separat generiert und auf Byteabweichungen geprüft.

Mit Go1.27.1, Git, Docker, OpenSSL und den üblichen Node-/npm-Werkzeugen:

```sh
python3 scripts/test-real-tables.py
```

Das Skript baut den committeten Produktionsclient, lädt ausschließlich den vollen
öffentlichen Backendcommit in ein privates temporäres Gitverzeichnis, prüft dessen
Vertragsbytes und baut das echte Go-CLI. SQLite und eine eigene PostgreSQL18.6-TLS-
Fixture verwenden nur synthetische Daten und zufällige kurzlebige Credentials.
Der lokale Vite-Preview vermittelt `/api` an dieses echte Backend; keine API-Mocks
im Kernpfad. Die CSP entspricht der strikten Auslieferungsregel ohne Script-Eval/
Inline-Scripts. Das belegt den neuen Client-/Backendpfad; erneute Go-Einbettung und
Compose-/Swarm-Auslieferung dieses neuen Webpins sind ein separates F3b-Paket.
Der Test entfernt eigene Prozesse, Container/Volume und temporäre Daten. Browsertraces,
Screenshots und Videos bleiben aus; keine Credentials in Logs oder Prozessargumenten.
Die CI installiert Chromium-Systempakete mit `npx playwright install --with-deps chromium`.
Tatsächliche Ergebnisse und unabhängige Abnahme: [F3-Handoff](docs/handoffs/F3.md).
