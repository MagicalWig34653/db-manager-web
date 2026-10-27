# W-P20 Web: unabhängiges Sicherheitsreview

Stand: 27.10.2026. Geprüft: `feat/w-p20-web` @ `d57a492` (Basis `4b24e53`), zusammengeführt mit Web-main `1145be4`
(CodeMirror) im Review-Branch `review/w-p20-web` (Merge ohne Textkonflikte). Backend-main `a40b20d` (API 0.24.0); Backend-main
ist inzwischen `92ec417`, seit `a40b20d` unverändert in `contracts/` und `internal/` (nur Doku). Nichts gemergt, nichts am Produkt
geändert; ergänzt wurden Angriffstests und eine Reparatur der Browser-Spec (siehe I-01).

## Urteil

**Freigabe mit Auflagen, kein Blocker.** Die Kernzusagen halten: nur `available && mode=server` schaltet den Serverbetrieb, im
Lokalmodus geht keine Datenanfrage hinaus, jede Antwort wird gegen den Vertrag geprüft, Server-/SQL-Text wird nie angezeigt,
Verlauf geht ohne Opt-in nicht hinaus, Einstellungen enthalten nur Thema/Sprache, `If-Match` steht an jedem `PUT`/`DELETE`, Löschen
braucht Plan und getippten Text, kein `{@html}`. Es bleiben **sechs mittlere** Befunde (W-01 bis W-06) und mehrere niedrige; die
mittleren sollten vor dem Merge behoben oder vom Lead ausdrücklich angenommen werden. Vor Integration ist zudem I-01 zu beachten.

## Befunde nach Schwere

Jeder Befund hat einen Test in `src/lib/features/config-store/review.attack.test.ts`. Defekte sind mit `it.fails` markiert: die
Behauptung beschreibt das **gewollte** Verhalten, die Suite bleibt grün, solange der Defekt besteht, und wird rot, wenn er behoben ist
(dann `it.fails` zu `it` machen). Jeder dieser Tests wurde einzeln ohne `.fails` gelaufen und scheitert aus dem genannten Grund.

### Mittel

**W-01 Bestätigung der Migration gilt nach geänderter Vorschau weiter (Einwilligung).** `Migration.confirmed` wird beim Umschalten
von `includeHistory` nicht zurückgesetzt, `canRun` prüft nur den Haken. Reproduktion: Vorschau „2 Lesezeichen, 0 Verlauf“, Haken
„Ich bestätige“ setzen, dann „Auch den lokalen Verlauf übertragen“ anhaken, „Jetzt übertragen“: Verlauf geht hinaus und der
Server-Opt-in wird eingeschaltet (`run()` ruft `setHistoryEnabled(true)`), ohne dass die geänderte Vorschau bestätigt wurde.
Test: `migration > DEFECT (Medium): confirmation given for a preview...`. Auflage: `confirmed=false` bei jeder Änderung der
Vorschau (Option, Anzahl).

**W-02 Migration schneidet Stapel nur nach Anzahl (dauerhaft fehlschlagend bei großen Beständen).** `chunk(items, max_import_items)`
berücksichtigt nicht die Größe; der Client lehnt Körper über 1 MiB selbst mit `request_too_large` ab (Server-Grenze 1 MiB). Fünf
lokale Bibliotheken mit je 20 Lesezeichen à 12 KB (erlaubt: je Bibliothek bis 255 KiB) ergeben einen ersten Stapel von 1,2 MiB:
Phase `failed`, jeder Wiederholversuch bildet denselben Stapel. Der Nutzer kann diese Daten nie migrieren. Test:
`migration > DEFECT (Medium): batches are cut by count...`. Auflage: Stapel zusätzlich nach Bytes (z. B. 512 KiB) teilen; dieselbe
Regel für `runFlush` (dort durch die 512-KiB-Pufferobergrenze unkritisch, aber ohne die Regel nicht abgesichert).

