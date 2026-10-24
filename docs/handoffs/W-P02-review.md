# Review W-P02: Web-Shell und Routing

Unabhängiger Review von `feat/w-p02-shell` (`b3c1136`, Code-Commit `ee39e7c`, Basis `f75bfa1`; `main` steht inzwischen auf
`0982738`). Review-Branch `review/w-p02`, eigener Worktree, `node_modules` als `cp -cR`-Kopie. Der Autor-Branch wurde nicht
verändert, nichts auf `main` gemergt.

## Urteil

**Freigabe mit Auflagen.** Das Verhalten gegenüber dem alten `App.svelte` ist bis auf dokumentierte, beabsichtigte
Unterschiede gleich; alle Prüfungen einschließlich des Laufs gegen das echte Backend sind grün. Zwei mittlere Befunde
(F1, F2) betreffen die Robustheit gegenüber späteren Paketen und sollten vor dem ersten Funktionspaket behoben werden, sie
blockieren die Integration der Shell selbst nicht. Ein Probemerge von `feat/w-p02-shell` nach `main` (`git merge-tree`) ist
konflikt­frei; nach dem Merge sind `check`, `test` und `contract:check` einmal auf dem Integrationsstand zu wiederholen
(`main` enthält W-P04-Änderungen an `package.json`/`tests/generate-validators.mjs`, die der Branch nicht kennt).

## Ausgeführte Prüfungen (nacheinander, Review-Worktree)

| Befehl | Ergebnis |
| --- | --- |
| `npm run check` | 0 Fehler, 0 Warnungen |
| `npm test` | 13 Dateien, 62 Tests bestanden |
| `npm run format:check` | bestanden |
| `npm run test:browser` | 10 bestanden |
| `npm run test:csp` | Build (Validatoren aktuell) und 2 CSP-Tests bestanden |
| `python3 scripts/test-real-tables.py` | 10 echte Fälle bestanden: SQLite und PostgreSQL 18.6 `verify-full`, exaktes gepinntes Go-Backend aus dem Quellcommit der Provenance, Export, Einzelzeilen-Insert/Update/Delete/Konflikt, verlorene Commit-Antwort ohne Retry, Struktur, strukturiertes Durchsuchen. Das Skript meldet Entfernung von Prozessen, Container und temporärem Checkout; `docker ps -a` mit dem Label zeigt danach nichts. |
| Stichprobe 320 px, verbunden, Tabellenroute (temporärer Probe-Test, nicht committet) | `scrollWidth` 320 = Viewport, kein horizontales Scrollen; Menü per Tastatur/Knopf erreichbar |

Nicht ausgeführt: keine Reiter-/Tastaturprüfung mit Screenreader; MySQL/MariaDB (Fixture nicht Teil des Skripts).

## Befunde

### F1 (mittel) Ein fehlerhaftes Feature zerstört die ganze Anwendung

Beleg: `src/lib/features/index.ts` ruft `collectFeatures(...)` beim Modulladen auf (letzte Zeile) und wirft bei doppelter Id,
doppeltem Reiter, fehlendem Default-Export oder unvollständiger Definition. Da `Shell.svelte` das Modul importiert, bricht der
Import ab und die Seite bleibt leer. Zusätzlich gibt es keine `<svelte:boundary>` (Suche in `src` ohne Treffer) um die
eingehängte Feature-Komponente; ein Renderfehler in einem Paket-Reiter reißt die Shell mit. Die Tests belegen nur das Werfen
(`registry.test.ts`), nicht die Eindämmung. Der Auftrag (Abschnitt 2) verlangt, dass ein Feature die Shell nicht zerstört.
Fix: in `collectFeatures` fehlerhafte Module/Definitionen überspringen und als Ladefehler sammeln (sichtbare Warnung in der
Shell, übrige Features bleiben); jede Feature-Komponente in `<svelte:boundary>` mit `ErrorPanel` als `failed`-Snippet. Test
mit einem absichtlich werfenden Modul und einer werfenden Komponente ergänzen. Alternativ bewusst dokumentieren, dass
Registrierungsfehler Build-/Testfehler sein sollen (dann CI-Test, der das echte Glob prüft).

### F2 (mittel) Globale Kürzel ignorieren neue modale Dialoge

