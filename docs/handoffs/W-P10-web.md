<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Handoff W-P10 Web: Tabellenwartung (API 0.10)

Stand: 25.10.2026. Branch `feat/w-p10-web`, Basis `web-main` `c14271e`.
Uncommittete Paketdateien; keine Git-Schreibbefehle, Installation oder Integration.
Commit und unabhängige Review vor Integration durch den Lead.
Zentrale STATUS-/Planungsdateien bleiben beim Lead.

## Ergebnis und Dateibesitz

- `src/lib/features/maintenance/`: selbst registrierte Tabellen- und Datenbankreiter
  `wartung`, gemeinsames Panel, Client, Zustandsmaschine, Modell, synthetische Testhelfer,
  Unit-/Komponententests und 83 unveränderte Vertragsfixtures.
- `src/lib/contract/v10/`: kanonischer Vertrag, generierte Typen und Standalonevalidatoren,
  `provenance.json`. Backend-HEAD `c331c642fa4957747845458b079cffc32f6b1ff6` und dessen
  Arbeitskopie separat geprüft: SHA-256 jeweils
  `077a0e0222963b112bd6ea528ef5668d2ff7fbe2b2d3555669487c4beaf55cc5`.
  Ältere generierte Vertragsdateien unverändert.
- `src/lib/i18n/de.ts`: ausschließlich Block `maintenance` am Ende des Katalogs ergänzt.
- `tests/browser/maintenance.spec.ts`: Plan, Bestätigung, falscher Name, zwei Klicks,
  Navigations-/Hashsperre während des Requests, Abschluss-/Unknownsperre, 320 px.
- `tests/real/maintenance.spec.ts`: echte SQLite-/PostgreSQL-Wartung, Sondername,
  CHECK/ANALYZE bzw. ANALYZE/VACUUM/REINDEX, getippte Bestätigung, ein Request,
  unabhängiges Nachlesen von Ziel- und Nachbartabellendaten.
- Shell, Paketdateien und bestehende Featurebereiche unverändert. Keine neue Abhängigkeit,
  Migration, persistierten Zugangsdaten, SQL-Fragmente oder HTML-Injektion.

## Verhalten

Tabellenreiter wählt die aktuelle Basistabelle vor. Datenbankreiter lässt bis zu
50 Katalogtabellen auswählen; Sichten sind ausgeschlossen. Eine Aktion pro Stapel,
keine doppelten Tabellen. Sieben Vertragsaktionen einschließlich REINDEX, VACUUM
optional FULL/ANALYZE. Statische Fähigkeiten kommen aus `/api/v10/capabilities`;
`unsupported` deaktiviert die Aktion, alle Backendgründe und Einschränkungen bleiben
sichtbar. Tabelle/Engine/Rechte werden erst durch den Backendplan verbindlich geprüft.

Plan zeigt jeden Eintrag einschließlich Ablehnungen, exakte Anweisung, Hash,
betroffene Objekte und Backendwarnungen. Zusätzlicher Hinweis zu Laufzeit, Sperren,
CHECKSUM-Vollscan, fehlender gemeinsamer Transaktion und Abbruch ohne Rollbackgarantie.
Alle geplanten Einträge benötigen eine bewusste Checkbox; verlangt der Plan einen
getippten Namen, muss dieser für jeden Eintrag exakt stimmen. Abgelehnte Planeinträge
werden sichtbar behalten und beim Execute ausgelassen. Das Execute verwendet die
Katalognamen aus dem Plan und die ursprünglichen Optionen. Das Standardzeitbudget
von 10 Sekunden gilt jeweils für den gesamten Plan-/Ausführungsrequest.

Die Zustandsmaschine setzt die Ausführungsphase vor dem ersten await. Ein Execute,
keine Wiederholung; jeder Ausgang sperrt den Stapel bis „Neue Wartung vorbereiten“
und frischer Planung/Bestätigung. Plan-/Ergebnisanzahl und Zuordnung werden zusätzlich
zum Schema geprüft. Ungültige, unvollständige oder fremde Ergebnisse nach Dispatch
bedeuten unbekannten Ausgang. Verlustlose Prüfsummen als Dezimalzeichenfolge,
Dauer, feste deutsche Gründe pro Tabelle und Teilerfolg werden angezeigt; keine
rohen Engine-Diagnosen (der Vertrag liefert keine Nachrichtenliste).