**W-03 Fähigkeiten-Neuprüfung ersetzt das offene Panel und vernichtet Entwürfe und den 412-Dialog.** `refresh()` setzt
`phase='loading'`; `SqlLibraryPanel` zeigt dann „Speicher wird geprüft“ statt der Bibliothek (`{:else if token && store.phase !== 'ready'}`),
`ServerLibraryView` wird abgebaut. Die Neuprüfung löst jeder Abfragelauf aus (`recordServerHistory` → `ensureReady`): im Lokalmodus
nach 30 s Ruhe, bei `degraded` bei **jedem** Lauf (keine Drosselung). Folgen: Eingabe „Name des Lesezeichens“, Suche und Fokus gehen
verloren; der Konfliktdialog samt „Meine Fassung“ (`ServerLibrary.conflict`) wird zerstört, also verwirft ein Lauf während der
Auswahl die Änderung des Nutzers. Bei hängender Antwort (6 s Frist) bleibt das Panel entsprechend lang weg. Test:
`mode re-check while the library panel is open`. Auflage: nach dem ersten `ready` die Oberfläche beim Neuprüfen nicht abbauen
(separater Zustand `checking` nur für die Anzeige im Einstellungspanel), Neuprüfung bei `degraded` drosseln (z. B. 5 s, `Retry-After`).

**W-04 Ausfallpuffer ist nicht an Token/Besitzer gebunden.** `BUFFER_KEY` ist global in `localStorage`; jeder `ConfigStore` (je Token)
liest ihn und spielt ihn nach `ensureReady` in sein Backend/Konto ein. Heute ist der Besitzer `single` (alle Token teilen), mit W-P30
(Konten) gelangt der gepufferte SQL-Text eines Kontos in das nächste Konto desselben Browsers. Test:
`DEFECT (Medium for W-P30): the outage buffer is not bound to the token`. Auflage: Pufferschlüssel/-inhalt an Token-Hash (oder
Besitzer) binden; bei Tokenwechsel nicht einspielen und anbieten, ihn zu verwerfen.

**W-05 Ausfallpuffer legt SQL im Klartext ab, das nur die schwächere Client-Heuristik prüft.** Die Clientregeln (W-P16
`SECRET_PATTERNS`) erkennen weder JWT noch URL mit Zugangsdaten, `curl -u`, lange Hex-/Base64-Läufe; der Server lehnt diese mit
`secret_rejected` ab. Im Normalbetrieb wird so nichts gespeichert, im Ausfall landet derselbe Text bis zur Wiedergabe im Browser-`localStorage`
(danach lehnt der Server ab, der Eintrag wird entfernt). Reproduktion: Opt-in an, Backend-Zustand aus, `SELECT 'eyJ…jwt'` oder
`SELECT 'postgres://admin:s3cr3t@db/app'` ausführen: beide stehen in `db-manager.config-buffer.v1`. Test:
`DEFECT (Medium, hardening): outage buffer persists SQL that the server would reject`. Die Oberfläche weist auf den Browserpuffer hin
(`configStore.degraded`), nennt aber den Klartext nicht. Auflage (eine davon): Verlauf nicht puffern (nur Lesezeichen, die der Nutzer
bewusst speichert), oder Clientregeln auf Serverniveau heben (JWT, URL-Zugangsdaten, Hex/Base64-Läufe), oder den Puffer verschlüsseln
(WebCrypto, nicht extrahierbarer Schlüssel); mindestens den Hinweistext ergänzen.

**W-06 (Mittel, UI-Pflicht aus Auftrag) Schreibsperre deckt nur Migration und Löschen.** `Session.writeCount` wird nur von `Migration`
und `ClearFlow` bedient. Nicht gemeldet: Opt-in-Schalter, Lesezeichen anlegen/ändern/löschen, Verlaufseintrag löschen, Favoriten,
Thema/Sprache-Autosave, Hintergrund-Flush des Puffers (`refresh()` → `flush()` ohne Empfänger). Folge: Navigation, Trennen oder
Sitzungswechsel laufen mitten in einer Anfrage; bei Verlust der Antwort kein `unknown`-Hinweis. Datenverlust ist wegen `If-Match`
und idempotentem `client_ref` nicht zu erwarten, aber die vom Auftrag verlangte Sperre fehlt. Zusätzlich meldet `Migration.run` bei
verlorener Antwort `settled` statt `unknown` (Test `DEFECT (Low): a lost answer during the import is reported as "settled"`), anders
als `ClearFlow`. Auflage: einen gemeinsamen `onwritephase` in `ConfigStore` für alle Schreibwege (inkl. Flush) und `unknown` bei
`outcome_unknown`.

