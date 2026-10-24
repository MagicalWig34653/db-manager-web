// SPDX-License-Identifier: AGPL-3.0-only
// Form model and client-side pre-check for API 0.6 "create table". The server stays authoritative;
// these checks only mirror the documented limits so that obvious mistakes never leave the browser.
import type { components } from '$lib/contract/v6/api-types';
import { t } from '$lib/i18n';

type Schemas = components['schemas'];
export type CreateTableRequest = Schemas['CreateTableRequest'];
export type CreateColumn = Schemas['CreateColumn'];
export type CreateType = Schemas['CreateType'];
export type CreateDefault = Schemas['CreateDefault'];

export const LIMITS = {
  columns: 32,
  primaryKeyColumns: 8,
  textLength: 1024,
  decimalPrecision: 38,
  nameBytes: 63,
  defaultBytes: 4096,
  textBudget: 4096,
  primaryKeyBytes: 2048,
  decimalDefaultChars: 80,
} as const;

export type TypeKind = 'int64' | 'text' | 'binary' | 'decimal';
export type DefaultMode = 'none' | 'null' | 'value';

export interface ColumnDraft {
  /** Stable identity for keyed rendering and the ordered primary key; never sent. */
  key: number;
  name: string;
  kind: TypeKind;
  length: string;
  precision: string;
  scale: string;
  nullable: boolean;
  defaultMode: DefaultMode;
  defaultValue: string;
}

export interface TableDraft {
  schema: string;
  name: string;
  columns: ColumnDraft[];
  /** Ordered list of column keys that form the primary key (may be empty). */
  primaryKey: number[];
}

export interface Issue {
  /** Where the issue belongs: the table, one column (by key), the key or the whole form. */
  scope: 'table' | 'column' | 'primary-key' | 'form';
  key?: number;
  field?: string;
  message: string;
}

let nextKey = 1;
export const newColumn = (): ColumnDraft => ({
  key: nextKey++,
  name: '',
  kind: 'text',
  length: '255',
  precision: '10',
  scale: '2',
  nullable: true,
  defaultMode: 'none',
  defaultValue: '',
});
export const emptyDraft = (): TableDraft => ({
  schema: '',
  name: '',
  columns: [{ ...newColumn(), name: 'id', kind: 'int64', nullable: false }],
  primaryKey: [],
});

/** Keeps a column internally consistent after the user changed kind, nullability or default. */
export function normalizeColumn(column: ColumnDraft): ColumnDraft {
  const next = { ...column };
  if (next.kind === 'binary' && next.defaultMode === 'value') next.defaultMode = 'none';
  if (!next.nullable && next.defaultMode === 'null') next.defaultMode = 'none';
  if (next.defaultMode !== 'value') next.defaultValue = '';
  return next;
}

const lonelySurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
export const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;
export const wellFormed = (value: string) => !lonelySurrogate.test(value);
const codePoints = (value: string) => Array.from(value).length;
const nameProblem = (name: string): 'empty' | 'long' | 'invalid' | null => {
  if (name === '') return 'empty';
  if (name.includes('\u0000') || !wellFormed(name)) return 'invalid';
  if (utf8Bytes(name) > LIMITS.nameBytes) return 'long';
  return null;
};
const SIGNED64_MIN = -(2n ** 63n);
const SIGNED64_MAX = 2n ** 63n - 1n;
const decimalPattern = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const integerPattern = /^-?(0|[1-9][0-9]*)$/;
const digits = /^[0-9]+$/;

/** Parsed numeric type parameters, or null while the inputs are not valid yet. */
function parseType(column: ColumnDraft): CreateType | null {
  switch (column.kind) {
    case 'int64':
      return { kind: 'int64' };
    case 'binary':
      return { kind: 'binary' };
    case 'text': {
      if (!digits.test(column.length)) return null;
      const length = Number(column.length);
      return length >= 1 && length <= LIMITS.textLength ? { kind: 'text', length } : null;
    }
    case 'decimal': {
      if (!digits.test(column.precision) || !digits.test(column.scale)) return null;
      const precision = Number(column.precision);
      const scale = Number(column.scale);
      return precision >= 1 && precision <= LIMITS.decimalPrecision && scale <= precision
        ? { kind: 'decimal', precision, scale }
        : null;
    }
  }
}

