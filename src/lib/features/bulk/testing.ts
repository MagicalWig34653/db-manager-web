// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic backend answers for the unit and browser tests of W-P13 (rows with a binary and a foreign key column).
import type { TableDescription } from '$lib/tables';

export const table = { schema: 'main', name: 'items' };
const col = (name: string, type: string, extra: Record<string, unknown> = {}) => ({
  name,
  database_type: type,
  nullable: true,
  pk_position: 0,
  generated: 'none' as const,
  read_only: true as const,
  ...extra,
});
export const description = (): TableDescription => ({
  table: { ...table },
  kind: 'table',
  columns: [
    col('id', 'INTEGER', { nullable: false, pk_position: 1 }),
    col('name', 'TEXT'),
    col('owner_id', 'INTEGER'),
    col('raw', 'BLOB'),
  ],
  primary_key: ['id'],
  read_only: true,
  stable_order: true,
  storage_engine: '',
  transactional: 'yes',
});
export const hostile = '<img src=x onerror=alert(1)>';
export const rowsData = () => [
  [
    { kind: 'integer', value: '1' },
    { kind: 'text', value: 'alpha' },
    { kind: 'integer', value: '7' },
    { kind: 'binary', value: 'AAEC' },
  ],
  [
    { kind: 'integer', value: '2' },
    { kind: 'text', value: hostile },
    { kind: 'null' },
    { kind: 'null' },
  ],
  [
    { kind: 'integer', value: '3' },
    { kind: 'text', value: '' },
    { kind: 'integer', value: '7' },
    { kind: 'binary', value: '' },
  ],
];
export const browse = () => ({
  description: description(),
  result: {
    columns: description().columns.map((c) => ({ name: c.name, database_type: c.database_type })),
    rows: rowsData(),
    truncated: false,
  },
  offset: 0,
  page_size: 100,
  has_more: false,
  stable_order: true,
  duration_ms: 1,
});
export const v2Caps = {
  contract_version: '0.2.0',
  features: ['table_describe', 'table_browse'],
  mutations: false,
  max_page_size: 1000,
  max_offset: 1000000,
  max_filters: 16,
  max_sort: 16,
};
export const v3Caps = {
  contract_version: '0.3.0',
  features: ['row_eligibility', 'row_update', 'row_delete'],
  max_rows_per_mutation: 1,
  max_request_bytes: 1048576,
  max_timeout_ms: 60000,
};
export const v4Caps = {
  contract_version: '0.4.0',
  features: ['row_insert_eligibility', 'row_insert'],
  max_rows_per_insert: 1,
  max_request_bytes: 1048576,
  max_timeout_ms: 60000,
};
export const updateEligibility = () => ({
  description: description(),
  eligible: true,
  reason: 'eligible',
  writable_columns: ['name', 'owner_id', 'raw'],
});
export const insertEligibility = (autoPk = true) => ({
  description: description(),
  eligible: true,
  reason: 'eligible',
  insertable_columns: ['id', 'name', 'owner_id', 'raw'],
  required_pk: autoPk ? [] : ['id'],
  ...(autoPk ? { auto_pk: 'id' } : {}),
});
export const bulkCaps = () => ({
  contract_version: '0.19.0',
  available: true,
  max_rows: 100,
  max_file_bytes: 524288,
  max_request_bytes: 1048576,
  max_timeout_ms: 60000,
  max_lookup_page_size: 100,
  drivers: ['sqlite', 'mysql', 'postgres'].map((driver) => ({
    driver,
    bulk: 'limited',
    file_values: 'limited',
    foreign_key_lookup: 'limited',
    reason: 'Synthetisch.',
  })),
});
export const keyOf = (id: string) => [{ column: 'id', value: { kind: 'integer', value: id } }];
export const structure = () => ({
  table: { ...table },
  indexes: [],
  constraints: [
    {
      name: 'fk_owner',
      name_known: true,
      kind: 'foreign_key',
      columns: ['owner_id'],
      columns_known: true,
      referenced_table: { schema: 'main', name: 'owners' },
      referenced_columns: ['id'],
      referenced_columns_known: true,
      on_update: 'no_action',
      on_delete: 'no_action',
      deferrable: 'no',
      initially_deferred: 'no',
      enforced: 'yes',
      validated: 'yes',
    },
  ],
  coverage: { indexes: 'catalog', constraints: 'catalog', checks: 'catalog' },
});
export const v5Caps = {
  contract_version: '0.5.0',
  features: ['table_structure'],
  mutations: false,
  max_objects_per_section: 1024,
  max_terms: 8192,
  timeout_ms: 10000,
};
export const ownersDescription = (): TableDescription => ({
  table: { schema: 'main', name: 'owners' },
  kind: 'table',
  columns: [col('id', 'INTEGER', { nullable: false, pk_position: 1 }), col('label', 'TEXT')],
  primary_key: ['id'],
  read_only: true,
  stable_order: true,
  storage_engine: '',
  transactional: 'yes',
});