Beleg: `Shell.svelte` `dialogsClosed()` prüft nur `session.connectionOpen`/`accessOpen`. Ist künftig ein
`ConfirmDestructiveDialog` offen (modal, Fokusfalle), laufen Strg/Cmd+Enter (SQL ausführen, solange die Route SQL ist) und
Strg/Cmd+K (Navigation zur SQL-Ansicht) trotzdem, weil `keydown` an `window` hängt. Bei destruktiven Aktionen darf hinter einem
offenen Bestätigungsdialog keine SQL-Ausführung auslösbar sein. Fix: `when` zentral um „irgendein Dialog offen“ erweitern
(z. B. Modalzähler im Shell-Kontext, den Dialoge setzen, oder `document.querySelector('[role="dialog"][data-state="open"]')`),
Test ergänzen.

### F3 (niedrig-mittel) Hash-Round-Trip bricht bei bestimmten Objektnamen

Beleg (ausgeführt mit dem echten `router.ts`): Namen mit Steuerzeichen (`a\tb`), länger als 255 Zeichen oder leer ergeben
`formatRoute(...)` = gültige URL, `parseHash` liefert aber `home`. `navigate()` setzt zuerst `route`, danach löst die
Hash-Änderung `onhashchange` aus und setzt `route = parseHash(...)` = Startansicht; die geöffnete Tabelle verschwindet sofort.
Betrifft nur ungewöhnliche, aber in SQLite/PostgreSQL mögliche Identifier; Tabellennamen `daten`, `schema`, `tabelle`,
`a/b` funktionieren (getestet). Fix: Obergrenze/Steuerzeichenprüfung nur beim Parsen von Deep-Links beibehalten, aber
`onhashchange` ignorieren, wenn `window.location.hash === formatRoute(route)`; für nicht routbare Namen die Auswahl ohne Hash
halten (kein Deep-Link). Test ergänzen.

### F4 (niedrig) `ConfirmDestructiveDialog`: `oncancel` nur beim Knopf, nicht bei Escape/Außenklick

Beleg: `close()` ruft `oncancel`, aber Escape und Klick auf Overlay/Schließen-Kreuz setzen nur `open=false` (bits-ui,
`bind:open`). Aufrufer, die in `oncancel` Zustand zurücksetzen, werden nicht benachrichtigt. Fix: `onOpenChange` von
`Dialog.Root` nutzen oder `$effect` auf `open` true→false, `oncancel` dort aufrufen; Test mit Escape.

### F5 (niedrig) Barrierefreiheit `ConfirmDestructiveDialog`

- Eingabefeld hat `aria-label="Name des Zielobjekts"`, das die sichtbare Beschriftung („Tippe … zur Bestätigung“) für
  assistive Technik überschreibt (Label-in-Name, WCAG 2.5.3). Fix: `aria-label` entfernen, sichtbares `<label for>` genügt.
- Enter im Feld bestätigt sofort, sobald der Name stimmt. Das ist beim getippten Zielnamen vertretbar (Fehlbedienung mit
  falschem Namen ist ausgeschlossen: exakte Übereinstimmung, getestet), sollte aber im Konventionstext stehen. Anfangsfokus
  liegt im Eingabefeld, nicht auf dem destruktiven Knopf (gut). Feste Feld-Id `confirm-target-name` kollidiert bei zwei
  gleichzeitigen Instanzen (`$props.id()` verwenden).
- Escape/Fokusfalle/Rollen stammen aus bits-ui (`role="dialog"`, modal) und wurden nicht zusätzlich getestet; ein Test für
  Escape und Fokusrückgabe fehlt.

### F6 (niedrig) i18n unvollständig

Beleg: `Shell.svelte` (z. B. „Verbindung hinzufügen“, „Objekte filtern“, „Backend-Zugang“, Schreibhinweis) und
`SqlTab.svelte` enthalten weiterhin feste deutsche Texte; nur die neuen Texte laufen über `t()` (48 Aufrufe). Das entspricht
dem Handoff („vorhandene Texte bleiben vorerst“) und Auftrag 4 („nur Struktur und die schon vorhandenen Texte“), erfüllt aber
nicht „alle UI-Texte über `t()`“; die Verschiebung ist ein offener Folgeauftrag. Ein Test, der prüft, dass alle `titleKey`
und `t('…')`-Schlüssel im Katalog existieren, fehlt (unbekannte Schlüssel werden still als Schlüssel angezeigt).

### F7 (niedrig) Kürzel-Matching strenger als zuvor

`matches()` verlangt exakte Modifikatoren: Escape mit gedrückter Strg/Cmd bricht eine Abfrage nicht mehr ab (früher
irgendein Escape); Strg+Enter mit Alt zählt nicht mehr. Praktisch unerheblich; im Handoff nicht erwähnt.