function defaultProblem(column: ColumnDraft, type: CreateType): string | null {
  const value = column.defaultValue;
  if (type.kind === 'int64') {
    if (!integerPattern.test(value) || value === '-0') return t('table-create.errDefaultInteger');
    const parsed = BigInt(value);
    return parsed < SIGNED64_MIN || parsed > SIGNED64_MAX
      ? t('table-create.errDefaultRange')
      : null;
  }
  if (type.kind === 'text') {
    if (!wellFormed(value) || value.includes('\u0000')) return t('table-create.errDefaultText');
    if (utf8Bytes(value) > LIMITS.defaultBytes || codePoints(value) > type.length)
      return t('table-create.errDefaultLength', { length: type.length });
    return null;
  }
  if (type.kind === 'decimal') {
    if (value.length > LIMITS.decimalDefaultChars || !decimalPattern.test(value))
      return t('table-create.errDefaultDecimal');
    const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
    const wholeDigits = whole === '0' ? 0 : whole.length;
    return wholeDigits <= type.precision - type.scale && fraction.length <= type.scale
      ? null
      : t('table-create.errDefaultDigits', { precision: type.precision, scale: type.scale });
  }
  return t('table-create.errDefaultBinary');
}

/** All blocking problems of a draft. An empty list means the request can be built. */
export interface Target {
  driver: 'sqlite' | 'mysql' | 'postgresql';
  /** Connection database; MySQL uses it as the default schema. */
  database: string;
}
const mysqlReserved = new Set(['mysql', 'sys', 'information_schema', 'performance_schema']);

/** Mirrors the server's createRef rules (reserved targets). Server stays authoritative. */
function targetIssues(draft: TableDraft, target: Target): string[] {
  const schema = (draft.schema === '' ? '' : draft.schema).toLowerCase();
  if (target.driver === 'sqlite')
    return draft.name.toLowerCase().startsWith('sqlite_')
      ? [t('table-create.errReservedName')]
      : [];
  if (target.driver === 'mysql') {
    const effective = (draft.schema === '' ? target.database : draft.schema).toLowerCase();
    return mysqlReserved.has(effective) ? [t('table-create.errReservedSchema')] : [];
  }
  return schema.startsWith('pg_') || schema === 'information_schema'
    ? [t('table-create.errReservedSchema')]
    : [];
}

