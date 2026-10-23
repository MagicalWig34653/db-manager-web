# Status

Stand: 23.10.2026. F1/F1b als Webclient-Inkrement nach unabhängiger QA und CI integriert.
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
sind Webprodukt; F3b ist inzwischen nach unabhängigem Review im Go-Hauptrepo integriert
(`0767969`/`22fdf78`/`cc175a5`/`5cb604a`, zentraler Stand `f46cafe`).

F3b bestanden: zwei bytegleiche öffentliche Builds, fünf echte Browserfälle,
Compose und isolierter DinD-Swarm samt SQLitepersistenz, Go-Race/Vet und sauberer
Go-/Imagebuild ohne Node/npm zur Laufzeit. Alle sechs Feature-CIs erfolgreich;
kombinierte Haupt-CIs an f46cafe noch kontrollieren. Keine Mutationsoberfläche im
freigegebenen F3.

F4 ist am 23.10.2026 nach unabhängigem P0-Review ohne Findings integriert.
Freigegebene unveränderliche Quelle: `3a4a3fd0a345f8c127758ac5eadc4e6feb8d21ec`.
Alle drei exakten Quell-CIs erfolgreich; unabhängiger Review
`01933d5c247dd790748e7733b56e5eea12008d55` bleibt in main-Ancestry.
[Review](handoffs/F4-review.md), [Autorenhandoff](handoffs/F4.md).
Einzelzeilen-Insert/Edit/Delete mit gültigen v4-Fähigkeiten und frischer v3-Eignung,
vollständigem typisiertem Snapshot, gesperrten PK/generated-Zielspalten, bestätigten
Aktionen und echter Nachherzeile. Kein automatischer Retry; Konflikt fordert Neuladen,
Transportverlust nach Versand meldet möglichen Commit. SQL/v2 bleiben auf älteren
Backends nutzbar, neue Schreibaktionen gesperrt. Credentials/Entwürfe bleiben flüchtig.
26 Units, sechs echte SQLite-/PostgreSQL-TLS-Browserfälle einschließlich tatsächlicher
Commitantwortverluste, sechs SQLregressionen, zwei Produktions-CSP-/Originalnoticefälle
und sauberer öffentlicher Build unabhängig geprüft. Keine vollständige Parität.

F4b übernimmt anschließend im eigenen Rootworktree die exakt freigegebene Quelle;
Rootartefakte, tatsächliche CRUD-Compose-/isolierte-Swarm-Persistenz und unabhängige
QA stehen dafür separat aus. Neue Web-main-CIs nach Integration kontrollieren.
Lead koordiniert; Frontend & UX besitzt für dieses Release exklusiv diese beiden
Web-Status-/Planungsdateien. Keine weiteren Produktänderungen nach Quellpin.

## F6 – lokaler Ergebnisexport, Prüfkandidat

Stand23.10.2026: eigener Branch `feat/result-export`, Basisbf75748. JSON mit
versioniertem explizitem Snapshot erhält geordnete doppelte Spalten und getaggte
Zellen; CSV mit offengelegter NULL-/Quote-/Typverlustkonvention sowie bewusst gewählter
Apostroph-/Rohwertvariante. Ausschließlich expliziter lokaler Download des aktuell
angezeigten SQLergebnisses oder geladenen Seitenumfangs, keine neue DBabfrage.
Keine Credentials-/SQL-/Profilserialisierung oder Persistenz. Limit8MiB fertigeUTF8Bytes.
Frontend & UX besitzt exklusiv diese WebSTATUS/Plan-Dateien. Implementierung und reine
Tests vorhanden; echte Browserdownloads, sauberer Build/CI und unabhängige QA folgen.
Kein Rootpin/API0.5-Verbrauch. [Handoff](handoffs/F6.md).

F6 lokaler Prüfcheckpoint:34Units/Typecheck0/0/vierVerträge/Standalone/Format/Docs118/0,
sechsLegacySQLbrowser undzweiProduktionsCSPfälle grün. Acht echteSQLite-/PGverify-full-
Browserfälle inklusive tatsächlicherDownloadinhalte, Requestzählung, Trunkierung/
Seitenumfang, BlobURL-/Tokenwechsel und bestehenderCRUD-/Konflikt-/Unknownregression
bestanden. NochkeineunabhängigeQA/Integration; öffentlicherBuild/CI folgen.

F6 zur unabhängigenQA bereit: öffentlicherKandidat1e2fbb6, HandoffF6. Acht echteFälle
inklusiveDateiinhaltsprüfung erstnach sofortigemTokenwechsel/BlobURLwiderruf in16,4s
grün. Frischeröffentlicher893Checkout npmci/Typecheck34Units/Format/Verträge/Build/
Originalnotices/Docs118/0 bestanden;1e2 ergänzt nur engenBrowsertest. FinaleCI:
Docs39903194991success, Frontend39903195022 undEchte39903194959aktiv. Keineoffenen
lokalenJobs/Ressourcen. KeineeigeneFreigabe/Integration;RootpinF6b separat.

QA-F6-01 (niedrig) aus unabhängigem Reviewcd384326: CSV-Steuerzeichen-/Consumergrenze.
Enger Autorenfix298d080/294bf07 lehnt C0 außer CR/LF, DEL und C1 in Headern/Werten
beider CSVvarianten vor Blob/Download ab; empfiehlt unverändertes JSON. Zunächst
rote Regression am unveränderten Code gesichert.37Units/Typecheck/Format/Verträge/
Build/Docs118/0 und8echteSQLite-/PG-Browserfälle15,9s grün; JSON exakt, CSV-CR/LF/
Quotes/Literalmarker erhalten. Code eingefroren; unabhängige P0-Nachprüfung und
exakte Fix-CI offen. Keine Selbstschließung des Findings, kein neuer Rootpin.
