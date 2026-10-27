# W-P20 Web: Anbindung an den serverseitigen Konfigurationsspeicher (API 0.24)

Stand: 27.10.2026. Branch `feat/w-p20-web`, Basis Web-main `4b24e53`, Backend-main `a40b20d` (API 0.24.0).
Nichts gemergt; Review und Integration liegen beim Lead. Zentrale STATUS-/ARBEITSPLAN-Dateien unverändert.

## Ergebnis

- **Vertrag:** `src/lib/contract/v24` (OpenAPI 0.24.0 bytegleich aus Backend-main, SHA-256 `e2f2e057…463da7a`, `provenance.json`,
  Typen und schlanke Validatoren per Generator). `scripts/validator-roots.json` Eintrag `24` mit 19 Schemas; `validators.js` 142 KB
  (gegenüber 1,2 MB für ein volles v-Bundle). Gesamtgröße `dist` 4,33 → 4,47 MiB (gemessen, Precache-Grenze des Backends 8 MiB;
  der Backend-Build-Test selbst nicht ausgeführt).
- **Neues Feature** `src/lib/features/config-store/` (Slot `server-section` im Server-Bereich, neben Einstellungen):
  `client.ts` (typisierter Client, validiert jede Antwort, nur stabile Fehlercodes, nie Serverstext/SQL), `store.svelte.ts`
  (Fähigkeiten, Opt-in, Dokumente, Favoriten, Zuletzt, Suchen, Import/Export/Löschplan), `library.svelte.ts` (Verlauf/Lesezeichen mit
  Cursor-Seiten, Einzelanfrage, 412-Merge), `buffer.svelte.ts` (Schreibpuffer), `migration.svelte.ts`, `clear.svelte.ts`,
  `appearance.svelte.ts`, Oberflächen `ConfigStorePanel`, `ServerLibraryView`, `MigrationPanel`, `ClearPanel`, `FavoritesPanel`,
  `PrivacyInfo`; Test-Stellvertreter `testing.ts` (nur Tests, nicht der echte Server).
- **Eingriffe in bestehenden Code (klein):** `SqlLibraryPanel.svelte` zeigt bei Serverbetrieb `ServerLibraryView`, sonst unverändert den
  W-P16-Lokalmodus; `storage.svelte.ts` teilt die Verbindungsidentität (`config-store/identity.ts`, Scope = dieselbe SHA-256 wie der
  lokale Schlüsselsuffix), liest lokale Bibliotheken für die Migration und leitet `recordQuery` zuerst an den Serverspeicher
  (`record.ts`); `SqlTab.svelte` reicht `onwritephase`; i18n `configStore.*` (de/en).

## Verhalten

- **Capabilities** (`GET /api/v24/capabilities`, 6 s Frist): nur `available && mode=server` schaltet auf Serverbetrieb. Sonst
  Lokalmodus (W-P16 unverändert) mit Hinweis und Grund (`not_configured`, `unreachable`, älteres Backend `unsupported`, sonst
  `error`), ohne Rohtext. Im Lokalmodus wird keine Datenroute angesprochen (Test); Neuprüfung höchstens alle 30 s oder per Knopf.
- **Serverseitig:** Verlauf, Lesezeichen (inkl. Bearbeiten), Suchen (Client-Methode, noch keine Oberfläche), Favoriten und Zuletzt
  (Panel im Server-Bereich), Einstellungen nur Thema/Sprache (`settings/appearance`, nur diese zwei Werte, nach 400 ms Pause, bei 412
  gewinnt der Serverstand und wird angezeigt), Layouts (`store.saveDocument('layouts', …)` mit Versionsprüfung; **keine** Tabellen-
  Oberfläche verdrahtet, siehe offene Punkte). Keine Geheimnisse, Zugangsdaten oder Ergebnisse.
- **Verlauf nur mit Opt-in:** Schalter synchron zu `settings/privacy` (anlegen, danach `PUT` mit `If-Match`). Der Client schreibt keinen
  Verlauf ohne Opt-in; trotzdem erzwingt der Server (`409 history_disabled` setzt den lokalen Schalter zurück). Ausschalten löscht
  nichts; Löschen über Vorschau.
- **Fehler:** nur Katalogtexte je Code (`secret_rejected`, `quota_exceeded`, `item_too_large`, `plan_stale` usw.); SQL wird nie in
  Meldungen wiederholt. Eigene lokale Geheimnisprüfung (W-P16-Muster) läuft vorher.
- **Concurrency:** `PUT`/`DELETE` senden immer `If-Match` mit der gelesenen Version (428 tritt nicht auf). 412 beim Bearbeiten
  eines Lesezeichens öffnet einen Auswahldialog (Serverfassung übernehmen oder meine Fassung auf die aktuelle Version speichern);
  nichts wird still überschrieben. Löschen mit alter Version lädt die Liste neu. Cursor-Seiten à 50, „Mehr laden“.