export function validateDraft(draft: TableDraft, target?: Target): Issue[] {
  const issues: Issue[] = [];
  const table = (message: string, field = 'name') =>
    issues.push({ scope: 'table', field, message });
  const tableProblem = nameProblem(draft.name);
  if (tableProblem === 'empty') table(t('table-create.errTableNameEmpty'));
  else if (tableProblem === 'long') table(t('table-create.errNameLong', { max: LIMITS.nameBytes }));
  else if (tableProblem === 'invalid') table(t('table-create.errNameInvalid'));
  if (draft.schema !== '') {
    const schemaProblem = nameProblem(draft.schema);
    if (schemaProblem === 'long')
      table(t('table-create.errNameLong', { max: LIMITS.nameBytes }), 'schema');
    else if (schemaProblem) table(t('table-create.errNameInvalid'), 'schema');
  }
  if (target && tableProblem === null)
    for (const message of targetIssues(draft, target))
      issues.push({
        scope: 'table',
        field: message === t('table-create.errReservedName') ? 'name' : 'schema',
        message,
      });
  if (draft.columns.length < 1)
    issues.push({ scope: 'form', message: t('table-create.errNoColumns') });
  if (draft.columns.length > LIMITS.columns)
    issues.push({
      scope: 'form',
      message: t('table-create.errTooManyColumns', { max: LIMITS.columns }),
    });
  const seen = new Map<string, number>();
  let textBudget = 0;
  for (const column of draft.columns) {
    const add = (field: string, message: string) =>
      issues.push({ scope: 'column', key: column.key, field, message });
    const problem = nameProblem(column.name);
    if (problem === 'empty') add('name', t('table-create.errColumnNameEmpty'));
    else if (problem === 'long')
      add('name', t('table-create.errNameLong', { max: LIMITS.nameBytes }));
    else if (problem === 'invalid') add('name', t('table-create.errNameInvalid'));
    else {
      const folded = column.name.toLowerCase();
      if (seen.has(folded)) add('name', t('table-create.errDuplicateColumn'));
      seen.set(folded, column.key);
    }
    const type = parseType(column);
    if (!type) {
      if (column.kind === 'text')
        add('length', t('table-create.errTextLength', { max: LIMITS.textLength }));
      else add('precision', t('table-create.errDecimal', { max: LIMITS.decimalPrecision }));
      continue;
    }
    if (type.kind === 'text') textBudget += type.length;
    if (column.defaultMode === 'null' && !column.nullable)
      add('default', t('table-create.errNullDefaultNotNull'));
    if (column.defaultMode === 'value') {
      const message = defaultProblem(column, type);
      if (message) add('default', message);
    }
  }
  if (textBudget > LIMITS.textBudget)
    issues.push({
      scope: 'form',
      message: t('table-create.errTextBudget', { max: LIMITS.textBudget, used: textBudget }),
    });
  const byKey = new Map(draft.columns.map((column) => [column.key, column]));
  if (draft.primaryKey.length > LIMITS.primaryKeyColumns)
    issues.push({
      scope: 'primary-key',
      message: t('table-create.errPrimaryKeyCount', { max: LIMITS.primaryKeyColumns }),
    });
  let keyBytes = 0;
  for (const key of draft.primaryKey) {
    const column = byKey.get(key);
    if (!column) continue;
    const label = column.name === '' ? t('table-create.unnamedColumn') : column.name;
    if (column.kind !== 'int64' && column.kind !== 'text')
      issues.push({
        scope: 'primary-key',
        key,
        message: t('table-create.errPrimaryKeyType', { name: label }),
      });
    if (column.nullable)
      issues.push({
        scope: 'primary-key',
        key,
        message: t('table-create.errPrimaryKeyNullable', { name: label }),
      });
    const type = parseType(column);
    if (type?.kind === 'text') keyBytes += 4 * type.length;
    else if (column.kind === 'int64') keyBytes += 8;
  }
  if (keyBytes > LIMITS.primaryKeyBytes)
    issues.push({
      scope: 'primary-key',
      message: t('table-create.errPrimaryKeyBudget', { max: LIMITS.primaryKeyBytes }),
    });
  return issues;
}

function targetOf(connection: Schemas['Connection']): Target {
  return {
    driver: connection.driver === 'postgres' ? 'postgresql' : connection.driver,
    database: connection.database ?? '',
  };
}

/** Builds the request body. Throws when the draft is not valid; call validateDraft first. */
export function buildRequest(
  draft: TableDraft,
  connection: Schemas['Connection'],
  includeSchema = true,
): CreateTableRequest {
  if (validateDraft(draft, targetOf(connection)).length > 0)
    throw new Error('The table definition is not valid.');
  const byKey = new Map(draft.columns.map((column) => [column.key, column]));
  const columns: CreateColumn[] = draft.columns.map((column) => {
    const type = parseType(column)!;
    let def: CreateDefault = { mode: 'none' };
    if (column.defaultMode === 'null') def = { mode: 'null' };
    if (column.defaultMode === 'value')
      def = {
        mode: 'value',
        value: {
          kind: type.kind === 'int64' ? 'integer' : type.kind === 'decimal' ? 'decimal' : 'text',
          value: column.defaultValue,
        },
      };
    return { name: column.name, type, nullable: column.nullable, default: def };
  });
  return {
    connection,
    table: {
      name: draft.name,
      ...(includeSchema && draft.schema !== '' ? { schema: draft.schema } : {}),
    },
    columns,
    primary_key: draft.primaryKey.flatMap((key) => {
      const column = byKey.get(key);
      return column ? [column.name] : [];
    }),
    confirm: true,
  };
}

/** A short, readable type label for summaries (not SQL). */
export function typeLabel(column: ColumnDraft): string {
  switch (column.kind) {
    case 'int64':
      return 'BIGINT';
    case 'binary':
      return t('table-create.typeBinaryShort');
    case 'text':
      return `VARCHAR(${column.length})`;
    case 'decimal':
      return `DECIMAL(${column.precision},${column.scale})`;
  }
}
