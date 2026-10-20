# Status

Stand: 20.10.2026. F1/F1b als Webclient-Inkrement nach unabhängiger QA und CI integriert.
Svelte5/shadcn-svelte-Workbench mit flüchtigem Backendzugang/Verbindungseditor,
Objektnavigation, SQL-Einzelanfrage, präzisen typisierten Ergebnissen, Abbruch und
Zeilenbegrenzung. Keine Credentialpersistenz und kein vorgetäuschter DB-Erfolg.

## Nachweise

- Quelle `4e5abee074d34853b266f20c344f28517d7924d1`, per FastForward in main erhalten.
- API0.1.0 aus Hauptcommit `80f203b3e0c7fa3f7f4aa5ec06825cb83bc0c5d0`, SHA256
  `4b598dc69a1904685e67a717997412654440ac10f47c17f7a025ccd114e294be` exakt gepinnt.
- Unabhängige QA: Cleanclone/npmci, Typecheck ohne Fehler/Warnungen, Format-/Vertrags-
  und Validator-Byteprüfung, 15 Unit-/Komponententests, Build/Notices und Browserfälle.
  Sechs funktionale Chromiumfälle sowie gesonderter Produktions-CSP-Test belegt.
- Tokenwechsel-/Altantwortbefund und falsche Null-Zeilenzahl korrigiert und unabhängig
  nachgeprüft. Typisierte Integer/NULL/Leer/Binärwerte, Escaping und flüchtige Sitzung geprüft.
- Standalone-Validatoren buildzeitlich generiert; tatsächlicher Query-/Fehlerpfad unter
  `script-src 'self'` ohne unsafe-eval/InlineScript und ohne CSP-Verletzungen geprüft.
- [Frontend-CI](https://github.com/MagicalWig34653/db-manager-web/actions/runs/39491706244)
  und [Dokumentations-CI](https://github.com/MagicalWig34653/db-manager-web/actions/runs/39491706204)
  am integrierten Quellcommit erfolgreich. Vollständige Abhängigkeiten inventarisiert.

## Grenzen und Fortsetzung

Die F1-Abnahme verwendet explizite Mock-API-Fixtures. F2a/F2b sind inzwischen im
Hauptrepo nach unabhängiger QA integriert: reproduzierbares Go-Webpaket und echter
Browser→Go→SQLite/PostgreSQL-TLS-Pfad, beobachtete Abbruchfreigabe sowie Compose-/
isolierte-Swarm-Neustartpersistenz. F2b-Quelle `f2c92ee`/`c9ced80`, integriert als
`df0b291`/`c7e1a1d`, zentraler Hauptrepo-Abnahmecheckpoint `c706741`. Öffentliche
[Webpfad-CI](https://github.com/MagicalWig34653/db-manager/actions/runs/39495523677)
sowie Backend-/Engine-/Dokumentations-CI am Kandidaten erfolgreich.
Keine vollständige Parität, Dateneditor-/Schema-/Import-/Vault-/Teamfunktionen.
Backendtoken und DB-Passwörter nur im Speicher; Reload/Sessionwechsel verwirft sie.
Abbruch verspricht keinen Rollback bereits erfolgter Datenbankeffekte.

F1-/F2-Worktrees bleiben saubere Provenienz. F3 startet im Webrepo-Worktree
`.worktrees/table-workbench`, Branch `feat/table-workbench`, Basis `ec8dcea`.
Zuerst sichtbare Quellcode-/Lizenzverweise mit tatsächlicher Buildherkunft;
Tabellenmetadaten/-ansicht mit ausdrücklich freigegebenem API0.2.0-Vertrag.
Herkunft `427444d7bcb8e30c9563ded2000ec3d5e19646c4`, Schema-SHA256
`c15a848f01bb779429fd68a2b6eb6bba1575d3e07a4c68e6796cf7840a661838`.
Besitz Produkt-/Build-/Vertrags-/Test-/Lizenzdateien, README/Einrichtung/Handoff;
STATUS/ARBEITSPLAN gehören Lead. Keine Mutation oder Credential-/SQL-Persistenz.
Keine eigenen F1-Browser-/Vitejobs offen. [Handoff F1](handoffs/F1.md),
[Handoff F1b](handoffs/F1b.md), [Einrichtung](../EINRICHTUNG.md).
