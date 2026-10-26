// SPDX-License-Identifier: AGPL-3.0-only
import cap from './fixtures/IndexesCapabilities.real-sqlite-http.json' with { type: 'json' };
import planFixture from './fixtures/IndexesPlan.postgres-placeholder.json' with { type: 'json' };
import resultFixture from './fixtures/IndexesResult.completed-placeholder.json' with { type: 'json' };
import type { IndexesCapabilities, IndexesPlan, IndexesResult } from './model';
import type { TableDescription } from '$lib/tables';
import type { TableStructure } from '$lib/structure';
export const capabilities = (): IndexesCapabilities => structuredClone(cap) as IndexesCapabilities;
export const plan = (over: Partial<IndexesPlan> = {}): IndexesPlan => ({
  ...(structuredClone(planFixture) as IndexesPlan),
  table: { name: 'orders' },
  target_name: 'orders',
  ...over,
});
export const result = (over: Partial<IndexesResult> = {}): IndexesResult =>
  ({ ...structuredClone(resultFixture), ...over }) as IndexesResult;
export const description = (): TableDescription => ({
  table: { name: 'orders' },
  kind: 'table',
  columns: ['id', 'note'].map((name) => ({
    name,
    database_type: 'text',
    nullable: true,
    pk_position: 0,
    generated: 'none',
    read_only: true,
  })),
  primary_key: [],
  read_only: true,
  stable_order: false,
  transactional: 'yes',
  storage_engine: 'InnoDB',
});
export const metadata = (): TableStructure => ({
  table: { name: 'orders' },
  indexes: [
    {
      name: 'idx <img src=x>',
      unique: 'yes',
      primary: 'no',
      method: 'btree',
      method_known: true,
      partial: 'no',
      valid: 'yes',
      nulls_distinct: 'unknown',
      terms: [
        {
          position: 1,
          kind: 'column',
          column: 'note',
          role: 'key',
          direction: 'desc',
          collation_state: 'unknown',
          prefix_state: 'present',
          prefix_unit: 'unknown',
          prefix_length: 7,
        },
      ],
    },
  ],
  constraints: [
    {
      name: 'fk_orders',
      name_known: true,
      kind: 'foreign_key',
      columns: ['id'],
      columns_known: true,
      referenced_table: { name: 'parents' },
      referenced_columns: ['id'],
      referenced_columns_known: true,
      on_delete: 'cascade',
      on_update: 'restrict',
      deferrable: 'no',
      initially_deferred: 'no',
      enforced: 'yes',
      validated: 'yes',
    },
  ],
  coverage: { indexes: 'catalog', constraints: 'partial', checks: 'unavailable' },
});
