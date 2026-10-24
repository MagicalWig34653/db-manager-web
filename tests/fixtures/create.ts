// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic API 0.6 responses for table creation, derived from the contract schemas.
export const createCapabilities = {
  contract_version: '0.6.0',
  features: ['table_create'],
  types: ['int64', 'text', 'binary', 'decimal'],
  max_columns: 32,
  max_primary_key_columns: 8,
  max_text_length: 1024,
  max_decimal_precision: 38,
  max_timeout_ms: 60000,
  max_request_bytes: 1048576,
};
export const actualDescription = (name = 'created') => ({
  table: { name },
  kind: 'table',
  columns: [
    {
      name: 'id',
      database_type: 'BIGINT',
      nullable: false,
      pk_position: 1,
      generated: 'none',
      read_only: true,
    },
    {
      name: 'label',
      database_type: 'VARCHAR(255)',
      nullable: true,
      pk_position: 0,
      generated: 'none',
      read_only: true,
    },
  ],
  primary_key: ['id'],
  read_only: true,
  stable_order: true,
  storage_engine: '',
  transactional: 'yes',
});
export const createResult = (
  structure_check: 'transactional' | 'observed' | 'different' | 'unavailable' = 'transactional',
  name = 'created',
) => ({
  outcome: 'created',
  structure_check,
  snapshot_atomic: structure_check === 'transactional',
  message: 'Synthetische Bestätigung.',
  ...(structure_check === 'unavailable' ? {} : { actual_description: actualDescription(name) }),
});
export const errorBody = (code: string) => ({ error: { code, message: 'synthetic' } });
