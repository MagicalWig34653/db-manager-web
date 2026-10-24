# Review W-P06 Web: Übersicht, Definition, Serverinfo (API 0.7)

Unabhängiger Review von `feat/w-p06-web` (`08e0804`, Basis `main` 6cb9613). Review-Branch `review/w-p06-web`, eigener
Worktree, `node_modules` als `cp -cR`-Kopie. Autorenbranch unverändert, nichts auf `main` gemergt.

## Urteil

**Nicht freigegeben, bis F1 behoben ist.** Der echte SQLite-Lauf gegen das Root-Backend (`main`, 5921a9d) ist in 4 von 5
Versuchen fehlgeschlagen: die Serverübersicht zeigt für SQLite „Datenbanken nicht verfügbar“, weil die Oberfläche
Serverinfo und Datenbankliste gleichzeitig anfragt (F1). Alles andere (Vertrag, Validierung, Kennzeichnung geschätzt/exakt,
Sicherheit) ist in Ordnung.

## Prüfungen (nacheinander, Review-Worktree)

| Befehl | Ergebnis |
| --- | --- |
| Vertragskopie | `src/lib/contract/v7/api-v0.7.0.json` SHA-256 `c6fd8c91315e25185d949d309397c7c0d80cc67fcab87ae521e38068e7004d17`, byteidentisch zu `contracts/api-v0.7.0.json` (Root `5921a9d`); `provenance.json` (Quelle `9f44a7c`) passt |
| Vertragsfixtures | 32 Dateien; 30 byteidentisch, 2 PostgreSQL-Definitionsfixtures nur durch Prettier umformatiert (Array in eine Zeile), Inhalt gleich (F5) |
| `npm run contract:check` | Typen und Validatoren aller Stände aktuell |
| `npm run check` | 0 Fehler, 0 Warnungen |
| `npm test` | 18 Dateien, 90 Tests |
| `npm run format:check` | bestanden |
| `npm run test:browser` | 17 bestanden |
| `npm run test:csp` | Build + 2 bestanden |
| `scripts/test-real-overview.py` (`DBM_BACKEND_REPO=<Root>`, `DBM_BACKEND_REV=main`) | PostgreSQL 18.6 verify-full: bestanden; **SQLite: 4 von 5 Läufen fehlgeschlagen** (Locator `database-table` bzw. `server-facts` nicht sichtbar; Host-Last 25 bis 40) |
| `scripts/test-real-tables.py` | 10 Bestandsfälle bestanden; 2 fehlgeschlagen: `tests/real/overview.spec.ts` läuft mit und findet die eigenen Fixtures nicht (F2) |

Ein Debug-Lauf (temporär, Spec nicht committet) zeigte auf der SQLite-Serverseite: Serverinfo „Eingeschränkt“ geladen, im
Bereich Datenbanken die Fehlermeldung „Diese SQLite-Datenbank wird gerade verwendet. Warte auf die laufende Anfrage oder brich
sie ab.“ (Code `database_busy`) mit „Erneut versuchen“.

## Befunde

### F1 (hoch) Parallele Anfragen gegen SQLite liefern `database_busy`: Datenbankliste fehlt, echter Lauf rot

Beleg: `ServerInfoPanel.svelte` `load()` startet `serverInfo` und `databases` mit `Promise.all`; SQLite erlaubt je Datenbank nur
eine laufende Anfrage (Backend meldet sonst `database_busy`). Gleichzeitig läuft nach dem Verbinden noch der Katalog der
Shell. Ergebnis: ohne Wiederholung fehlt die Liste; unter Last (Test) fast immer, auf einem schnellen Rechner wohl
selten, das Handoff meldet daher einen einmal grünen Lauf. Auch `ObjectsTab`/`DefinitionTab` können mit einer parallelen
Katalog-/SQL-Anfrage kollidieren (kleineres Risiko, dort sequentiell nach Capabilities).
Fix: Anfragen je Verbindung nacheinander ausführen (erst Serverinfo, dann Datenbanken), `database_busy` einmal nach kurzer
Pause automatisch wiederholen (nur lesend, daher unbedenklich) und die Meldung mit Wiederholen behalten. Test: Mock, der
bei Gleichzeitigkeit `database_busy` liefert; echter Lauf mehrfach grün.

### F2 (mittel, Integration) `test-real-tables.py` führt den neuen Echt-Spec mit aus

Beleg: `playwright.real.config.ts` hat `testDir: ./tests/real` ohne Dateiliste in `test-real-tables.py`; `overview.spec.ts`
erwartet die Fixtures von `test-real-overview.py` (`p06_fixture`/`p06_probe`) und schlägt im Lauf des Bestandsrunners fehl
(2 von 12). Das Handoff nennt den Lauf „nicht ausgeführt“. Gleiches gilt für W-P05 (`table-create.spec.ts`). Nach dem Merge
beider Branches wären es 4 Fehlschläge im Bestandsrunner.
Fix: `test-real-tables.py` mit expliziter Liste der Bestandsspecs aufrufen (`export`, `rows`, `structure`, `table`) oder
Runner über `testMatch` aus der Konfiguration trennen.

### F3 (niedrig) Änderung an `ServerOverviewTab.svelte` (bewertet)

Die drei Zeilen sind minimal und funktional richtig (`token` durchreichen, `ServerInfoPanel` einbinden; Reiter `uebersicht`
ist durch den eingebauten Tab belegt). Nachteile: die Shell importiert damit aus einem Featurepaket (umgekehrte
Abhängigkeit, verletzt das Dateibesitz-Modell der Registry; ein Feature-Fehler im Panel liegt zudem außerhalb der
`FeatureHost`-Grenze des Serverreiters nicht, da der Tab selbst in `FeatureHost` läuft, also eingedämmt), und die
Kopfzeilen „Treiber/Datenbank“ erscheinen doppelt (alter Block plus Panel). Akzeptabel; sauberer wäre ein Slot für
Server-Abschnitte in der Registry.

