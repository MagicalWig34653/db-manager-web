// SPDX-License-Identifier: AGPL-3.0-only
import { toConnection } from '$lib/api';
import type { ConnectionDraft } from '$lib/workbench';
import type { components } from '$lib/contract/v18/api-types';

export type Schemas = components['schemas'];
export type Capabilities = Schemas['ImportCapabilities'];
export type Plan = Schemas['ImportPlan'];
export type Job = Schemas['ImportJob'];
export type Result = Schemas['ImportResult'];
export type StatementResult = Schemas['ImportStatementResult'];
export type PlanRequest = Schemas['ImportPlanRequest'];
export type ExecuteRequest = Schemas['ImportExecuteRequest'];
export type Charset = Schemas['CSVImportOptions']['charset'] & string;
export type Compression = 'none' | 'gzip';
export type Format = 'sql' | 'csv';

export const MIB = 1024 * 1024;
/** Contract constants (api-v0.18.0.json); the capabilities response pins the same values. */
export const DEFAULT_TIMEOUT_MS = 60_000;
export const MAX_TIMEOUT_MS = 300_000;
export const MAX_FILE_BYTES = 64 * MIB;
export const MAX_ROWS = 100_000;

export interface CsvForm {
  separator: string;
  quote: string;
  escape: 'double' | 'backslash';
  charset: Charset;
  header: boolean;
  useNull: boolean;
  nullText: string;
  /** Target column for CSV field 1..n, in file order. */
  columns: string[];
}
export interface CommonForm {
  compression: Compression;
  mode: 'stop' | 'skip' | 'continue';
  timeoutMs: number;
  maxRows: number;
  /** SQL only: initial statement delimiter, empty = server default. */
  delimiter: string;
}
export const defaultCsv = (): CsvForm => ({
  separator: ',',
  quote: '"',
  escape: 'double',
  charset: 'utf-8',
  header: true,
  useNull: false,
  nullText: '',
  columns: [],
});
export const defaultCommon = (format: Format): CommonForm => ({
  compression: 'none',
  mode: 'stop',
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxRows: format === 'csv' ? MAX_ROWS : 10_000,
  delimiter: '',
});

export const formatBytes = (bytes: number): string =>
  bytes >= MIB
    ? `${(bytes / MIB).toFixed(bytes >= 10 * MIB ? 0 : 1)} MiB`
    : `${Math.ceil(bytes / 1024)} KiB`;

/** Chosen compression when the user picks a file: gzip is never auto-detected by the server, only suggested here. */
export const suggestCompression = (name: string): Compression =>
  /\.gz$/i.test(name) ? 'gzip' : 'none';

/** i18n key of a problem with the chosen file, or null. */
export function fileProblem(
  file: { size: number } | null,
  maxBytes: number = MAX_FILE_BYTES,
): string | null {
  if (!file) return 'importData.err.noFile';
  if (file.size === 0) return 'importData.err.emptyFile';
  if (file.size > maxBytes) return 'importData.err.fileTooLarge';
  return null;
}

const oneChar = (value: string) => [...value].length === 1;
const forbidden = (value: string) => /[\r\n\0\\]/u.test(value);

/** i18n key of the first problem with the CSV options, or null when they are acceptable. */
export function csvProblem(form: CsvForm, tableColumns: string[]): string | null {
  if (!oneChar(form.separator) || forbidden(form.separator)) return 'importData.err.separator';
  if (!oneChar(form.quote) || forbidden(form.quote)) return 'importData.err.quote';
  if (form.separator === form.quote) return 'importData.err.sameChar';
  if (form.useNull && new TextEncoder().encode(form.nullText).byteLength > MIB)
    return 'importData.err.nullText';
  if (form.columns.length === 0) return 'importData.err.noColumns';
  if (form.columns.length > 1024) return 'importData.err.tooManyColumns';
  if (new Set(form.columns).size !== form.columns.length) return 'importData.err.duplicateColumn';
  if (form.columns.some((name) => !tableColumns.includes(name)))
    return 'importData.err.unknownColumn';
  return null;
}

/** i18n key of the first problem with the shared options, or null. */
export function commonProblem(form: CommonForm, format: Format): string | null {
  if (!Number.isInteger(form.timeoutMs) || form.timeoutMs < 1 || form.timeoutMs > MAX_TIMEOUT_MS)
    return 'importData.err.timeout';
  if (
    !Number.isInteger(form.maxRows) ||
    form.maxRows < 1 ||
    form.maxRows > (format === 'csv' ? MAX_ROWS : 10_000)
  )
    return 'importData.err.maxRows';
  if (format === 'sql' && form.delimiter) {
    if (
      !/^[;!%&*+,\-./:<=>?@^|~$]{1,16}$/.test(form.delimiter) ||
      /^(--|\/\*)/.test(form.delimiter)
    )
      return 'importData.err.delimiter';
  }
  const modes = format === 'csv' ? ['stop', 'skip'] : ['stop', 'continue'];
  if (!modes.includes(form.mode)) return 'importData.err.mode';
  return null;
}

