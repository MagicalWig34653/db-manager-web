# F4 – unabhängiger QA-Review

Prüfung: 23.10.2026, QA & Release Engineer, eigener Branch `review/f4` und Worktree
`.worktrees/f4-review`. Geprüfte unveränderliche Produktquelle:
`3a4a3fd0a345f8c127758ac5eadc4e6feb8d21ec`, Basis `ffdd2a0`.
Dieser Commit dokumentiert ausschließlich den Review; keine Produktänderung.
[Autorenübergabe](F4.md).

## Urteil und Grenzen

Keine bestätigten Findings. F4 als Webquelle mit bestätigtem Einzelzeilen-Insert,
Update und Delete ist freigegeben. Derselbe unveränderte Produktcommit darf als
Quelle des separat zu prüfenden F4b-Pakets verwendet werden. Daraus folgt noch kein
Root-Artefaktpin, Go-Embed-/Container-/Compose-/Swarm-Schreibnachweis oder vollständige
Produktfreigabe. Keine Paritäts-, Vault-, Persistenz-, Exactly-once- oder allgemeine
Rollbackgarantie.

## Unabhängig ausgeführte Prüfungen

- Frischer eigener Gitworktree am exakten Quellcommit: `npm ci --no-audit --no-fund`,
  `npm run check` (0 Fehler/0 Warnungen), `npm test` (26 Tests),
  `npm run contract:check`, `npm run format:check` und `npm run build` bestanden.
- Vier OpenAPI-Dateien bytegleich mit dem Backendcommit
  `72855cf57ceb6620dead42856ee6c9d52d0612bd`; vier Typ- und Standalonegeneratoren
  ohne Drift. Keine Änderung an Lockfile, AGPL-Original oder Drittanbietertexten.
  Ausgelieferte Lizenzdateien bytegleich, keine Sourcemaps oder privaten Pfade.
- Sechs bestehende funktionale Chromiumfälle und zwei Produktions-CSP-/Quelllink-/
  Originaltextfälle bestanden. Script-CSP ohne Inline-Script oder unsafe-eval erhalten.
- `python3 scripts/test-real-tables.py`: sechs echte Chromiumfälle gegen frisch
  öffentlich ausgechecktes, gepinntes Go-Backend bestanden. SQLite und PostgreSQL
  verify-full, positive TLS-Probe vor falschem Hostnamen, deterministische
  Bootstrap-/TCP-Barriere. Zwei unveränderte F3-Fälle und vier neue Zeilenfälle.
- Tatsächliche Defaults, NULL/Leertext/Binär/Präzision und Auto-PK, vollständiger
  Originalsnapshot, PK-/Generated-Sperren, frische Eignung, bestätigtes Update/Delete,
  parallele Fremdänderung mit 409 und kein Überschreiben sowie View/noPK-Sperren geprüft.
  Zwei synchrone Bestätigungsklicks erzeugen genau einen Mutationsrequest.
- Antwortverlust erst nach tatsächlich bestätigtem Commit: echte Requestweiterleitung,
  Antwort verwerfen und unabhängig gespeicherte Einzelzeile nachlesen; kein Retry.
  Tokenwechsel während zurückgehaltener Commitantwort reaktiviert keine alten
  Tabellen, Ergebnisse oder Editorwerte. Generischer Unknown-Hinweis bleibt erlaubt.
- Zwei zusätzliche temporäre Unitproben bestanden: mehr als 1 MiB UTF-8-Requestbytes
  trotz zulässiger Zeichenanzahl werden vor Dispatch und Fetch abgewiesen; eine
  über 8 MiB große Erfolgsantwort wird nach genau einem Dispatch als unbekannter
  Ausgang behandelt. Temporäre Prüfdatei anschließend entfernt.
- Diffreview: Generation-/Abort-Grenzen, flüchtige Credentials/Entwürfe, sichere
  Textdarstellung, feste Same-origin-APIpfade, Bodylimits und ehrliche
  Unknown-/Konfliktzustände ohne automatische Wiederholung geprüft.

Die JavaScript-Chunkwarnung bei ungefähr 724 kB ist bekannt; Build erfolgreich.
Dokumentations- und Diffprüfung dieses Reviewcommits bestanden.

## CI und Ressourcen

Autoritative GitHub-Abfrage am 23.10.2026: alle drei Läufe erfolgreich und jeweils
am exakten Produkt-SHA oben:
[Tabellen-/Zeilenintegration](https://github.com/MagicalWig34653/db-manager-web/actions/runs/39505374170),
[Frontend](https://github.com/MagicalWig34653/db-manager-web/actions/runs/39505374020),
[Dokumentation](https://github.com/MagicalWig34653/db-manager-web/actions/runs/39505373955).

Alle eigenen Prüfprozesse und Wegwerf-DB-/TLS-/Credential-/Backendcheckout-Ressourcen
beendet beziehungsweise entfernt. Vier bestehende fremde Entwicklungscontainer
unverändert; keine Hostswarm-/OS-Rechte-/Truststoreänderung. Keine offenen QA-Jobs.
Nächster Schritt: Leadintegration der geprüften Webquelle und gesonderter F4b-Auftrag.