- **Ausfall (503 `state_unavailable`, Netzfehler, Antwort nach dem Senden verloren):** neue Lesezeichen/Verlaufseinträge gehen mit
  `client_ref` in einen begrenzten Browserpuffer (`db-manager.config-buffer.v1`, höchstens 200 Einträge/512 KiB, vorher
  Geheimnisprüfung), erscheinen als „noch nicht auf dem Server“ und werden nach Erholung über den idempotenten Import übertragen
  (Server meldet `exists`, wenn die Antwort nur verloren ging); Puffer voll wird gemeldet statt „gespeichert“.
- **Migration** (nur bei Serverbetrieb): Vorschau mit Anzahlen ohne Netzwerk, Verlauf nur auf eigene Option (schaltet dann den
  Server-Opt-in ein), Bestätigungskästchen, Stapel zu `max_import_items`, `client_ref` = SHA-256 über Art/Scope/Zeit/Name/SQL (stabil
  über Neuladen), Originalzeit bleibt. Ergebnis mit Zählern und Ablehnungsgründen; abgelehnte Einträge bleiben lokal. Lokales
  Löschen nie automatisch, nur durch einen zweiten ausdrücklichen Knopf und nur für vom Server bestätigte Einträge.
- **Löschen/Export/Datenschutz:** „Alle gespeicherten Daten löschen“ (auch Verlauf, Lesezeichen je Verbindung) über Plan mit
  Anzahl/Bytes, getippte Bestätigung `LÖSCHEN n` laut Server, `plan_stale` verlangt neue Vorschau, verlorene Antwort wird als
  unbekannt markiert. Export lädt das vom Server gelieferte `dbm-config-export` als Datei. Datenschutzabschnitt (was, wo, wer,
  Geheimnisse, Löschen, Sicherungen) im Speicherbereich, im Lokalmodus mit angepasstem Text.
- **Sperre/UX:** Migration und Löschen melden `sending`/`settled`/`unknown` an `Session.writeCount`; alle Schreibaktionen sind
  Einzelanfrage (`busy`), Doppelklick = ein Request (Tests). Kein `{@html}`, Texte als Text, 320 px ohne horizontales Scrollen.

## Prüfstand (ausgeführt, Basis `feat/w-p20-web`)

- `npm run check`: 0 Fehler/0 Warnungen. `npm test`: 77 Dateien, 1063 Tests bestanden (davon 91 neu in `config-store`).
  `npm run format:check` und `python3 scripts/check-docs.py` bestanden.
- Browser: `tests/browser/config-store.spec.ts` (gemocktes Backend, 6 Fälle) und gesamte Browsersuite 126/126.
  `test:csp` 2/2, `test:pwa` 6/6. axe-core (wcag2a/2aa/21a/21aa/22aa) mit Einmalskript auf Konfliktdialog und Löschvorschau bei
  1280 und 320 px: keine Verstöße (nicht eingecheckt, `axe-core` nicht Teil der Abhängigkeiten).
- **Echtlauf** `python3 scripts/test-real-config-store.py`: Backend-Main `a40b20d` gebaut, Wegwerf-MariaDB 12.3 mit TLS
  (dbfix, Container `dbmanager-w-p20-web-*`, entfernt), `state-migrate` mit DDL-Benutzer, Dienst nur mit Laufzeitbenutzer;
  `tests/real/config-store.spec.ts` 7/7: Serverbetrieb, Migration (3 neu, 1 vom Server abgelehnt, Wiederholung 3 exists, lokales
  Löschen nur danach), Opt-in (kein Schreiben ohne, 409 direkt), Secret-Ablehnung ohne Echo, Doppelklick = 1 Eintrag, 412-Auswahl,
  Neuladen vom Server, Thema serverseitig, Export, Löschen mit Bestätigung, Ausfall (`docker pause` der eigenen Datenbank:
  `unreachable`, 503, Puffer, Erholung ohne Verlust und ohne Duplikat), zweites Backend ohne Zustand = Lokalmodus
  `not_configured`. Port 4179 und fremde Container/Prozesse nicht berührt (freie Ports, nur eigene Container).

## Offene Punkte

- Layouts (Spaltenreihenfolge/-breite) und gespeicherte Suchen sind im Speicher-Client (`saveDocument`, `saveSearch`) und getestet,
  aber **nicht** an Tabellenansicht/Suchfunktion verdrahtet (kein Spaltenbreiten-Bedienelement im Bestand; eigenes Folgepaket
  mit W-P21). Favoriten/Zuletzt: Panel im Serverbereich; „Zuletzt benutzt“ wird nicht automatisch beim Öffnen von Tabellen
  geschrieben (`touchRecent` vorhanden).
- Besitzer ist `single`: alle mit demselben Token teilen die Daten (Hinweis in der Oberfläche); echte Trennung erst mit W-P30.
- Bei Ausfall wird nur Verlauf/Lesezeichen gepuffert, nicht Favoriten, Dokumente oder Opt-in (diese melden den Fehler).
- Geheimniserkennung bleibt heuristisch (Backend ADR 7); die Oberfläche weist darauf hin.
- Der Backend-Build-Test „Precache ≤ 8 MiB“ wurde nicht ausgeführt, nur die Webgröße gemessen (+0,14 MiB).
- Unabhängiges Review und Integration stehen aus. Kein Webpin, kein Deployment.