### Niedrig

**W-07 „Löschen“ räumt den Puffer nicht.** Gepufferte Lesezeichen/Verlauf bleiben nach „Alle gespeicherten Daten löschen“ im Browser
und werden bei der nächsten Neuprüfung wieder hochgeladen (Verlauf nur, wenn der Opt-in nicht mitgelöscht wurde; Lesezeichen immer).
Test `"delete all" leaves buffered bookmarks...`. Die Oberfläche zählt gepufferte Einträge im Löschplan nicht mit. Auflage: nach
`clearExecute` Puffer der betroffenen Arten/Scopes leeren, Anzahl im Plan nennen. Zusatz: ein verfälschter Pufferwert (`time` kein
RFC 3339) lässt den ganzen Stapel am Server mit 400 scheitern und blockiert damit den gesamten Puffer dauerhaft (Giftpille), und
`ServerLibraryView` wirft `RangeError: Invalid time value` (`formatDate(new Date('garbage'))`); Test
`corrupted browser buffer entry`. Auflage: Pufferwerte beim Laden streng prüfen (Datum, Felder), Stapel bei Ganzablehnung per Einzelversuch aufteilen.

**W-08 412-Dialog: zweite Veraltung nicht behandelt.** `resolve('mine')` nutzt das beim ersten 412 gelesene `current`. Ändert jemand erneut,
scheitert jeder weitere Versuch mit 412 und der Dialog bleibt auf der alten Serverfassung stehen (nur „Serverfassung übernehmen“
löst es, verwirft aber die eigene Fassung). Kein stilles Überschreiben (gut), aber Sackgasse. Test `after a second 412`. Auflage: bei
412 in `resolve` `current` neu laden und anzeigen.

**W-09 Autosave Thema/Sprache verliert eine Änderung während laufendem Speichern.** `save()` kehrt bei `saving` zurück, setzt danach
`wanted=null` und merkt die jüngere Änderung nicht vor. Folge: der Server hat das alte Thema, bis der nächste Wechsel kommt. Test
`the setting autosave drops a change`.

**W-10 Store-API erzwingt den Modus nicht selbst.** `write`/`listPage`/`updateItem` usw. prüfen `active` nicht; die Sperre liegt nur in der
Oberfläche. Nach Umschalten auf `local` (Neuprüfung) sendet ein bereits laufender Aufruf noch Datenrouten (Test `after a switch to local
mode`). Die Zusage „im Lokalmodus keine Datenanfrage“ gilt damit für alle Pfade der Oberfläche (geprüft: Test, `recordServerHistory`,
Panel), aber nicht als Eigenschaft der Schnittstelle. Auflage: `guard` prüft `mode==='server'` (Ausnahmen: `capabilities`).

**W-11 Datenschutztext ungenau.** `configStore.data.who`: „der Betreiber sieht Zeiten, Größen und Anzahlen, nicht den Inhalt“. Nach Backend-ADR
7/9 sind die Inhalte nur für Datenbankadministratoren ohne Serverschlüssel nicht lesbar; wer den Dienst samt Schlüssel betreibt,
kann sie entschlüsseln. `configStore.data.what` sagt „Nie gespeichert werden Passwörter, Tokens …“, obwohl die Erkennung heuristisch ist
(der Folgesatz relativiert). Auflage: „Datenbankadministratoren“ statt „Betreiber“, „werden abgelehnt, soweit erkannt“.