### F8 (info) Beabsichtigte Verhaltensänderungen gegenüber dem alten `App.svelte`

- Verbinden mit gleicher Datenbank behält eine offene Datenbank-/Tabellenroute; früher wurde stets die SQL-Ansicht gewählt.
  Neuer Eintrag in History: jede `navigate()` erzeugt einen Verlaufseintrag (Zurück funktioniert, getestet).
- Skip-Link per Handler statt Anker; Fokus auf Editor/Tabellenbereich bzw. `main`.
- Unbekannter Reiter (`#/server/xyz`) zeigt einen Hinweis statt der Startansicht; das Handoff formuliert „ungültige Hashes
  führen zur Startansicht“ nur für syntaktisch ungültige Hashes.
- `Session.capabilities` bleibt leer, Fähigkeits-Gating ist also bisher nur per Unit-Test belegt.

## Prüfung der Prüfpunkte

1. Verhaltensgleichheit: Diff alt/neu gezielt gelesen. Verbindungs-, Token- und Sitzungslogik (Versionszähler, Abbruch, Verwerfen
   verspäteter Antworten, `separateWriteContext`, `writeReceiver`) ist zeilenweise gleich nach `session.svelte.ts`
   verschoben; SQL-Ausführung/Abbruch/Reset nach `sql.svelte.ts`. Keine Treffer für `localStorage`, `sessionStorage`,
   `indexedDB`, `history.push/replace`, `location.href` in `src`. Die Hash-URL enthält nur Datenbank-, Schema-, Tabellen- und
   Reiternamen; Browserkontrollen: Test „deep link … no secrets“ plus eigene Prüfung. Schreibaktionen (Einzelzeile
   Insert/Update/Delete mit Bestätigung), Export und Struktur laufen unverändert über `TableWorkbench` und sind durch den
   echten Lauf (10 Fälle) belegt. Router: ungültige Prozentkodierung, Fremdpfade (`#//evil.com`), zu viele Segmente,
   reservierte Reiternamen liefern `home`; `<script>` im Datenbanknamen wird nur als Text gerendert (Svelte-Escaping, kein
   `{@html}` in `src`), Reiter müssen `^[a-z][a-z0-9-]{0,31}$` und in der Registry vorhanden sein. Kein Open-Redirect, keine
   Navigation zu URLs aus dem Hash. Tabellenroute wird nur nach geladenem Katalog und passender Verbindung aufgelöst.
2. Registry: Doppelte Ids/Reiter werden erkannt (F1 zur Eindämmung); Gating zeigt Reiter plus `CapabilityNotice`; die
   Dateibesitzregel `src/lib/features/<name>/feature.ts` per Glob macht parallele Pakete praktikabel (kein gemeinsam
   bearbeitetes Verzeichnis). `de.ts` bleibt eine geteilte Datei (Anhängekonflikte, im Plan als „nur Anhängen“ geregelt).
   Das Glob-Muster `./*/feature.ts` findet nur eine Ebene tief, passend zum Plan.
3. Gemeinsame Komponenten: kein `{@html}`; Warnliste mit `role="alert"`, Fehler mit `role="alert"`, Hinweis `role="status"`;
   `PlanPreview` schreibgeschützt; F4/F5 oben.
4. CSP/Build: `package.json`, `vite.config.ts`, Verträge, `package-lock.json` und bestehende Tests im Dreipunkt-Diff
   unverändert; keine neue Laufzeitabhängigkeit; CSP-Tests grün. Hinweis: Bundle 975 kB mit Vite-Größenwarnung (Vergleich mit main nicht erhoben).
5. Echter Lauf, 320 px, Tastatur: siehe Tabelle. Der 320-px-Test des Autors prüft nur den unverbundenen Zustand; die eigene
   Stichprobe mit Verbindung und Tabellenroute zeigte ebenfalls keinen Überlauf.
6. Dokumentation: Das Handoff ist ehrlich (Testzahlen 13/62 und 10 + 2 stimmen; offener echter Lauf benannt). Es sollte
   nach diesem Review den echten Lauf als „durch Reviewer belegt“ führen und F1–F3 als bekannte Lücken aufnehmen.

## Empfohlene Reihenfolge

F1 und F2 vor dem ersten Feature-Paket (Autor oder Integrations-Agent); F3 bis F5 im selben Zug oder als Folgeticket;
F6 mit dem i18n-Paket.