export function csvOptions(form: CsvForm): Schemas['CSVImportMappedOptions'] {
  return {
    columns: [...form.columns],
    separator: form.separator,
    quote: form.quote,
    escape: form.escape,
    charset: form.charset,
    header: form.header,
    ...(form.useNull ? { null: form.nullText } : {}),
  };
}

export function planMetadata(
  connection: ConnectionDraft,
  table: Schemas['TableRef'],
  csv: CsvForm,
  common: CommonForm,
): PlanRequest {
  return {
    connection: toConnection(connection),
    format: 'csv',
    compression: common.compression,
    table: { ...table },
    csv: csvOptions(csv),
    mode: common.mode,
    max_rows: common.maxRows,
    timeout_ms: common.timeoutMs,
  };
}

/** The execute metadata repeats the plan options exactly; the server compares them with the plan hash. */
export function csvExecuteMetadata(plan: PlanRequest, planSha256: string): ExecuteRequest {
  return {
    ...structuredClone(plan),
    confirm: { action: 'import_csv' },
    expected_plan_sha256: planSha256,
  };
}

export function sqlExecuteMetadata(
  connection: ConnectionDraft,
  common: CommonForm,
): ExecuteRequest {
  return {
    connection: toConnection(connection),
    format: 'sql',
    compression: common.compression,
    mode: common.mode === 'continue' ? 'continue' : 'stop',
    max_rows: common.maxRows,
    timeout_ms: common.timeoutMs,
    ...(common.delimiter ? { delimiter: common.delimiter } : {}),
    confirm: { action: 'import_sql' },
  };
}

/** First record of a CSV text split into fields, honouring the quote and escape settings. */
export function firstRecord(
  text: string,
  separator: string,
  quote: string,
  escape: 'double' | 'backslash',
): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;
  const chars = [...text.replace(/^﻿/, '')];
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (quoted) {
      if (escape === 'backslash' && char === '\\' && i + 1 < chars.length) {
        current += chars[++i];
      } else if (char === quote) {
        if (escape === 'double' && chars[i + 1] === quote) {
          current += quote;
          i++;
        } else quoted = false;
      } else current += char;
    } else if (char === quote && current === '') quoted = true;
    else if (char === separator) {
      fields.push(current);
      current = '';
    } else if (char === '\n' || char === '\r') break;
    else current += char;
  }
  fields.push(current);
  return fields;
}

/** Suggests the column mapping from a header row: only when every header name is a distinct table column. */
export function mapFromHeader(header: string[], tableColumns: string[]): string[] | null {
  if (header.length === 0 || new Set(header).size !== header.length) return null;
  return header.every((name) => tableColumns.includes(name)) ? header : null;
}

export const outcomeKey = (outcome: string) =>
  ['completed', 'rejected', 'outcome_unknown', 'not_executed', 'rolled_back'].includes(outcome)
    ? `importData.outcome.${outcome}`
    : 'importData.outcome.other';

const reasons = new Set([
  'query_canceled',
  'database_error',
  'plan_mismatch',
  'invalid_import',
  'import_too_large',
  'result_too_large',
  'sql_not_supported',
  'unsupported_table',
  'unsupported_type',
  'confirmation_mismatch',
  'outcome_unknown',
  'validation_failed',
  'commit_unknown',
  'partial_or_unknown',
  'insert_conflict',
  'constraint_violation',
  'database_busy',
  'timeout',
]);
/** Reason codes are fixed server tokens; unknown ones keep the generic text and are shown as text only. */
export const reasonKey = (code: string) =>
  reasons.has(code) ? `importData.reason.${code}` : 'importData.reason.other';

const issues = new Set([
  'column_count',
  'invalid_integer',
  'invalid_real',
  'invalid_decimal',
  'invalid_boolean',
  'null_not_allowed',
  'text_too_long',
  'unsupported_type',
  'insert_conflict',
  'constraint_violation',
  'database_error',
  'query_canceled',
]);
export const issueKey = (code: string) =>
  issues.has(code) ? `importData.issue.${code}` : 'importData.issue.other';

/** Whether any part of the result leaves the database state unconfirmed. */
export function resultUnknown(result: Result): boolean {
  return (
    result.outcome === 'outcome_unknown' ||
    result.statements.some((statement) => statement.outcome === 'outcome_unknown')
  );
}

export function statementCounts(statements: StatementResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const statement of statements)
    counts[statement.outcome] = (counts[statement.outcome] ?? 0) + 1;
  return counts;
}
