// SPDX-License-Identifier: AGPL-3.0-only
import { toConnection } from '$lib/api';
import type { components } from '$lib/contract/v19/api-types';
import { t } from '$lib/i18n';
import type { Change, Snapshot } from '$lib/rows';
import type { ConnectionDraft, DisplayResult } from '$lib/workbench';
import type { TableStructure } from '$lib/structure';

export type Schemas = components['schemas'];
export type Capabilities = Schemas['RowsBulkCapabilities'];
export type Plan = Schemas['RowsBulkPlan'];
export type PlanRequest = Schemas['RowsBulkPlanRequest'];
export type ExecuteRequest = Schemas['RowsBulkExecuteRequest'];
export type BulkResult = Schemas['RowsBulkResult'];
export type RowResult = Schemas['BulkRowResult'];
export type TableRef = Schemas['TableRef'];
export type Action = 'update' | 'delete' | 'copy';
export type LookupRequest = Schemas['ForeignKeyLookupRequest'];
export type LookupResult = Schemas['ForeignKeyLookupResult'];
export type FileValueUpload = Schemas['FileValueUploadRequest'];
export type FileValueRequest = Schemas['FileValueRequest'];

/** Contract limits (api-v0.19.0.json, RowsBulkCapabilities pins the same numbers). */
export const MAX_ROWS = 100;
export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_REQUEST_BYTES = 1024 * 1024;
export const LOOKUP_PAGE = 50;

export interface Support {
  bulk: boolean;
  fileValues: boolean;
  lookup: boolean;
  maxRows: number;
  maxFileBytes: number;
  reason: string;
}
export const noSupport = (): Support => ({
  bulk: false,
  fileValues: false,
  lookup: false,
  maxRows: MAX_ROWS,
  maxFileBytes: MAX_FILE_BYTES,
  reason: '',
});
export function supportFor(caps: Capabilities, driver: 'sqlite' | 'mysql' | 'postgres'): Support {
  const entry = caps.drivers.find((item) => item.driver === driver);
  if (!caps.available || !entry) return { ...noSupport(), reason: entry?.reason ?? '' };
  return {
    bulk: entry.bulk === 'limited',
    fileValues: entry.file_values === 'limited',
    lookup: entry.foreign_key_lookup === 'limited',
    maxRows: caps.max_rows,
    maxFileBytes: caps.max_file_bytes,
    reason: entry.reason,
  };
}

/** The full row exactly as the table view shows it: the expected state of the selection. */
export function snapshotAt(result: DisplayResult, index: number): Snapshot {
  const row = result.rows[index];
  if (!row || row.length !== result.columns.length) throw new Error(t('bulk.err.incompleteRow'));
  return {
    columns: result.columns.map((column) => column.name),
    values: row.map((cell) =>
      cell.kind === 'null'
        ? { kind: 'null' as const }
        : { kind: cell.kind as 'text', value: cell.value ?? '' },
    ),
  };
}

export interface Selection {
  /** Row index in the loaded page, in selection order (ascending, no duplicates). */
  indexes: number[];
  snapshots: Snapshot[];
}
export function selection(result: DisplayResult, indexes: Iterable<number>): Selection {
  const sorted = [...new Set(indexes)].sort((a, b) => a - b);
  return { indexes: sorted, snapshots: sorted.map((index) => snapshotAt(result, index)) };
}

export function planRequest(
  connection: ConnectionDraft,
  table: TableRef,
  action: Action,
  snapshots: Snapshot[],
  options: { changes?: Change[]; copyValues?: Change[][] } = {},
): PlanRequest {
  return {
    connection: toConnection(connection),
    table: { ...table },
    action,
    rows: snapshots.map((expected, i) => {
      const copy = options.copyValues?.[i];
      return {
        expected: {
          columns: [...expected.columns],
          values: expected.values.map((v) => ({ ...v })),
        },
        ...(action === 'copy' && copy && copy.length
          ? { copy_values: copy.map((c) => ({ column: c.column, value: { ...c.value } })) }
          : {}),
      };
    }),
    ...(action === 'update'
      ? {
          changes: (options.changes ?? []).map((c) => ({
            column: c.column,
            value: { ...c.value },
          })),
        }
      : {}),
    timeout_ms: 10000,
  } as PlanRequest;
}

/** Repeats the planned selection exactly and adds the plan hash and the per-row stability hashes. */
export function executeRequest(base: PlanRequest, plan: Plan): ExecuteRequest {
  return {
    connection: base.connection,
    table: { ...base.table },
    action: base.action,
    rows: base.rows.map((row, i) => ({
      expected: structuredClone(row.expected),
      stability_sha256: plan.rows[i].stability_sha256,
      ...(row.copy_values ? { copy_values: structuredClone(row.copy_values) } : {}),
    })),
    ...(base.action === 'update' ? { changes: structuredClone(base.changes ?? []) } : {}),
    timeout_ms: base.timeout_ms,
    confirm: true,
    expected_plan_sha256: plan.plan_sha256,
  } as ExecuteRequest;
}

