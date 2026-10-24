// SPDX-License-Identifier: AGPL-3.0-only
// Central German text catalog. Feature packages append their own keys under "<name>.*".
export const de = {
  shell: {
    skipLink: 'Zum Arbeitsbereich',
    navigationLabel: 'Datenbanknavigation',
    navigationOpen: 'Navigation öffnen',
    navigationClose: 'Navigation schließen',
    server: 'Server',
    workspace: 'Arbeitsplatz',
    sqlWorkspace: 'SQL-Arbeitsbereich',
    tableView: 'Tabellenansicht',
    serverOverview: 'Serverübersicht',
    tabsLabel: 'Arbeitsbereich',
    tabSql: 'SQL',
    tabTable: 'Tabelle',
    connected: 'Verbunden',
    notConnected: 'Nicht verbunden',
    noConnectionForDatabase: 'Für die Datenbank „{database}“ ist keine passende Verbindung offen.',
    openConnection: 'Verbindung hinzufügen',
    tableNotFound: 'Das Objekt „{name}“ wurde im Katalog nicht gefunden.',
    tableLoading: 'Objekte werden geladen …',
    unknownTab: 'Dieser Reiter ist nicht verfügbar.',
    backToDatabase: 'Zur Datenbank',
    invalidLinkTitle: 'Link nicht verfügbar',
  },
  nav: {
    sectionConnection: 'VERBINDUNG',
    sectionObjects: 'OBJEKTE',
  },
  shared: {
    close: 'Schließen',
    cancel: 'Abbrechen',
    retry: 'Erneut versuchen',
    loading: 'Wird geladen …',
    error: 'Fehler',
    unsupported: 'Nicht unterstützt',
    unsupportedReason: 'Diese Funktion steht für die aktuelle Verbindung nicht zur Verfügung.',
    confirmTypeName: 'Zur Bestätigung den Namen „{name}“ eingeben',
    confirmNameLabel: 'Name des Zielobjekts',
    confirmAction: 'Endgültig ausführen',
    planTitle: 'Geplante SQL-Anweisungen',
    planReadonly: 'Schreibgeschützte Vorschau. Es wurde noch nichts ausgeführt.',
    planWarnings: 'Warnungen',
    planHash: 'Plan-Prüfsumme (SHA-256)',
    planEmpty: 'Keine Anweisungen im Plan.',
  },
  server: {
    overviewTitle: 'Übersicht',
    noConnection: 'Es ist keine Verbindung geöffnet.',
    connectionLabel: 'Aktive Verbindung',
    driverLabel: 'Treiber',
    databaseLabel: 'Datenbank',
  },
  shortcuts: {
    runQuery: '⌘ / Strg + Enter ausführen',
    cancelQuery: 'Escape abbrechen',
    focusEditor: 'Editor fokussieren',
  },
} as const;

type Join<K extends string, P extends string> = `${K}.${P}`;
type Leaves<T> = {
  [K in keyof T & string]: T[K] extends string ? K : Join<K, Leaves<T[K]>>;
}[keyof T & string];
export type TextKey = Leaves<typeof de>;
