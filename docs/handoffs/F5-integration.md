# F5 – freigegebene Webintegration

Stand: 23.10.2026. Eigener Worktree `.worktrees/release-f5`, Branch
`release/f5-20261023`, Basis Main204cb07. Konkrete Leadfreigabe für das unabhängig
angenommene Feature samt Review und exklusiver WebSTATUS-/Planpflege.

## Provenienz und Grenze

Feature bis a5c687fa5ebdbc9332fc2ce8bce5f7cd7fe82132 mit Produktfix
8ef738d22a1164291e2c8183d80e72d1f043c0f8 als0e75e39 übernommen. Vollständige
Erst-/Fixreviewprovenienz bis469653dd6df9264f700275f045dc2b500dc2b1fc als4cbec59
integriert. QA-F5-01 unabhängig geschlossen; alle drei exakten Fix-CIs erfolgreich.
Der feste freigegebene Quellpin für separat geprüftes RootpaketF5b ist8ef738d.
Keine Produktkorrektur, Dependency-/Vertrags-/Originalnoticeänderung im Release.

Ein erster Gitmerge stoppte vor Sourceänderung mit „fatal: stash failed“.
Danach autoritativ sauberer Index, gültige Refs, keine Locks/Gitprozesse und
`git stash create` erfolgreich. Der terminal fehlgeschlagene Merge wurde mit
explizitem `--no-autostash` erneut ausgeführt und lief konfliktfrei durch.
Keine fremde Änderung verworfen, keine Refquarantäne oder belegte Ursachenbehauptung.
Der temporäre eigene Diagnosetrace außerhalb des Repositories wurde nach erfolgreicher Diagnose entfernt.

## Kombinierte tatsächliche Checks

Node26.5.0/npm11.17.0, unveränderter Lock:

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run contract:check
npm run format:check
npm run build
python3 scripts/check-docs.py
git diff --check
```

Typecheck0Fehler/0Warnungen,47Tests, fünf Typ-/Standalonebyteprüfungen, Format und
Produktionsbuild bestanden. Fünf Originalartefakte; bekannte Vitewarnung über etwa
958kBJS. Dokumentation vor abschließendem Handoff132/0, abschließend133 Dateien/0Fehler. Keine erneute volle Browser-/DBserie für unveränderte
Produktbytes; passende echte SQLite-/PG-TLS-/CSP-/Session-/F6-/CRUD-Nachweise und
gezielte Fixnachprüfung stehen im [unabhängigen Review](F5-review.md).
MySQL-/MariaUI bleibt auf Unitrepräsentationen begrenzt.

WebSTATUS/Plan zum tatsächlichen aktuellen Snapshot konsolidiert, historische
Befunde in Handoffs erhalten. Keine Root-/Apple-/Pagesdateien verändert; RootF5b
ist eigenes ungeprüftes Paket. Keine signierte oder sonstige Distribution aus
Webintegration ableiten. Neues Webmain startet eigene CI, deren Ergebnisse vorab
nicht als erfolgreich behauptet werden.

## Ressourcen und Fortsetzung

Keine eigenen Server-/Browser-/DB-/Dockerressourcen gestartet; npm-/Buildjobs
beendet, reine Caches bleiben. Bestehende Gitidentität erhalten, keine privaten
Daten veröffentlicht. Alte saubere Worktrees bleiben Provenienz.

Nächster Schritt: abschließenden Maincheckpoint veröffentlichen, exakte neue
Frontend-/Browser-/Docs-CI-IDs und tatsächliche Ergebnisse an Root melden.
WebSTATUS/Plan danach nur nach neuem ausdrücklichem Transfer bearbeiten.
Rootartefakte und Compose-/Swarmprüfung übernimmt separat der beauftragte Packager.