/** Whether a plan answer belongs to the request: same table, action, row count and the keys of our rows in our order. */
export function planMatches(request: PlanRequest, plan: Plan, primaryKey: string[]): boolean {
  if (
    plan.action !== request.action ||
    plan.table.name !== request.table.name ||
    (request.table.schema !== undefined && plan.table.schema !== request.table.schema) ||
    plan.row_count !== request.rows.length ||
    plan.rows.length !== request.rows.length
  )
    return false;
  return plan.rows.every((planned, i) => {
    const expected = request.rows[i].expected;
    if (primaryKey.length === 0 || planned.key.length !== primaryKey.length) return false;
    return primaryKey.every((name, k) => {
      const key = planned.key.find((change) => change.column === name);
      const position = expected.columns.indexOf(name);
      const cell = expected.values[position];
      return (
        !!key &&
        k >= 0 &&
        !!cell &&
        key.value.kind === cell.kind &&
        (key.value.kind === 'null' || cell.kind === 'null' || key.value.value === cell.value)
      );
    });
  });
}

export function keyLabel(key: Change[]): string {
  return key
    .map(
      (change) =>
        `${change.column} = ${change.value.kind === 'null' ? 'NULL' : change.value.value}`,
    )
    .join(' · ');
}

const reasons = new Set([
  'plan_conflict',
  'row_conflict',
  'invalid_bulk',
  'invalid_mutation',
  'mutation_not_supported',
  'invalid_insert',
  'insert_conflict',
  'insert_not_supported',
  'insert_not_applied',
  'insert_identity_unknown',
  'constraint_violation',
  'mutation_failed',
  'invalid_table',
  'unsupported_table',
  'unsupported_identity',
  'unsupported_inheritance',
  'result_too_large',
  'outcome_unknown',
  'operation_rejected',
  'query_canceled',
  'timeout',
  'database_busy',
  'file_too_large',
  'invalid_file',
  'unsupported_file_value',
  'unsupported_file_column',
  'unsupported_preview',
  'unsupported_lookup',
  'table_not_found',
  'unauthorized',
  'unsupported_feature',
  'request_too_large',
  'unsupported_media_type',
  'invalid_request',
  'invalid_response',
  'network_error',
  'insecure_origin',
  'not_found',
  'database_error',
]);
/** Key of the fixed text for a server reason/error code; unknown codes get the generic text (the code stays text-only). */
export const reasonKey = (code: string) =>
  reasons.has(code) ? `bulk.reason.${code}` : 'bulk.reason.other';

export const outcomeKey = (outcome: string) =>
  ['completed', 'rejected', 'outcome_unknown'].includes(outcome)
    ? `bulk.outcome.${outcome}`
    : 'bulk.outcome.other';

/** Safe download name: never taken from the server or the data, only from identifiers reduced to harmless characters. */
export function safeFilename(table: string, column: string): string {
  const part = (value: string) => value.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) || 'x';
  return `${part(table)}-${part(column)}.bin`;
}

export const formatKiB = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1048576).toFixed(1)} MiB` : `${Math.ceil(bytes / 1024)} KiB`;

/** A column that can carry a file value: binary type, writable, outside the primary key, not generated. */
export function fileColumn(
  column: { name: string; database_type: string; generated: string },
  primaryKey: string[],
  writable: string[],
): boolean {
  return (
    /BLOB|BINARY|BYTEA/i.test(column.database_type) &&
    column.generated === 'none' &&
    !primaryKey.includes(column.name) &&
    writable.includes(column.name)
  );
}

export interface ForeignKeyInfo {
  /** Column of the edited table. */
  column: string;
  target: TableRef;
  targetColumn: string;
}
/** Only simple (single column) foreign keys with known columns: the server refuses everything else anyway. */
export function singleForeignKeys(structure: TableStructure): ForeignKeyInfo[] {
  const found = new Map<string, ForeignKeyInfo | null>();
  for (const constraint of structure.constraints) {
    if (constraint.kind !== 'foreign_key') continue;
    const usable =
      constraint.columns_known &&
      constraint.referenced_columns_known &&
      constraint.columns.length === 1 &&
      constraint.referenced_columns.length === 1 &&
      !!constraint.referenced_table;
    const column = constraint.columns[0];
    if (column === undefined) continue;
    // A column that takes part in several foreign keys is ambiguous: no lookup.
    found.set(
      column,
      usable && !found.has(column)
        ? {
            column,
            target: {
              ...(constraint.referenced_table!.schema !== undefined
                ? { schema: constraint.referenced_table!.schema }
                : {}),
              name: constraint.referenced_table!.name,
            },
            targetColumn: constraint.referenced_columns[0],
          }
        : null,
    );
  }
  return [...found.values()].filter((item): item is ForeignKeyInfo => item !== null);
}