### F4 (niedrig) Weitere Beobachtungen
- `client.ts` enthält feste deutsche Fehlertexte (statt `t()`); alle Komponententexte laufen über `t()`.
- `{#each data.warnings as warning (warning)}` und `(database.name)`: doppelte Schlüssel (z. B. zwei gleiche Warnungen)
  würden in Svelte einen Laufzeitfehler auslösen; durch `FeatureHost` eingedämmt, besser Index als Schlüssel.
- „Weitere laden“ der Datenbank-/Objektliste ist nicht abbrechbar (Schutz nur über Vergleich von `connection`); bei Tokenwechsel
  wird die Sitzung ohnehin geleert, daher kein Datenleck.
- Copy-Knopf nutzt `navigator.clipboard` mit Fehlerrückmeldung; gut.

### F5 (info) Fixture-Formatierung
Zwei Postgres-Definitionsfixtures wurden durch Prettier umgebrochen (kein Inhaltsunterschied); die Vendor-Regel
„unverändert“ gilt dort nicht byteweise. Besser per `.prettierignore` ausnehmen.

## Prüfung nach Punkten

1. Vertrag: byteidentisch, Typen/Validatoren reproduzierbar (s. o.).
2. Sicherheit: kein `{@html}`, keine Storage-Zugriffe in `features/overview`; Namen, Kommentare, Definitionen, Warnungen und
   Fehlertexte nur als Text (`<pre>{data.definition}</pre>`); jede Antwort läuft durch die v7-Standalone-Validatoren, ungültige
   Antworten werden nicht angezeigt; Passwort nur im POST-Body, Links enthalten nur Namen (`formatRoute`); `Resource` verwirft
   verspätete Antworten per Generationszähler und bricht bei Verbindungs-/Tokenwechsel ab. Die teure Aktion „Zeilen exakt zählen“
   wird nur auf Klick gesendet, mit Limit 100 und Zeitgrenze 8 s.
3. Korrektheit: Zeilenzahl wird als „≈ … geschätzt“, „… exakt“ oder „unbekannt“ gekennzeichnet (Text plus Badge, nicht nur Farbe);
   unvollständige exakte Zählung wird gemeldet; Capability `limited`/`unsupported` zeigt den Backendgrund; Paging über „Weitere laden“
   mit Anzeige „x von y“. Fehler F1 betrifft die Datenbankliste.
4. Barrierefreiheit: Tabellen mit `scope`, `aria-sort`, `caption`; Sortierknöpfe; Definition als fokussierbarer `pre` mit Label;
   Status per `role=status`. i18n-Merge: Probemerge mit `git merge-tree`: W-P05 gegen `main`, W-P06 gegen `main` und beide
   Branches gegeneinander konfliktfrei (W-P06 fügt am Anfang, W-P05 am Ende von `de.ts` ein).
5. Doku: überwiegend ehrlich; „Echtlauf bestanden“ ist unter Last nicht reproduzierbar (F1); `test-real-tables.py` ist als offen
   genannt, hätte aber F2 gezeigt.

## Nachreview (`feat/w-p06-web` 87f0b70; eingemergt)

**Urteil: Freigabe.** F1, F3, F4, F5 sind geschlossen.

- F1 geschlossen: `ServerInfoPanel` fragt Serverinfo und Datenbankliste nacheinander; `Resource.run` wiederholt bei `database_busy`
  genau einmal nach 600 ms (nur lesend, bei Abbruch ohne Wiederholung). Echter Lauf `test-real-overview.py`: 4 von 4 Läufen
  (SQLite und PostgreSQL) grün, vorher 4 von 5 rot.
- F3 geschlossen: neuer Registry-Slot `server-section`; `ServerOverviewTab` lädt die Abschnitte per `loadFeatures` (lazy, kein
  Importzyklus) und rendert jeden in `FeatureHost` (Fehlerisolation). Doppelte Kopfzeilen entfernt. Rest: Abschnitte haben kein
  Capability-Gating (kein Feld in Verwendung, niedrig) und erscheinen asynchron nach dem Laden.
- F4 geschlossen: Texte über `t()`, Index-Schlüssel statt Namen, „Weitere laden“ mit `AbortController`.
- F5 geschlossen (Fixtures wieder byteidentisch bzw. dokumentiert, kein Inhaltsunterschied).
- Neue Befunde: keine.

## Probemerge aller drei Branches (Wegwerf-Worktree, `main` 6cb9613 + W-P05 bbe0f60 + W-P06-web 87f0b70 + PWA-Fix 7d14c80)

`git merge-tree` und tatsächlicher Merge: **keine Konflikte** (`de.ts`, `Shell.svelte`, `package.json`, `test-real-tables.py` sauber).
Läufe auf dem Merge-Stand, nacheinander: `contract:check` grün; `check` 0/0; `test` 23 Dateien, 145 Tests; `format:check` grün;
`test:browser` 25 bestanden; `test:csp` 2; `test:pwa` 6; `test-real-tables.py` 10 bestanden (inkl. `export.spec.ts` gegen das
Go-Backend, kein networkidle-Timeout mehr); `test-real-create.py` 2; `test-real-overview.py` 2 (insgesamt 4 Wiederholungen grün).
Backend: Root `main` (5921a9d). Der fremde Container `dbmanager-w-p07-…` gehört nicht zu meinen Läufen und wurde nicht angefasst.
