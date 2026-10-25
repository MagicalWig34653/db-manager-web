// SPDX-License-Identifier: AGPL-3.0-only
// Shared fixtures for the column editor tests (unit/component).
import type { ColumnsCapabilities, ColumnsPlan, ColumnsResult } from './model';
import type { TableDescription } from '$lib/tables';

export const support = (
  value: 'supported' | 'limited' | 'unsupported' = 'supported',
  reason?: string,
) => ({
  support: value,
  ...(reason ? { reason } : {}),
});
const all = ['int64', 'text', 'binary', 'decimal', 'boolean', 'date', 'timestamp'] as const;
const mysqlAll = [...all, 'enum', 'set'] as const;
export function capabilities(
  over: Partial<ColumnsCapabilities['drivers']> = {},
): ColumnsCapabilities {
  const open = {
    add: support(),
    change: support(),
    rename: support(),
    drop: support(),
    reorder: support(),
    generated: support('unsupported', 'Generierte Ausdrücke sind nach E5 nicht freigegeben.'),
  };
  const closed = {
    ...open,
    change: support('unsupported', 'SQLite baut Tabellen hier nicht neu auf.'),
    reorder: support('unsupported', 'Keine Positionsangabe in SQLite.'),
    add: support('limited', 'NOT NULL nur mit konstantem Standardwert.'),
  };
  return {
    contract_version: '0.9.0',
    features: ['columns_alter'],
    drivers: { sqlite: closed, mysql: open, postgres: open, ...over },
    types: { sqlite: [...all], mysql: [...mysqlAll], postgres: [...all] },
    max_changes: 16,
    max_timeout_ms: 60000,
    max_request_bytes: 1048576,
  };
}
export function description(): TableDescription {
  return {
    table: { name: 'orders' },
    kind: 'table',
    columns: [
      {
        name: 'id',
        database_type: 'bigint',
        nullable: false,
        pk_position: 1,
        generated: 'none',
        read_only: true,
      },
      {
        name: 'note',
        database_type: 'varchar(80)',
        nullable: true,
        pk_position: 0,
        generated: 'none',
        read_only: true,
        default_value: 'x',
      },
      {
        name: 'total',
        database_type: 'decimal(10,2)',
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
export const hash = 'a'.repeat(64);
export function plan(over: Partial<ColumnsPlan> = {}): ColumnsPlan {
  return {
    driver: 'postgres',
    statements: ['ALTER TABLE "orders" ADD COLUMN "n" BIGINT NULL'],
    warnings: ['Strukturänderungen können die Tabelle sperren.'],
    affected_objects: ['public.orders', 'public.orders.n'],
    plan_sha256: hash,
    table: { name: 'orders' },
    destructive: false,
    target_name: 'orders',
    dependencies: [],
    ddl_transactional: true,
    ...over,
  };
}
export function result(over: Partial<ColumnsResult> = {}): ColumnsResult {
  return {
    outcome: 'completed',
    reason: 'completed',
    message: 'ok',
    statements_executed: 1,
    atomic: true,
    observation: 'transactional',
    ...over,
  };
}
