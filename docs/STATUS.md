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

F3 nach vollständigem P0-Erstreview und unabhängiger P3-Fixnachprüfung integriert,
Merge `8ab07fb` erhält alle Originalquellcommits. QA-F3-01 (unsichtbarer verworfener
Filter nach ungültiger Sortierung) durch atomare Zustandsübernahme geschlossen;
Repro vor Fix auf beiden echten Engines rot, nachher einschließlich Weiter/Refresh grün.
Freigegebene unveränderliche Quelle für Rootpaket F3b:
`6c6eb33c93eed355a10cd114f61ce27be7f3f55e`. Alle drei Fix-CIs erfolgreich.
Integrierte Typecheck-/19-Unit-/Dualvertrags-/Produktionsbuildprüfungen bestanden.
Daten-/Strukturansicht, Sortierung/Filter/Pagination sowie Quellcode-/Lizenzdialog
sind Webprodukt; Root-Embed enthält bis F3b noch den vorherigen F1-Build.

F3b ist das nächste eigene Hauptrepo-Paket: reproduzierbarer neuer Webpin plus
enger TCP-/TLS-Readinessfix des Root-Testhelfers. Keine Mutationsoberfläche im
freigegebenen F3. API0.3.0 bleibt einem späteren eigenen Clientpaket vorbehalten.
F1-/F2-/F3-Worktrees bleiben saubere Provenienz, zentrale Dateien beim Lead.
Keine eigenen F1-Browser-/Vitejobs offen. [Handoff F1](handoffs/F1.md),
[Handoff F1b](handoffs/F1b.md), [Einrichtung](../EINRICHTUNG.md).
