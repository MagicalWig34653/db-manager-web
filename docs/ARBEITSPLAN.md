# Arbeitsplan

Stand: 23.10.2026. Nutzerfrist heute10:00 Europe/Berlin (08:00UTC) oder vorher
vollständiger Projektabschluss. Root koordiniert ausschließlich; Agents übernehmen
Implementierung, Dokumentation, unabhängige Prüfungen und freigegebene Integrationen.
Tatsächliche Ergebnisse und Grenzen: [STATUS](STATUS.md).

## Abgenommene Webpakete

| Paket | Umfang | Geprüfte Provenienz |
| --- | --- | --- |
| F1/F1b | SQL-/Sessionarbeitsplatz und CSPtaugliche Validatoren | HandoffsF1/F1b, Quelle4e5abee |
| F3 | Tabellenansicht, Filter/Sortierung/Pagination, Source-/Lizenzdialog | HandoffF3, Quelle6c6eb33, Filterzustandsfix geschlossen |
| F4 | Einzelzeilen-Insert/Update/Delete mit Konflikt-/Unknownregeln | Handoff/ReviewF4, Quelle3a4a3fd |
| F6 | Lokaler JSON-/CSVexport ohne DBneuabfrage | Handoff/ReviewF6, Quelle1a8adfa, CSVbefund geschlossen, Main204cb07 |
| F5 | Lesende Index-/Constraintstruktur auf API0.5 | Quelle8ef738d, Handoffa5c687f, unabhängiger Review469653dd, Leerbezeichnerbefund geschlossen; Feature-/Reviewmerge0e75e39/4cbec59 |

F5 ist auf konkrete Leadfreigabe unverändert integriert. API0.5-Kopie/Pin, Typen,
Standalonevalidatoren und Originalnotices bleiben exakt; keine API0.6-/DDLfunktion.
Das neue RootpaketF5b(F5+F6) verwendet ausschließlich den unveränderlichen Pin
8ef738d22a1164291e2c8183d80e72d1f043c0f8 nach eigener unabhängiger Abnahme.

## Aktuelle Releasegates und Besitz

1. Kombinierte F5-Releasechecks sind bestanden: npmci, Typecheck0/0,47Units,
   fünf Vertrags-/Standalonebyteprüfungen, Format, Build und Dokumentation.
   Neue exakte Web-Main-CIs nach Veröffentlichung kontrollieren; nicht voraussetzen.
2. Rootartefakte separat durch beauftragten Packager reproduzieren, zwei öffentliche
   bytegleiche Builds/Manifest/Originalnotices und echten eingebetteten Browserpfad
   SQL/Tabellen/Indexe/Constraints/CRUD/Export/Session prüfen. Compose und eigener
   isolierter Swarm mit typisierter SQLitepersistenz bleiben eigene F5b-Gates.
3. Erst nach Root-F5b-QA konkrete Agentintegration. Webmain bedeutet keine
   Veröffentlichung neuer Go-/Dockerartefakte. Keine Produktbytes nach akzeptiertem
   Quellpin ändern; neue Findings an Autoren, gezielte unabhängige Nachprüfung.
4. Neue Clientfunktion für akzeptierte API0.6-Tabellenanlage nur als eigenes Ticket,
   keine zufällige Kopie ungeprüfter Backend-/Geschwisterdateien. Weitere Funktionen
   aus vollständigem Hauptprojektziel separat zuschneiden.

WebSTATUS/ARBEITSPLAN sind für diesen begrenzten Integrationscheckpoint exklusiv
beim Releasekoordinator. Andere Worker schreiben nicht parallel. RootSTATUS/Plan
liegen beim dort beauftragten Dokumentations-Agent; Apple- und Pagesaufträge werden
von eigenen Agents bearbeitet. Jeder Writer eigener Worktree/Branch, passende
Prüfungen und unabhängiger Review vor Integration. Keine eigenen laufenden lokalen
Releasejobs oder Browser-/DB-/Dockerressourcen; reine Node-/Buildcaches dürfen bleiben.

## Verbindliche Grenzen und Übergabe

Deutsch für UI/Dokumentation, Englisch für Code/Tests/technische Bezeichner.
Eigener Code AGPL-3.0-only, unveränderte Drittanbietertexte/Inventare. Bestehende
Gitidentität erhalten. Keine Secrets, privaten Pfade oder echten DBverbindungsdaten
veröffentlichen. Frontendtoken/Passwörter/SQL/Entwürfe nur flüchtig, kein Browserstorage.
Keine automatischen Mutationsretries oder garantierte Rücknahme bei Abbruch.

Echte F5-Browserbelege SQLite/PostgreSQL; MySQL/Maria nur Unitrepräsentationen,
keine allgemeine Schema-/Geräte-/HA-/Paritätsfreigabe. Nicht ausgeführte Prüfungen
bleiben offen. Vor Zeitgrenze Dateistand/Commit, Tests/Befunde, unintegrierte Arbeit,
laufende eigene Jobs/Ressourcen und nächsten konkreten Schritt im Handoff sichern.
[Integrationshandoff](handoffs/F5-integration.md) enthält diesen Releasecheckpoint.
