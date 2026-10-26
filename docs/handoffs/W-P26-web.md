# Handoff W-P26 Web: Einstellungen, Themen, Sprachen, Tastaturkürzel

Branch `feat/w-p26-web` (Worktree `.worktrees/w-p26-web`), Basis Web-`main` `c14271e` (`git merge main`: bereits aktuell).
Status: zur Prüfung, nicht gemergt. Backend-Bezug: Root-`main` `3a7e1f1`.

## Vertrag

Kein neuer Backend-Vertrag. Laut `docs/PWA-PLAN.md` hängt W-P26 von W-P20 (Konfigurationsspeicher, serverseitig) ab; dieser
Stand ist eine reine Client-Funktion ohne API und ohne `src/lib/contract/vN/`-Änderung. Die Einstellungen liegen nur im
Browser (siehe Sicherheit) und werden nicht serverseitig synchronisiert; eine spätere Anbindung an W-P20 ist offen.

## Ergebnis

- Themen hell/dunkel/System (`src/lib/features/settings/theme.css`, `preferences.svelte.ts`): Farben in `app.css` laufen
  über Variablen; `data-theme` und `color-scheme` am `<html>`, `theme-color`-Meta folgt. System-Thema reagiert live auf
  `prefers-color-scheme`. Kontrast der Paare per Unit-Test (`contrast.test.ts`) geprüft.
- Sprachen Deutsch (Quelle) und Englisch (`src/lib/i18n/en.ts`, vollständig, Schlüssel- und Platzhalterparität per
  `catalogs.test.ts`). Unbekannte Sprache fällt auf Deutsch zurück; `lang`/`dir` am `<html>`, RTL-Mechanik vorbereitet
  (`directions`), aber keine RTL-Sprache ausgeliefert. Zahlen/Datum über `formatNumber`/`formatDate` (Intl) statt
  fest `de-DE`. Weitere Sprachen (Haiku-Übersetzung) und RTL stehen aus.
- Einstellungsbereich als `server-section` der Serverübersicht (`#/server/uebersicht`, Anker `#settings`); Speichern ist
  freiwillig (Schlüssel `db-manager.settings.v1`, nur Thema und Sprache, Allowlist, kein Token/SQL); Zurücksetzen löscht
  den Eintrag; Speicherfehler werden gemeldet, App bleibt funktionsfähig.
- Tastaturkürzel: Registrierung mit Titel und Bereich, Übersicht per `?` oder `F1` (nicht in Eingabefeldern, nicht bei
  offenen Dialogen, keine Wiederholung); Abbruch mit Escape nur bei geschlossenen Dialogen. Belegung nur angezeigt, nicht
  veränderbar.
- Schreib-/Navigationssperre: Theme-/Sprachwechsel und Kürzelübersicht lösen keine Navigation und keine Anfragen aus; der
  Schreib-Empfänger der Shell bleibt unverändert.
- Texte: `settings.*` an `de.ts` angehängt, Gegenstück in `en.ts`.

## Prüfstand

`npm test` 316 grün (34 Dateien), `npm run check` 0 Fehler, `format:check` ok, Browser-Specs inklusive neuer
`tests/browser/settings.spec.ts` (Theme, Sprache, Opt-in-Speicherung, Reset, F1-Dialog) grün, `npm run build` ok; 41 Browser-Specs grün.
Kein Echtlauf (`scripts/test-real-*.py`) nötig: keine Backend-Anbindung.

## Offen

- Beim Zusammenführen mit W-P19 (`programs.*` in `de.ts`) schlägt `catalogs.test.ts` fehl, bis `en.ts` die neuen Schlüssel
  enthält; ebenso für jedes weitere Paket mit neuen deutschen Texten.
- Touch-/Kleingeräte-Nachweis (UX-007) und Kontrast-Prüfung im Browser sind nicht Teil dieses Stands.
- Weitere Sprachen, RTL, serverseitige Ablage (W-P20), Kürzel anpassen, kein ADR, unabhängiges Review steht aus.