`onwritephase` nutzt den von der Shell gelieferten Tabellen-/Datenbankempfänger,
bei Execute eingefroren. Jede versandte Anfrage meldet `sending` und genau eine
Endphase (`settled`/`unknown`), auch bei verworfener Antwort. Die vorhandene
W-P07-Shell sperrt Navigation/Hash und schützt vor Seitenverlassen. Andere laufende
Schreibaktionen sperren Planung und Bestätigung. Token-, Verbindungs-, Objektwechsel
und Unmount verwerfen verspätete Antworten und löschen Entwürfe/Bestätigungen.

## Prüfstand

- `npm run contract:generate`: bestanden, offline mit vorhandenem `node_modules`.
- `npm run validators:generate`: bestanden.
- `npm run contract:check`: alle elf Vertragsstände einschließlich Validatorbytes aktuell.
- `npm run check`: 0 Fehler, 0 Warnungen (nach Korrektur von vier ausschließlich
  testseitigen Testing-Library-Optionsfehlern).
- `npm run format:check`: bestanden.
- `git diff --check`: bestanden (nur lesend).
- `python3 scripts/check-docs.py`: 535 Dateien, 0 Fehler.
- Direkter Node-Lauf über die generierten v10-Validatoren: alle 83 positiven/negativen
  Wartungsfixtures bestanden.
- `npm test -- src/lib/features/maintenance`: Standard-Forklauf ohne Ergebnis nach
  mehreren Minuten mit Ctrl-C beendet (Exit 130); keine Aussage über Testerfolg.
- `npm test -- --pool=threads --maxWorkers=2 --no-file-parallelism`: bestanden,
  **33 Dateien / 409 Tests**, Exit 0, 76,53 Sekunden. Enthält neue Unit-/Komponententests
  für Vertragsfixtures, Transport-/Schemafehler, Bestätigungs-/Einmal-Ausführung,
  Teilerfolg, veraltete Antworten, 50er-Grenze, Optionen, Schreibsperre,
  reine Textausgabe und verlustlose Prüfsumme. Zwei Vite-Hinweise zum Laden virtueller
  CSS-Module (`PlanPreview`, `MaintenancePanel`); keine fehlgeschlagenen Tests.

## Offen / Grenzen

- Browser-, CSP-, PWA- und echte Backend-/DB-Läufe nicht ausgeführt (vorgegebene
  Sandbox-/Socket-/Dockergrenzen). Die neuen Browser-/Echtlaufspezifikationen sind
  geschrieben, aber nicht als lauffähig oder bestanden abgenommen.
- Kein neuer Echtlaufstarter: Echtlaufspezifikation benötigt separat bereitgestellten
  isolierten Backend-/Webstand sowie `DBM_REAL_CONFIG` analog bestehendem
  `playwright.real.config.ts` (baseURL, backendURL, token, postgresPort, password,
  outputDir); SQLite-ID `maintenance_fixture`, PostgreSQL-Datenbank `f3_probe`.
  Beispiel nach Aufbau: `DBM_REAL_CONFIG=<temporäre Konfiguration> npm exec -- playwright test
  --config playwright.real.config.ts tests/real/maintenance.spec.ts`.
- Kein Browser-Echtlauf MySQL/MariaDB; deren Fähigkeiten, Enginegrenzen und Prüfsummen
  nur über Vertragsfixtures/Unit-/Komponentenrepräsentationen geprüft.
- Produktionsbuild nicht ausgeführt: vorhandener Provenienzwächter verlangt
  committete Produktdateien, Git-Schreiben ist diesem Worker untersagt.
- Unabhängige Webreview, Leadcommit, Einbettung und Releasepin stehen aus.

Nächster Schritt: unabhängige Webreview, danach Commit durch den Lead und
Browser-/Echtlaufgates in geeigneter Umgebung. Keine eigenen Prüfjobs mehr aktiv.
Keine eigenen Browser-, Backend- oder Dockerressourcen gestartet.
