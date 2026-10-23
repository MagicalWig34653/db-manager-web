# Tatsächlicher Webstand

Stand: 23.10.2026, F5-Releasecheckpoint. Nutzerrahmen bis heute10:00 Europe/Berlin
(08:00UTC), Root koordiniert ausschließlich. Agents implementieren, prüfen,
dokumentieren und übernehmen konkret freigegebene Integrationen.

## Integrierter Umfang

Deutscher Svelte5-/shadcn-svelte-Arbeitsplatz für den persönlichen Go-Dienst:
flüchtige Token-/DBanmeldung, Katalog, einzelne SQLanweisung, begrenzte getaggte
Ergebnisse und Abbruch; strukturierte Tabellenansicht mit Sortierung, gebundenen
AND-Filtern und Pagination; bestätigte einzelne Inserts/Updates/Deletes mit
Konflikt-/Unknown-Behandlung; lokaler JSON-/CSVexport geladener Ergebnisse und
lesende Index-/Constraintstruktur. Keine zusätzliche DBabfrage beim Export.

Die neue Strukturansicht zeigt geordnete Indexterme, Key-/Include-/Hilfsrollen,
Partial-/Expression-/Sort-/Kollationsangaben sowie Constraints/FK-Aktionen und
ausdrückliche Coverage-/Unknownzustände. Keine SQLdefinitionen oder FK-Navigation
werden erfunden. Ältere Backends behalten die vorhandene v2-Spaltenansicht, wenn
v5 fehlt. Die Oberflächenstruktur ist kein DDL-/Schemaänderungseditor.

## Unabhängige Abnahmen und Provenienz

| Paket | Geprüfte Quelle / Nachweis | Tatsächliches Ergebnis |
| --- | --- | --- |
| F1/F1b | [F1](handoffs/F1.md), [CSP](handoffs/F1b.md) | SQL-/Sessionschutz und buildzeitliche Standalonevalidatoren, strikte Produktions-CSP ohne unsafe-eval. |
| F3 | [Handoff](handoffs/F3.md), Quelle6c6eb33 | Tabellenansicht/Quellen-/Originallizenzdialog; atomare Filter-/Sortzustandskorrektur unabhängig geschlossen. |
| F4 | [Handoff](handoffs/F4.md), [Review](handoffs/F4-review.md), Quelle3a4a3fd | Bestätigte Einzelzeilenmutationen, vollständiger typisierter Snapshot, ehrliche Konflikt-/Commitunsicherheit ohne Retry. |
| F6 | [Handoff](handoffs/F6.md), [Review](handoffs/F6-review.md), Quelle1a8adfa, bisheriger Main204cb07 | JSON bevorzugt und verlustlos; zwei bewusst getrennte CSVprofile. Steuerzeichenbefund QA-F6-01 geschlossen, keine heimliche Bereinigung. |
| F5 | [Handoff](handoffs/F5.md), [Review](handoffs/F5-review.md), Quelle8ef738d22a1164291e2c8183d80e72d1f043c0f8 | Index-/Constraintstruktur unabhängig freigegeben; QA-F5-01 geschlossen, bekannte leere Bezeichner bleiben als JSONzitierte Namen sichtbar. |

F5-Feature/Handoff bis a5c687f und vollständige Erst-/Fixreviewprovenienz bis
469653dd bleiben mit den Merges0e75e39/4cbec59 in der Main-Ancestry erhalten.
Geprüfte Produktbytes unverändert; Releasearbeit nur zentrale Statuspflege und
[Integrationshandoff](handoffs/F5-integration.md). Der feste freigegebene Webpin für
RootpaketF5b(F5+F6) ist **8ef738d22a1164291e2c8183d80e72d1f043c0f8**.

## Verträge und Grenzen

API1–5 liegen mit unveränderten kanonischen Kopien, Typen, Herkunftsdateien und
Standalonevalidatoren unter src/lib/contract. API0.5-Referenzbackend
ac9542d81e6f096626c24bc1e0cb9bccb3a62a7c enthält den unabhängig geschlossenen
Namespacefix; Schema-SHA256
b5225339511d80fe4f52f09118fdad2060d8a92f31d44b73dd89fe9f76178c95.

