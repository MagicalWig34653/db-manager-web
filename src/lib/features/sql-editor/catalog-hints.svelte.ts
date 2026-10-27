// SPDX-License-Identifier: AGPL-3.0-only
// Column names for SQL completion. Nothing is requested here: the table workbench reports the columns it
// has already loaded, and the editor reads them. Table names come from the catalog the session already holds.
import type { CatalogObject, ConnectionDraft } from '$lib/workbench';

const MAX_TABLES = 500;
const MAX_COLUMNS = 500;

interface Hints {
  owner: string;
  columns: Record<string, string[]>;
}
const hints = $state<Hints>({ owner: '', columns: {} });

/** Identity of a connection without the password. */
export const ownerKey = (c: ConnectionDraft) =>
  JSON.stringify([c.driver, c.database, c.host, c.port, c.username]);
const tableKey = (schema: string | undefined, name: string) => `${schema ?? ''}\u0000${name}`;

export function rememberColumns(
  connection: ConnectionDraft,
  table: { schema?: string; name: string },
  columns: readonly string[],
) {
  const owner = ownerKey(connection);
  if (hints.owner !== owner) {
    hints.owner = owner;
    hints.columns = {};
  }
  if (
    !(tableKey(table.schema, table.name) in hints.columns) &&
    Object.keys(hints.columns).length >= MAX_TABLES
  )
    return;
  hints.columns[tableKey(table.schema, table.name)] = columns.slice(0, MAX_COLUMNS);
}

export function clearColumnHints() {
  hints.owner = '';
  hints.columns = {};
}

export type SchemaTree = { [name: string]: string[] | SchemaTree };

/** Namespace for @codemirror/lang-sql: tables from the catalog, columns where already known. */
export function buildSchema(
  objects: readonly CatalogObject[],
  connection: ConnectionDraft | null,
): SchemaTree {
  const known = connection && hints.owner === ownerKey(connection) ? hints.columns : {};
  const tree: SchemaTree = {};
  for (const object of objects.slice(0, MAX_TABLES)) {
    const columns = known[tableKey(object.schema, object.name)] ?? [];
    // Tables of the current schema are offered unqualified; everything else under its schema name.
    if (
      !object.schema ||
      ['public', 'main'].includes(object.schema) ||
      connection?.driver === 'mysql'
    )
      tree[object.name] = [...columns];
    if (object.schema) {
      const group = (tree[object.schema] ??= {});
      if (Array.isArray(group)) continue;
      group[object.name] = [...columns];
    }
  }
  return tree;
}

/** Known columns by lower-case table name (unqualified); used for column completion of tables named in FROM. */
export function buildColumnIndex(
  objects: readonly CatalogObject[],
  connection: ConnectionDraft | null,
): Record<string, string[]> {
  const known = connection && hints.owner === ownerKey(connection) ? hints.columns : {};
  const index: Record<string, string[]> = {};
  for (const object of objects.slice(0, MAX_TABLES)) {
    const columns = known[tableKey(object.schema, object.name)];
    if (columns?.length) index[object.name.toLowerCase()] = [...columns];
  }
  return index;
}
