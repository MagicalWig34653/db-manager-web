// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import * as validators from '$lib/contract/v19/validators.js';
import { emptyConnection } from '$lib/workbench';
import type { TableStructure } from '$lib/structure';
import {
  executeRequest,
  fileColumn,
  keyLabel,
  outcomeKey,
  planMatches,
  planRequest,
  reasonKey,
  safeFilename,
  selection,
  singleForeignKeys,
  snapshotAt,
  supportFor,
  type Plan,
} from './model';

const connection = { ...emptyConnection(), database: 'synthetic' };
const table = { schema: 'main', name: 'items' };
const result = {
  columns: [
    { name: 'id', type: 'INTEGER' },
    { name: 'name', type: 'TEXT' },
  ],
  rows: [
    [
      { kind: 'integer', value: '1' },
      { kind: 'text', value: 'a' },
    ],
    [{ kind: 'integer', value: '2' }, { kind: 'null' }],
    [
      { kind: 'integer', value: '3' },
      { kind: 'text', value: '<b>x</b>' },
    ],
  ],
  truncated: false,
};
const fixture = (name: string) =>
  JSON.parse(readFileSync(`src/lib/features/bulk/fixtures/${name}.json`, 'utf8'));

it('takes the exact page row as the expected snapshot and keeps the selection order', () => {
  expect(snapshotAt(result, 1)).toEqual({
    columns: ['id', 'name'],
    values: [{ kind: 'integer', value: '2' }, { kind: 'null' }],
  });
  const picked = selection(result, [2, 0, 2]);
  expect(picked.indexes).toEqual([0, 2]);
  expect(picked.snapshots[1].values[1]).toEqual({ kind: 'text', value: '<b>x</b>' });
  expect(() => snapshotAt(result, 9)).toThrow();
});

it('builds plan requests accepted by the contract for update, delete and copy', () => {
  const rows = selection(result, [0, 1]).snapshots;
  const update = planRequest(connection, table, 'update', rows, {
    changes: [{ column: 'name', value: { kind: 'text', value: 'z' } }],
  });
  expect(validators.RowsBulkPlanRequest(update)).toBe(true);
  expect(update).toMatchObject({ action: 'update', changes: [{ column: 'name' }] });
  const del = planRequest(connection, table, 'delete', rows);
  expect(validators.RowsBulkPlanRequest(del)).toBe(true);
  expect(del).not.toHaveProperty('changes');
  const copy = planRequest(connection, table, 'copy', rows, {
    copyValues: [[{ column: 'id', value: { kind: 'integer', value: '10' } }], []],
  });
  expect(validators.RowsBulkPlanRequest(copy)).toBe(true);
  expect(copy.rows[0].copy_values).toHaveLength(1);
  expect(copy.rows[1]).not.toHaveProperty('copy_values');
  // An update without changes is refused by the contract before any request.
  expect(validators.RowsBulkPlanRequest(planRequest(connection, table, 'update', rows))).toBe(
    false,
  );
});

it('repeats the planned selection in the execute request with all hashes', () => {
  const rows = selection(result, [0, 2]).snapshots;
  const base = planRequest(connection, table, 'delete', rows);
  const plan: Plan = {
    table,
    action: 'delete',
    row_count: 2,
    rows: [
      {
        key: [{ column: 'id', value: { kind: 'integer', value: '1' } }],
        stability_sha256: 'a'.repeat(64),
      },
      {
        key: [{ column: 'id', value: { kind: 'integer', value: '3' } }],
        stability_sha256: 'b'.repeat(64),
      },
    ],
    warnings: [],
    plan_sha256: 'c'.repeat(64),
  };
  const exec = executeRequest(base, plan);
  expect(validators.RowsBulkExecuteRequest(exec)).toBe(true);
  expect(exec).toMatchObject({ confirm: true, expected_plan_sha256: 'c'.repeat(64) });
  expect(exec.rows.map((r) => r.stability_sha256)).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
  expect(exec.rows[1].expected).toEqual(base.rows[1].expected);
  expect(planMatches(base, plan, ['id'])).toBe(true);
  // A plan about other rows, another action or another count is not accepted.
  expect(planMatches(base, { ...plan, rows: [plan.rows[1], plan.rows[0]] }, ['id'])).toBe(false);
  expect(planMatches(base, { ...plan, action: 'copy' }, ['id'])).toBe(false);
  expect(planMatches(base, { ...plan, row_count: 1 }, ['id'])).toBe(false);
  expect(planMatches(base, { ...plan, table: { schema: 'main', name: 'other' } }, ['id'])).toBe(
    false,
  );
  expect(planMatches(base, plan, [])).toBe(false);
  expect(keyLabel(plan.rows[0].key)).toBe('id = 1');
});