Neue Schreibaktionen verlangen die geprüften v4-Fähigkeiten und passende v3-Eignung;
der Referenzbackend72855cf oder eine nachgeprüfte Nachfolge enthält beide v3-
Integritätsfixes. Keine automatischen Retries;409 verlangt Neuladen, Transportfehler
nach Versand oder outcome_unknown bedeutet möglichen Commit. Abbruch ist keine
Rollbackgarantie. Token-/Quellenwechsel räumt Werte auf; kein Credentials-/SQL-/
Entwurfsspeicher und keine Teamkontentrennung aus dem persönlichen Tokenmodell.

JSONexport erhält Reihenfolge/doppelte Namen/getaggte Werte und tatsächlichen
Seiten-/Trunkierungsumfang. CSVprofile dokumentieren NULL-/Quote-/Typverlust und
Apostroph-/Rohwertwahl; unzulässige Steuerzeichen werden vor Blob/Download explizit
abgewiesen. Keine allgemeine Excel-Sicherheits-/Roundtripbehauptung. Maximal8MiB
fertige UTF8Bytes. App-/Backendverbindungsdaten und SQL werden nicht serialisiert.

## Tatsächlicher Prüfstand

- F5 unabhängig: ursprüngliche46Units, Typen/Format/fünf Verträge/Standalone,
  frischer öffentlicher Build/Notices, sechs Legacybrowser, zwei CSPfälle und zehn
  echte SQLite-/PostgreSQL-verify-full-Browserfälle. MySQL/MariaUI nur synthetische
  Renderer-/Validatorrepräsentationen, **keine AllDB-Browserabnahme**.
- Gezielter Fix: elf unabhängige Helper-/Komponententests, Typecheck0/0 und ein
  tatsächlicher SQLite-Leerbezeichnerbrowserfall; ursprüngliche Nachweise getrennt.
  Alle drei exakten Fix-CIs [Frontend39908165762](https://github.com/MagicalWig34653/db-manager-web/actions/runs/39908165762), [echte Browser39908165925](https://github.com/MagicalWig34653/db-manager-web/actions/runs/39908165925) und [Docs39908165711](https://github.com/MagicalWig34653/db-manager-web/actions/runs/39908165711) erfolgreich.
- Kombinierter Releasecheck im eigenen Worktree: npmci mit unverändertem Lock,
  Typecheck0/0,47Units, fünf Typ-/Standalonebyteprüfungen, Format und Produktionsbuild
  bestanden. Fünf Originalartefakte, bekannte Vite-Chunkwarnung bei etwa958kBJS.
  Dokumentations-/Diffcheck bestanden; neue Web-Main-CIs werden durch diesen
  Veröffentlichungscheckpoint gestartet und noch nicht als erfolgreich behauptet.
- Main204cb07 hatte bereits alle drei F6-CIs erfolgreich. Frühere F5-Linux-CDP-
  Beobachtung39906592949 bleibt historisch fehlgeschlagen; späterer Beobachtungsfix
  ersetzt keine DBantwort und entfernt keine fachliche Assertion.

## Veröffentlichung und Fortsetzung

F4b ist im Go-/Dockerhauptrepo abgenommen; dessen eingebauter Webpin bleibt bis
separater Annahme vonF5b noch3a4a3fd. F5/F6-Webintegration bedeutet **keine neue
Root-Einbettungs-/Compose-/Swarmfreigabe**. F5b wird im eigenen Rootpaket reproduziert
und unabhängig gegen echte DBs/Container geprüft. Root-API0.6 ist separat akzeptiert;
dieser Webstand konsumiert nur v1–v5 und bietet keine strukturierte Tabellenanlage.

Keine vollständige phpMyAdmin-Parität, produktiver Tresor, Passkeys, CloudKit oder
Teamfunktionen. Keine Geräte-/interaktive OS-/HA-/Exactly-once-Zusage. Originaltexte
und Inventar bleiben erhalten; eigener Code AGPL-3.0-only. Keine eigenen lokalen
Releaseprüfjobs, Server, DB-/Browser-/Dockerressourcen offen. Alte saubere Worktrees
bleiben Provenienz. WebSTATUS/ARBEITSPLAN liegen für diesen Release exklusiv beim
Releasekoordinator; weitere Zuweisung nur durch Root. [Arbeitsplan](ARBEITSPLAN.md),
[Einrichtung](../EINRICHTUNG.md), [Hauptprojektstand](https://github.com/MagicalWig34653/db-manager/blob/main/docs/STATUS.md).