## Nachtrag: Review-Auflagen umgesetzt (27.10.2026)

Review `review/w-p20-web` @ `6942ab3` (Freigabe mit Auflagen) eingemerged (enthält Web-main `1145be4`). Alle 11 `it.fails` in
`review.attack.test.ts` sind zu normalen Tests umgedreht (Titel „FIXED (…)“).

| Befund | Umsetzung |
| --- | --- |
| W-01 | Migrationsbestätigung ist an Vorschau und Optionen gebunden (Signatur aus Opt-in-Haken, Anzahl, erstem/letztem `client_ref`); jede Änderung widerruft sie, `canRun` verlangt neue Bestätigung |
| W-02 | Stapel nach Anzahl (`max_import_items`) und Bytes (≤ 900 KiB, `chunkBySize`), auch beim Hintergrund-Flush; Einträge über dem Serverlimit je Sammlung bleiben lokal mit Zähler und Hinweis |
| W-03 | Erstprüfung zeigt „wird geprüft“, spätere Prüfungen laufen im Hintergrund und ändern den Zustand nur bei echtem Moduswechsel; ein fehlschlagender Re-Check im Serverbetrieb wird nur `degraded`, nie Lokalmodus; Panel/Entwurf/412-Dialog bleiben. Öffnen des Speicherpanels nach Ausfall prüft sofort |
| W-04 | Pufferein­träge tragen `owner` (SHA-256-Kurzhash des Tokens, nie das Token); sichtbar, ersetzt und hochgeladen wird nur unter eigener Identität, fremde bleiben getrennt erhalten |
| W-05 | `secrets.ts` portiert die Backend-Regeln (Wort- und Strukturregeln, JWT, URL/DSN, PEM, Basic, curl -u, Key=Value, Tokenformate, 32+-Läufe, NFKC/Homoglyphen); gilt für SQL, Namen, Puffer (nie gespeichert, beim Laden verworfen) und die Migration. Lineare Laufzeit (Lookbehind, `@`-Vorprüfung) getestet. Bereits lokal gespeicherte Altdaten werden weiter gelesen (lenient), aber von der Migration übersprungen und gezählt |
| W-06 | Der Store meldet für **alle** Schreibaktionen `sending`/`settled`/`unknown` (`store.observe`): Opt-in, Lesezeichen, Favoriten, Zuletzt, Dokumente/Autosave, Löschen, Hintergrund-Flush; Panels leiten das an `Session.writeCount`. Migration meldet bei verlorener Antwort `unknown` |
| W-07 | „Alle löschen“ und Einzel-Clear räumen betroffene Puffereinträge; `time` im Puffer wird beim Laden/Hinzufügen validiert |
| W-08 | Zweites 412 im Auswahldialog lädt die neueste Serverfassung nach, der Dialog bleibt bedienbar |
| W-09 | Autosave Thema/Sprache führt Änderungen während laufendem Speichern zusammen und sendet sie danach |
| W-10 | Store-API ruft im Lokalmodus nie eine Datenroute (Ergebnis `local_mode`, kein Request) |
| W-11 | Datenschutztext: Datenbankadministratoren ohne Serverschlüssel sehen nur Zeiten/Größen/Anzahlen; wer den Server samt Schlüssel betreibt, kann Inhalte lesen |
| W-12 | Opt-in nicht lesbar (Ausfall nach Start): Verlauf pausiert sichtbar („Verlauf pausiert“) statt still zu verwerfen |
| optional | „Zuletzt benutzt“ wird beim Öffnen einer Tabelle nur im Serverbetrieb geschrieben (`recordRecent`) |

Neue Tests `fixes.test.ts` (25) sowie angepasste Bestandstests. Layouts und gespeicherte Suchen bleiben Folgepaket W-P21 (Client
vorhanden, keine Oberfläche).

Prüfstand nach den Auflagen: `npm run check` 0/0, `npm test` 1197/1197 (davon 11 ehemalige Defekt-Tests), `format:check` ok,
Browsersuite 155/155, `test:csp` 3/3, `test:pwa` 6/6, `scripts/test-real-config-store.py` 7/7 gegen Backend-Main `a40b20d`
(Wegwerf-MariaDB 12.3, entfernt). Größe `dist`: Web-main `1145be4` 4,76 MiB, Branch 4,91 MiB (+0,15 MiB, Backend-Grenze 8 MiB;
der Backend-Precache-Test selbst nicht ausgeführt). Hinweis: der Echtlauf-Spec erwartet jetzt die lokale Ablehnung des
32-Hex-Eintrags (Server-Ablehnung weiterhin per Unit-/Backend-Test abgedeckt).
