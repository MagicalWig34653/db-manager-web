// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { emptyConnection } from '$lib/workbench';
import {
  commonProblem,
  csvExecuteMetadata,
  csvOptions,
  csvProblem,
  defaultCommon,
  defaultCsv,
  fileProblem,
  firstRecord,
  formatBytes,
  issueKey,
  mapFromHeader,
  outcomeKey,
  planMetadata,
  reasonKey,
  resultUnknown,
  sqlExecuteMetadata,
  statementCounts,
  suggestCompression,
  type Result,
} from './model';
import * as validators from '$lib/contract/v18/validators.js';

const columns = ['id', 'name', 'note'];
const connection = { ...emptyConnection(), database: 'synthetic' };

it('limits the file before any upload', () => {
  expect(fileProblem(null)).toBe('importData.err.noFile');
  expect(fileProblem({ size: 0 })).toBe('importData.err.emptyFile');
  expect(fileProblem({ size: 64 * 1024 * 1024 })).toBeNull();
  expect(fileProblem({ size: 64 * 1024 * 1024 + 1 })).toBe('importData.err.fileTooLarge');
  expect(fileProblem({ size: 11 }, 10)).toBe('importData.err.fileTooLarge');
  expect(suggestCompression('dump.sql.GZ')).toBe('gzip');
  expect(suggestCompression('data.csv')).toBe('none');
  expect(formatBytes(2048)).toBe('2 KiB');
  expect(formatBytes(64 * 1024 * 1024)).toBe('64 MiB');
});

it('validates CSV options like the contract does', () => {
  const ok = { ...defaultCsv(), columns: ['id', 'name'] };
  expect(csvProblem(ok, columns)).toBeNull();
  expect(csvProblem({ ...ok, separator: '' }, columns)).toBe('importData.err.separator');
  expect(csvProblem({ ...ok, separator: ';;' }, columns)).toBe('importData.err.separator');
  expect(csvProblem({ ...ok, separator: '\\' }, columns)).toBe('importData.err.separator');
  expect(csvProblem({ ...ok, separator: '\n' }, columns)).toBe('importData.err.separator');
  expect(csvProblem({ ...ok, quote: '\0' }, columns)).toBe('importData.err.quote');
  expect(csvProblem({ ...ok, separator: '"' }, columns)).toBe('importData.err.sameChar');
  expect(csvProblem({ ...ok, columns: [] }, columns)).toBe('importData.err.noColumns');
  expect(csvProblem({ ...ok, columns: ['id', 'id'] }, columns)).toBe(
    'importData.err.duplicateColumn',
  );
  expect(csvProblem({ ...ok, columns: ['id', 'gone'] }, columns)).toBe(
    'importData.err.unknownColumn',
  );
  // One code point, not one UTF-16 unit.
  expect(csvProblem({ ...ok, separator: '\u{1F600}' }, columns)).toBeNull();
  expect(csvOptions({ ...ok, useNull: true, nullText: '' })).toMatchObject({ null: '' });
  expect(csvOptions(ok)).not.toHaveProperty('null');
});

it('validates shared and format specific options', () => {
  expect(commonProblem(defaultCommon('csv'), 'csv')).toBeNull();
  expect(commonProblem(defaultCommon('sql'), 'sql')).toBeNull();
  expect(commonProblem({ ...defaultCommon('csv'), timeoutMs: 300001 }, 'csv')).toBe(
    'importData.err.timeout',
  );
  expect(commonProblem({ ...defaultCommon('csv'), maxRows: 100001 }, 'csv')).toBe(
    'importData.err.maxRows',
  );
  expect(commonProblem({ ...defaultCommon('sql'), maxRows: 10001 }, 'sql')).toBe(
    'importData.err.maxRows',
  );
  expect(commonProblem({ ...defaultCommon('csv'), mode: 'continue' }, 'csv')).toBe(
    'importData.err.mode',
  );
  expect(commonProblem({ ...defaultCommon('sql'), mode: 'skip' }, 'sql')).toBe(
    'importData.err.mode',
  );
  expect(commonProblem({ ...defaultCommon('sql'), delimiter: '--' }, 'sql')).toBe(
    'importData.err.delimiter',
  );
  expect(commonProblem({ ...defaultCommon('sql'), delimiter: '//' }, 'sql')).toBeNull();
});