it('validates the real plan and result fixtures', () => {
  expect(validators.RowsBulkPlan(fixture('RowsBulkPlan.real-TestSQLiteRowsBulk'))).toBe(true);
  expect(validators.RowsBulkResult(fixture('RowsBulkResult.real-TestSQLiteRowsBulk'))).toBe(true);
  expect(validators.RowsBulkResult(fixture('RowsBulkResult.bad-outcome.invalid'))).toBe(false);
});

it('reads driver support from the capabilities', () => {
  const caps = fixture('RowsBulkCapabilities.real-http');
  expect(supportFor(caps, 'sqlite')).toMatchObject({
    bulk: true,
    fileValues: true,
    lookup: true,
    maxRows: 100,
    maxFileBytes: 524288,
  });
  expect(supportFor({ ...caps, available: false }, 'sqlite').bulk).toBe(false);
  expect(supportFor({ ...caps, drivers: [] }, 'mysql').bulk).toBe(false);
});

it('maps codes to fixed texts and never to server text', () => {
  expect(reasonKey('plan_conflict')).toBe('bulk.reason.plan_conflict');
  expect(reasonKey('<script>')).toBe('bulk.reason.other');
  expect(outcomeKey('completed')).toBe('bulk.outcome.completed');
  expect(outcomeKey('x')).toBe('bulk.outcome.other');
  expect(safeFilename('../../etc/passwd', 'a b\\c"')).toBe('_etc_passwd-a_b_c_.bin');
  expect(safeFilename('', '')).toBe('x-x.bin');
});

it('finds only simple unambiguous foreign keys', () => {
  const base = {
    name_known: true,
    columns_known: true,
    referenced_columns_known: true,
    on_update: 'no_action',
    on_delete: 'no_action',
    deferrable: 'no',
    initially_deferred: 'no',
    enforced: 'yes',
    validated: 'yes',
    kind: 'foreign_key',
  };
  const structure = {
    table,
    indexes: [],
    coverage: {},
    constraints: [
      {
        ...base,
        name: 'a',
        columns: ['owner'],
        referenced_table: { schema: 'main', name: 'users' },
        referenced_columns: ['id'],
      },
      {
        ...base,
        name: 'b',
        columns: ['x', 'y'],
        referenced_table: { name: 'p' },
        referenced_columns: ['a', 'b'],
      },
      {
        ...base,
        name: 'c',
        columns: ['dup'],
        referenced_table: { name: 'p' },
        referenced_columns: ['a'],
      },
      {
        ...base,
        name: 'd',
        columns: ['dup'],
        referenced_table: { name: 'q' },
        referenced_columns: ['a'],
      },
      {
        ...base,
        name: 'e',
        columns: ['unk'],
        columns_known: false,
        referenced_table: { name: 'q' },
        referenced_columns: ['a'],
      },
      { ...base, name: 'f', kind: 'unique', columns: ['u'], referenced_columns: [] },
    ],
  } as unknown as TableStructure;
  expect(singleForeignKeys(structure)).toEqual([
    { column: 'owner', target: { schema: 'main', name: 'users' }, targetColumn: 'id' },
  ]);
});

it('allows file values only for writable binary columns outside the key', () => {
  const col = (name: string, type: string, generated = 'none') => ({
    name,
    database_type: type,
    generated,
  });
  expect(fileColumn(col('raw', 'BLOB'), ['id'], ['raw'])).toBe(true);
  expect(fileColumn(col('raw', 'bytea'), ['id'], ['raw'])).toBe(true);
  expect(fileColumn(col('raw', 'TEXT'), ['id'], ['raw'])).toBe(false);
  expect(fileColumn(col('raw', 'BLOB'), ['raw'], ['raw'])).toBe(false);
  expect(fileColumn(col('raw', 'BLOB'), ['id'], [])).toBe(false);
  expect(fileColumn(col('raw', 'BLOB', 'stored'), ['id'], ['raw'])).toBe(false);
});
