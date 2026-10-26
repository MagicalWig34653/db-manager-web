# Handoff W-P19 Web: Views, Routinen, Trigger, Events (API 0.16)

Branch `feat/w-p19-web` (Worktree `.worktrees/w-p19-web`), Basis Web-`main` `c14271e`. Status: zur Prüfung, nicht gemergt.
Backend: Root-`main` `3a7e1f1` (Welle 3 integriert). Die frühere Codex-Fassung nutzte die vorläufige Nummer 0.17.

## Ergebnis

- Vertrag: `src/lib/contract/v16/` (bytegleiche Kopie von `contracts/api-v0.16.0.json`, SHA-256
  `d90ac3fda8295a4b8a7095c72eb459c6433fce90f729d7a6b247760d86de7bf3`, Provenance auf Commit `3a7e1f1`); Typen und
  Validatoren per `contract:generate`. Das vorläufige `v17` wurde entfernt; Endpunkte `/api/v16/programs/*`.
  Der Vertragstext nennt in `info.description` noch "API 0.17" (Backend-Datei, unverändert übernommen).
- Oberfläche `src/lib/features/programs/**` als Datenbankreiter `programmobjekte`: Auflisten (Views, Funktionen,
  Prozeduren, Trigger, Events), Definition/Körper/Parameter/Eigenschaften/Definer/SQL SECURITY, Abhängigkeiten,
  Anlegen/Ersetzen/Löschen mit Plan-Vorschau (exakte Statements, Warnungen), Bestätigung, getippter Zielname bei
  Ersetzen/Löschen, einmalige Ausführung, Sperre nach Abschluss. Kein Routinenaufruf (Vertrag: `routine_execution=false`),
  Scheduler nur lesend.
- Ersetzen/Löschen (Nachbesserung in diesem Lauf): Der Backend-Vertrag liefert die alte Definition weder im Plan noch im
  Ergebnis. Die UI hält deshalb die zuletzt angezeigte Definition fest und zeigt sie im Plan als "Bisherige Definition"
  und, wenn nur ein Teil der Statements lief (MySQL/MariaDB: DROP ok, CREATE fehlgeschlagen; `statements_executed <
  statements_total`), zusammen mit der Warnung "möglicherweise entfernt und nicht wiederhergestellt". `outcome_unknown`
  zeigt die Katalogprüf-Meldung ohne automatischen Retry. Nicht atomare Pläne tragen den Hinweis `programs.nonAtomic`.
- SECURITY DEFINER / Definer: Detailansicht zeigt Definer, SQL SECURITY und eine Warnung (`definer-warning`), wenn
  `security=definer` oder ein Definer gesetzt ist; Formular und Plan enthalten die Backend-Warnungen.
- Schreib-/Navigationssperre über `onwritephase` und `shell.session.writeInFlight` (Browser-Spec prüft Hash-Navigation).
- Texte: `programs.*` am Ende von `de.ts` (nur angehängt).
- Neues Skript `scripts/test-real-programs.py` (nur SQLite, ohne Docker) startet Backend (DBM_BACKEND_REPO) und Vorschau.

## Prüfstand

Siehe Abschnitt am Ende (wird mit dem Commit aktualisiert).

## Offen

- Kein Echtlauf gegen MySQL/MariaDB/PostgreSQL (Routinen, Events, nicht atomares Ersetzen): nur Fixtures und SQLite-Views.
- Kein ADR; unabhängiges Review steht aus. Einzeltests für die neuen Anzeigen (Bisherige Definition, Teilausführung) sind
  nur über die Browser-/Komponententests mit Fixtures abgedeckt, soweit vorhanden.