**W-12 Verlauf bei unlesbarem Opt-in-Zustand wird still verworfen.** Bei `degraded` und noch nie gelesenem `settings/privacy` ist
`historyEnabled=false`; `recordServerHistory` meldet „behandelt“, es wird weder gesendet noch lokal gespeichert (kein Datenleck, aber
stiller Verlauf-Verlust nach Neuladen im Ausfall).

### Information (kein Befund)

- Reihenfolge/Details der Migration: `reasons` ist ein einfaches Objekt mit Serverschlüsseln; ein Grund `__proto__` richtet nichts an
  (Wertzuweisung an `__proto__` wird verworfen), zählt aber nicht mit. Anzeige läuft über `errorText` (Katalog), nie Rohtext.
- Fehlercodes ungleich der Liste werden zu `error`; `Retry-After` wird gelesen, aber nirgends zur Drosselung benutzt.
- Download: Dateiname fest `db-manager-konfiguration.json`, Blob wird nach 1 s freigegeben, `link.click()` ohne Anhängen an das DOM
  (heutige Browser unproblematisch). Der Export-Text kommt unverändert vom Server (validiert), keine Re-Serialisierung.

## Geprüfte Zusagen (bestanden, mit Test)

- **Fähigkeiten:** `available=true,mode=local_only`, `available=false,mode=server`, `available=false` und missgestaltete Antworten bleiben
  lokal und senden nur `GET /api/v24/capabilities` (Tests mit allen drei Mischfällen). Späte Antwort: während sie aussteht geht keine
  Datenanfrage hinaus; kommt `local_only`, bleibt es dabei (Test mit blockiertem Abruf). Gleichzeitige Prüfungen teilen eine Anfrage.
  Laufzeitwechsel server → lokal stoppt Verlaufschreiben am Naht-Punkt `recordServerHistory`. (Abweichungen: W-03, W-10.)
- **Datenschutz:** Fehlerbild `secret_rejected` zeigt nur Katalogtext, kein SQL, nichts im Puffer/`localStorage` (Server-Text mit SQL im
  Test); ohne Opt-in keine Schreibanfrage; Einstellungen exakt `{theme, locale}`; feindliche Serverwerte (`theme`/`locale`) werden nicht
  angewendet. Migration: Vorschau ohne Netzwerk, Bestätigung, stabiler `client_ref` (SHA-256 über Art/Scope/Zeit/Name/SQL), Wiederholung
  `exists`, lokales Löschen nur für bestätigte Einträge und nur über den zweiten Knopf, Doppelklick = ein Import.
- **Nebenläufigkeit:** `If-Match: "<Version>"` an jedem `PUT`/`DELETE` (Vertragstests), `DELETE` mit veralteter Version löscht nichts und lädt neu,
  `plan_stale` verlangt neue Vorschau, falsch geschriebene Bestätigung (Groß/Klein) sperrt den Knopf, Doppelklick auf „Löschen“ = ein Request.
  Cursor: Seiten à 50, Doppelte werden nach `id` gefiltert.
- **XSS:** Lesezeichenname/SQL/Verlauf mit `<img onerror>`/`<script>` erscheinen nur als Text (kein `{@html}` im Feature; Test mit
  Rendern, kein `img/script/iframe/svg`, kein `window.__pwned`).
- **Vertrag:** `api-v0.24.0.json` ist **bytegleich** zu Backend-main (`cmp`, SHA-256 `e2f2e057…463da7a`); `provenance.json` stimmt;
  Fixtures sind bis auf den Web-README identisch zu `contracts/fixtures/config-store` (36 Dateien). `validator-roots.json["24"]` enthält 19
  Schemas = alle Config-Wurzeln, die eine `/api/v24`-Operation als Körper/Antwort nutzt; das Ergebnis des gepackten Moduls hat genau diese
  Exporte. Differentieller Test gegen den vollen Ajv-Validator: jede Fixture und Mutationen (Schlüssel löschen, unbekanntes Feld,
  Null/Zahl/negativ/Gleitkomma/2^53/leer/300 Zeichen/NUL/leeres Objekt/Array an jeder Stelle, Doppelte, leeres Array), **über 2000
  Vergleiche, null Abweichungen** (`slim validators equal the full validators`).