it('builds plan and execute metadata that the contract validators accept and that repeat the plan options', () => {
  const csv = { ...defaultCsv(), columns: ['id', 'name'], useNull: true, nullText: 'NA' };
  const common = { ...defaultCommon('csv'), mode: 'skip' as const };
  const plan = planMetadata(connection, { schema: 'main', name: 't' }, csv, common);
  expect(validators.ImportPlanRequest(plan)).toBe(true);
  const hash = 'a'.repeat(64);
  const exec = csvExecuteMetadata(plan, hash);
  expect(validators.ImportExecuteRequest(exec)).toBe(true);
  expect(exec).toMatchObject({
    format: 'csv',
    confirm: { action: 'import_csv' },
    expected_plan_sha256: hash,
    mode: 'skip',
    csv: { null: 'NA', columns: ['id', 'name'] },
  });
  // Same options byte for byte (the server binds them into the plan hash).
  const { confirm: _c, expected_plan_sha256: _e, ...rest } = exec;
  expect(rest).toEqual(plan);
  const sql = sqlExecuteMetadata(connection, { ...defaultCommon('sql'), delimiter: '//' });
  expect(validators.ImportExecuteRequest(sql)).toBe(true);
  expect(sql).toMatchObject({ format: 'sql', confirm: { action: 'import_sql' }, delimiter: '//' });
  expect(sql).not.toHaveProperty('expected_plan_sha256');
  expect(sql).not.toHaveProperty('table');
  // A CSV execute without the hash is rejected by the contract.
  expect(validators.ImportExecuteRequest({ ...exec, expected_plan_sha256: undefined })).toBe(false);
});

it('reads the first record with quotes, escapes and BOM', () => {
  expect(firstRecord('﻿id,name\n1,2', ',', '"', 'double')).toEqual(['id', 'name']);
  expect(firstRecord('"a,b","c""d",e\r\nx', ',', '"', 'double')).toEqual(['a,b', 'c"d', 'e']);
  expect(firstRecord('"a\nb",c', ',', '"', 'double')).toEqual(['a\nb', 'c']);
  expect(firstRecord('"a\\"b";c', ';', '"', 'backslash')).toEqual(['a"b', 'c']);
  expect(firstRecord('', ',', '"', 'double')).toEqual(['']);
  expect(mapFromHeader(['id', 'note'], columns)).toEqual(['id', 'note']);
  expect(mapFromHeader(['id', 'id'], columns)).toBeNull();
  expect(mapFromHeader(['id', 'zzz'], columns)).toBeNull();
});

it('maps outcomes, reasons and issues to fixed texts and falls back for unknown codes', () => {
  expect(outcomeKey('rolled_back')).toBe('importData.outcome.rolled_back');
  expect(outcomeKey('<img>')).toBe('importData.outcome.other');
  expect(reasonKey('commit_unknown')).toBe('importData.reason.commit_unknown');
  expect(reasonKey('weird')).toBe('importData.reason.other');
  expect(issueKey('invalid_integer')).toBe('importData.issue.invalid_integer');
  expect(issueKey('weird')).toBe('importData.issue.other');
});

it('treats any unknown statement as an unknown result', () => {
  const base: Result = {
    outcome: 'completed',
    processed: 0,
    inserted: 0,
    skipped: 0,
    statements: [],
    errors: [],
    errors_truncated: false,
    warnings: [],
  };
  expect(resultUnknown(base)).toBe(false);
  expect(resultUnknown({ ...base, outcome: 'outcome_unknown' })).toBe(true);
  const statements = [
    { index: 1, outcome: 'completed' as const, results: [], warnings: [], duration_ms: 1 },
    { index: 2, outcome: 'outcome_unknown' as const, results: [], warnings: [], duration_ms: 1 },
  ];
  expect(resultUnknown({ ...base, statements })).toBe(true);
  expect(statementCounts(statements)).toEqual({ completed: 1, outcome_unknown: 1 });
});
