# W-P16: Browserlokaler SQL-Komfort ohne zusätzliche Abhängigkeit

Stand: 25.10.2026. Status: auftragsgemäße Paketentscheidung, unabhängige Abnahme offen.

## Grundlage

Der begrenzte W-P16-Auftrag konkretisiert E1 des Root-PWA-Plans: lokale Ablage ist
freiwillig, Verlauf standardmäßig aus, keine serverseitige Speicherung. Der Auftrag
verlangt localStorage mit Fehlerbehandlung und verbietet Installation neuer Pakete.

## Entscheidung

Das Feature liegt unter `src/lib/features/sql-editor/`. Die Shell bindet eine kleine
Komponente ein. Die zentrale Ausführung meldet gestartete SQL-Anfragen an das Feature;
damit gelten Verlaufsschalter und Grenzen auch bei Strg-/Cmd+Enter. Beim Laden,
Import und Übernehmen eines Eintrags wird keine Abfrage ausgeführt.

Ein versionierter localStorage-Schlüssel je Quelle enthält nur Opt-in, SQL-Einträge,
Lesezeichennamen und Zeitpunkte. Der Schlüssel verwendet SHA-256 über Origin,
Treiber, Datenbank und bei Netzwerkverbindungen Host, Port und Benutzer. Passwort,
Token und Anzeigename gehören nicht zur Identität. Hashes sind keine Verschlüsselung.
Ohne Web Crypto oder bei Speicherfehlern arbeitet das Feature im Arbeitsspeicher.
Die Oberfläche meldet fehlgeschlagene Persistenz und möglicherweise fehlgeschlagene
Löschung ausdrücklich. Es gibt keine automatische Migration vorhandener Daten.

Ausschalten löscht den Verlauf, Lesezeichen bleiben bis zur ausdrücklichen Löschung.
Beide Listen sind auf je 200 Einträge und jeweils knapp 256 KiB begrenzt. Die ältesten
Einträge werden beim Hinzufügen verdrängt; einzelne SQL-Texte über 100.000 Zeichen
werden abgelehnt. Import wird vollständig validiert und erst danach angehängt; er
aktiviert den Verlauf nicht und verändert bei Fehlern nichts. Export umfasst nur
Lesezeichen, keine Quelle, Ergebnisse, Verbindung oder Einstellungen.

Aktive Passwörter/Tokens und häufige SQL-Zugangssyntax werden beim Hinzufügen
abgewiesen. Das ersetzt keine Erkennung beliebiger sensibler SQL-Werte. Der Hinweis
vor dem Opt-in und Speichern ist deshalb erforderlich. Es gibt weder Kontentrennung
noch Synchronisation zwischen Geräten; parallele Browserfenster können denselben
lokalen Stand überschreiben.

## Folgen und spätere Schritte

Keine neue Abhängigkeit, keine Lizenz-/Noticeänderung. Vorhandene Zeilennummern,
Tab-Einrückung und Shell-Kürzel bleiben erhalten. CodeMirror 6, Syntaxfarben,
Katalogvervollständigung, Formatierung, Variablen und allgemeine persönliche
Navigations-/Anzeigeeinstellungen sind spätere, separat zu prüfende Schritte.
CodeMirror ist vorab freigegeben, hier aber ohne Installation nicht eingebunden.