## Läufe (Review-Branch nach Merge mit Web-main, Ports 4391/4392/4393 frei gewählt; Port 4179 und fremde Container/Prozesse nicht berührt)

| Lauf | Ergebnis |
| --- | --- |
| `npm run check` | 0 Fehler, 0 Warnungen |
| `npm test` | 88 Dateien, 1160 bestanden + 11 erwartete Fehlschläge (meine `it.fails`), vor meinen Tests 87/1141 |
| `npm run format:check`, `python3 scripts/check-docs.py` | bestanden |
| `npm run contract:check`, `validators:check` | bestanden |
| `npm run build` | grün |
| `test:csp` | 3/3 (Editor, Quelle, Validatoren) |
| `test:pwa` | 6/6 |
| Playwright (gesamt) | 154 bestanden, **1 Fehlschlag** `config-store.spec.ts:81` (siehe I-01); nach Reparatur `config-store.spec.ts` 6/6 |
| axe-core (`scripts/review-axe.sh`, config-store-Spec, Endzustand + 320 px) | 12 Läufe, 0 Verstöße |
| `scripts/test-real-config-store.py` | 7/7 gegen Backend `a40b20d` (Wegwerf-MariaDB 12.3 mit TLS; Container danach entfernt, 0 Reste) |

**Precache** nach Zusammenführung mit Web-main (CodeMirror), `dist` ohne `sw.js`: **5.137.262 Bytes = 4,90 MiB**, 52 Dateien, davon 42
unter `assets/` (4.948.339 Bytes). Backend-Grenzen: 8 MiB (3,10 MiB frei) und `MAX_CHUNKS` 64 (22 frei); eingehalten. Der Build-Test des
Backends selbst (`scripts` im Backend-Repo, Pin auf einen Webcommit) wurde **nicht** ausgeführt, nur diese Messung. Die Handoff-Zahl 4,47 MiB galt vor
dem CodeMirror-Merge.

i18n de/en: Katalogparität und Schlüsselnutzung (`catalogs.test.ts`, `keys.test.ts`) bestanden; 320 px im Browser-Spec (Konflikt,
Löschvorschau, Opt-in) ohne horizontales Scrollen und axe-sauber.

## Integration

**I-01 Browser-Spec bricht nach dem Merge mit CodeMirror.** `tests/browser/config-store.spec.ts:109` prüft `toHaveValue` auf
`#sql-editor`, das jetzt ein CodeMirror-Host (kein Eingabeelement) ist. Produktverhalten stimmt (die Vorlage „In Editor übernehmen“
arbeitet, `real`-Spec und alle übrigen Specs bestehen). Im Review-Branch repariert (`expect.poll(() => editorText(editor))`), Commit
siehe Git-Verlauf. Der Lead übernimmt die Zeile bei der Integration. Textkonflikte gibt es keine (i18n, `SqlTab.svelte` automatisch zusammengeführt).

## Ergänzte Dateien

- `src/lib/features/config-store/review.attack.test.ts` (30 Tests: 19 bestehen = Zusagen, 11 `it.fails` = Befunde W-01 bis W-10; W-11 und W-12 sind Textbefund bzw. Codelesung ohne Test)
- `tests/browser/config-store.spec.ts` (nur Zeile 109, I-01)
- dieser Bericht

## Nicht geprüft / offen

- Backend-Build-Test „Precache ≤ 8 MiB“ (nur gemessen).
- Keine Prüfung gegen MariaDB 10.11, MySQL, PostgreSQL als Serverzustand (nicht Teil des Pakets).
- Mehr-Tab-Verhalten des Puffers: `WriteBuffer` hält den Zustand im Speicher je Tab und überschreibt `localStorage` mit seinem Stand; zwei Tabs
  können sich gegenseitig ungeflushte Einträge löschen (nicht per Test belegt, Codelesung).
- Echte Nutzertrennung (W-P30) und Geheimniserkennung bleiben wie im Backend dokumentiert heuristisch.
