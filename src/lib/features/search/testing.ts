// SPDX-License-Identifier: AGPL-3.0-only
import type { Schemas, Plan } from './model';
import type { TableDescription } from '$lib/tables';
export function capabilities(): Schemas['SearchCapabilities'] {
  const driver = {
    search_modes: [
      'substring',
      'all_words',
      'exact',
      'regex',
    ] as Schemas['SearchDriverCapability']['search_modes'],
    replace_modes: [
      'substring',
      'exact',
      'regex',
    ] as Schemas['SearchDriverCapability']['replace_modes'],
    reason: 'DB-spezifische Semantik.',
  };
  return {
    contract_version: '0.14.0',
    features: ['search', 'browse', 'replace'],
    drivers: {
      sqlite: {
        ...driver,
        search_modes: ['substring', 'all_words', 'exact'],
        replace_modes: ['substring', 'exact'],
        reason: 'SQLite ohne Regex.',
      },
      mysql: driver,
      postgres: driver,
    },
    max_tables: 20,
    max_rows: 1000,
    max_preview_rows: 20,
    max_value_bytes: 4096,
    default_timeout_ms: 10000,
    max_timeout_ms: 60000,
  };
}
export const table = { schema: 'main', name: 'orders' };
export function description(): TableDescription {
  return {
    table,
    kind: 'table',
    columns: [
      {
        name: 'id',
        database_type: 'INTEGER',
        nullable: false,
        pk_position: 1,
        generated: 'none',
        read_only: true,
      },
      {
        name: 'note',
        database_type: 'TEXT',
        nullable: true,
        pk_position: 0,
        generated: 'none',
        read_only: true,
      },
      {
        name: 'other',
        database_type: 'VARCHAR(80)',
        nullable: true,
        pk_position: 0,
        generated: 'none',
        read_only: true,
      },
      {
        name: 'raw',
        database_type: 'BLOB',
        nullable: true,
        pk_position: 0,
        generated: 'none',
        read_only: true,
      },
    ],
    primary_key: ['id'],
    read_only: true,
    stable_order: true,
    storage_engine: 'InnoDB',
    transactional: 'yes',
  };
}
export const request = (): Schemas['ReplaceRequest'] => ({
  connection: { driver: 'sqlite', database: 'synthetic' },
  table: { ...table },
  column: 'note',
  term: 'fox',
  replacement: 'cat',
  mode: 'substring',
  max_rows: 100,
  timeout_ms: 10000,
});
export const plan = (): Plan => ({
  driver: 'sqlite',
  table: { ...table },
  column: 'note',
  affected_rows: 1,
  examples: [
    {
      key: [{ kind: 'integer', value: '1' }],
      before: { kind: 'text', value: 'fox' },
      after: { kind: 'text', value: 'cat' },
    },
  ],
  statements: ['UPDATE ... SET note = ? WHERE id = ?'],
  warnings: ['Begrenzte Vorschau'],
  plan_sha256: 'a'.repeat(64),
});
export const objectInfo = {
  schema: 'main',
  name: 'orders',
  kind: 'table',
  rows: { value: 2, state: 'exact' },
  engine: null,
  collation: null,
  size_bytes: null,
  comment: null,
} as const;
