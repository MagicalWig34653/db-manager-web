# W-P16 Web: SQL-Verlauf und Lesezeichen

Stand: 25.10.2026. Branch `feat/w-p16-web`, Basis `c14271e`. Umsetzung im
zugewiesenen Worktree, noch uncommittet und nicht integriert. Keine Git-Schreibbefehle;
Commit, unabhängiges Review und Integration liegen beim Lead. Zentrale STATUS-/
ARBEITSPLAN-Dateien unverändert.

## Ergebnis und Dateibesitz

- `src/lib/features/sql-editor/storage.svelte.ts`: versionierter lokaler Speicher,
  standardmäßig ausgeschalteter Verlauf, explizites Opt-in pro Quelle,
  Fehlerbehandlung für Zugriff/Quota/ungültige Daten, flüchtiger Ersatz bei fehlendem
  Storage oder Web Crypto. Verlauf beim Start einer SQL-Anfrage, auch bei späterem
  Fehler/Abbruch; keine Ergebnisse oder Erfolgsbehauptung im Verlauf.
- `src/lib/features/sql-editor/SqlLibraryPanel.svelte`: Datenschutzhinweis,
  Verlaufsschalter, Suchfeld, Wiederherstellen ausschließlich in den Editor,
  Einzel-/Gesamtlöschung beider Listen, benannte Lesezeichen, JSON-Import/-Export.
  Speichern und Import sind die ausdrückliche Zustimmung zur Lesezeichenablage;
  sie aktivieren den Verlauf nicht. Während SQL läuft ist Wiederherstellen gesperrt.
- `src/lib/features/sql-editor/{storage,components,runner}.test.ts`: elf neue
  Unit-/Komponentenfälle, einschließlich ausgefallenem Speicher, Größen-/Anzahlgrenzen,
  Quota, ungültigen Imports, Löschung, Quellentrennung, Zugangswerten und
  tatsächlichem Ausführungspfad. Text wird als Text gerendert, kein `{@html}`.
- `tests/browser/sql-editor.spec.ts`: drei neue Browserfälle für Opt-in,
  Tastaturausführung, Wiederherstellen ohne Ausführung, Neuladen, Quellenwechsel,
  Suche, JSON, Löschung, fehlenden Speicher und 320 px. Geschrieben, hier nicht gelaufen.
- `src/lib/i18n/de.ts`: ausschließlich neuer angehängter Block `sqlEditor.*`.
- `docs/decisions/ADR-W-P16-browserlokaler-sql-komfort.md`: Ablage-/Grenzenentscheidung
  und die gegenüber dem umfassenderen Root-Plan ausdrücklich begrenzte Umsetzung.

Minimale Shell-Anbindung statt neuer Registry-Reiter: `SqlTab.svelte` importiert und
montiert das Feature-Panel (12 zusätzliche formatierte Zeilen). Die Komponente setzt
beim Übernehmen nur `sql.sql` und fokussiert das vorhandene Feld. Bestehende
Zeilennummern, Tab-Einrückung, Strg-/Cmd+Enter bleiben erhalten. Zusätzlich
`src/lib/shell/sql.svelte.ts`: ein Import und ein Aufruf im zentralen `execute()` nach
der bestehenden Startprüfung. Dieser kleine Hook erfasst Knopf und Shell-Kürzel
auch dann gleich, wenn das SQL-Panel nicht montiert ist. Keine Erweiterung der
Registry oder der Tabellen-/Serveransichten erforderlich.

## Daten- und Sicherheitsverhalten

Schlüssel `db-manager.sql-editor.v1.<SHA-256>` über Origin/Treiber/Datenbank und bei
Netzwerkquellen Host/Port/Benutzer. Keine Verbindung wird serialisiert; Passwort,
Token und Verbindungsanzeigename fehlen auch im Schlüsselmaterial. Der Hash ist
keine Verschlüsselung. Quellen bleiben getrennt, Passwortrotation behält die
Zuordnung. Das persönliche Browserprofil ist keine Konto-/Mandantentrennung.

Maximal 200 Einträge je Liste, zusammen unter 512 KiB UTF-8-JSON je Quelle;
einzelne SQL-Texte höchstens 100.000 Zeichen und innerhalb des Bytebudgets.
Älteste Einträge entfallen zuerst. Import validiert zunächst alles und hängt erst
danach an; bei falscher Version, ungültigen Einträgen oder Grenzüberschreitung bleibt
der bestehende Stand erhalten. Zusätzliche Importfelder werden nicht übernommen.
Export enthält nur Namen, SQL und Zeitpunkte der Lesezeichen, keine Opt-ins oder
Verläufe. Ausschalten löscht den Verlauf; bei leerer Lesezeichenliste wird auch der
Speicherschlüssel entfernt. Fehlgeschlagene Löschung wird sichtbar gemeldet.

Aktive Passwörter/Tokens werden als Werte und häufige SQL-Zugangskonstrukte als
Muster beim Hinzufügen abgewiesen. Das erkennt keine beliebigen Geheimnisse in
SQL oder Lesezeichennamen. Sensible fachliche SQL-Werte können nach Opt-in im
Klartext gespeichert werden; darauf weist die Oberfläche vor dem Speichern hin.
Keine SQL-Ausführung beim Laden, Import oder Übernehmen. Keine neue API,
Migration, Abhängigkeit, Lockfile-, Lizenz- oder Noticeänderung. Kein `npm install`.

## Tatsächliche Prüfungen

Stand 26.10.2026, Branch `feat/w-p16-web`, Basis Web-main `c14271e` (`git merge main`: bereits aktuell).
Kein neuer Backend-Vertrag nötig (reines Weblokal-Paket nach docs/PWA-PLAN.md; bestehender Vertrag v11 unverändert).

- `npm run check`: 0 Fehler / 0 Warnungen. `npm test`: 34 Dateien / 317 Tests bestanden.
  `npm run format:check`: bestanden.
- `npm run test:browser -- tests/browser/sql-editor.spec.ts`: 3/3 bestanden. Spec angepasst: Verbinden vor
  der Verkleinerung auf 320 px (Button lag bei 320 px außerhalb des Viewports; Shell-Eigenschaft).
- `npm run build` und `npm run test:csp`: bestanden (2/2). Gesamte Browsersuite nicht ausgeführt.

## Offene Punkte und nächster Schritt

- Unabhängiges Review und Integration stehen aus. Keine echten Backend-/DB-Läufe nötig (nur lokal).
- CodeMirror 6 ist vorab freigegeben, aber nicht installiert: eigener späterer Schritt inklusive MIT-Inventar/Notices
  und CSP-Abnahme. Syntaxfarben, Formatierung, Katalogvervollständigung und Variablen fehlen weiterhin.
  Keine vollständige Abnahme des umfassenderen Root-W-P16 behauptet.
- Allgemeine Einstellungen/Übertragung (PMA-UX-003/004) und Navigationsoptionen (PMA-NEU-NAV-001/002) nicht Umfang.
- Keine Geräte-/Kontensynchronisation; parallele Fenster derselben Quelle können sich überschreiben.
