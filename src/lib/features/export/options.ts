// SPDX-License-Identifier: AGPL-3.0-only
// Export form model: builds a contract-valid ExportRequest from the wizard state and explains the
// effective settings before anything is sent.
import { t, formatNumber } from '$lib/i18n';
import type { components } from '$lib/contract/v11/api-types';
import type { ExportFormat } from './verify';
import type { ExportRequest } from './run';
import { MEMORY_LIMIT_BYTES } from './sinks';

export type Scope = 'tables' | 'database' | 'server' | 'query';
export type TableRef = components['schemas']['ExportTableRef'];
export type ConnectionPayload = components['schemas']['Connection'];

export interface ExportForm {
  scope: Scope;
  format: ExportFormat;
  tables: TableRef[];
  /** One database name per line (scope "server"). */
  databases: string;
  sql: string;
  structure: boolean;
  data: boolean;
  drop: boolean;
  ifNotExists: boolean;
  extended: boolean;
  transaction: boolean;
  disableFk: boolean;
  /** '' keeps the server default. */
  delimiter: '' | ',' | ';' | '\t';
  crlf: boolean;
  charset: 'utf-8' | 'utf-8-bom';
  gzip: boolean;
  filename: string;
  /** Blank = server default. */
  maxRows: string;
  maxMiB: string;
  timeoutS: string;
  statementKiB: string;
}

export const defaultForm = (): ExportForm => ({
  scope: 'tables',
  format: 'sql',
  tables: [],
  databases: '',
  sql: '',
  structure: true,
  data: true,
  drop: false,
  ifNotExists: false,
  extended: false,
  transaction: false,
  disableFk: false,
  delimiter: '',
  crlf: false,
  charset: 'utf-8',
  gzip: false,
  filename: '',
  maxRows: '',
  maxMiB: '',
  timeoutS: '',
  statementKiB: '',
});

export interface BuildContext {
  connection: ConnectionPayload;
  /** True when the file is written through the File System Access API (no memory cap). */
  streamsToDisk: boolean;
  /** Number of regular tables in the catalog (scope "database"). */
  catalogTables: number;
}

export interface Built {
  request: ExportRequest | null;
  problems: string[];
}

const isCsv = (format: ExportFormat) => format === 'csv' || format === 'excel-csv';
const FILENAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/;

function whole(text: string, min: number, max: number): number | null | 'bad' {
  const value = text.trim();
  if (value === '') return null;
  if (!/^\d+$/.test(value)) return 'bad';
  const number = Number(value);
  return number >= min && number <= max ? number : 'bad';
}

export function parseDatabases(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
}

export function buildRequest(form: ExportForm, context: BuildContext): Built {
  const problems: string[] = [];
  const driver = context.connection.driver;
  const request: ExportRequest = {
    connection: context.connection,
    format: form.format,
    scope: form.scope,
  };

  if (form.scope === 'query') {
    if (form.format === 'sql') problems.push(t('exportDump.problem.querySql'));
    if (form.sql.trim() === '') problems.push(t('exportDump.problem.noQuery'));
    else request.sql = form.sql;
  } else if (form.scope === 'tables') {
    if (form.tables.length === 0) problems.push(t('exportDump.problem.noTables'));
    if (form.tables.length > 100) problems.push(t('exportDump.problem.tooManyTables'));
    request.tables = form.tables.map((table) => ({
      ...(table.schema ? { schema: table.schema } : {}),
      name: table.name,
    }));
  } else if (form.scope === 'server') {
    const names = parseDatabases(form.databases);
    if (names.length === 0) problems.push(t('exportDump.problem.noDatabases'));
    if (names.length > 20) problems.push(t('exportDump.problem.tooManyDatabases'));
    if (form.format !== 'sql' && form.format !== 'json')
      problems.push(t('exportDump.problem.serverFormat'));
    if (form.format === 'sql' && driver !== 'mysql')
      problems.push(t('exportDump.problem.serverSql'));
    request.databases = names;
  } else if (context.catalogTables === 0) {
    problems.push(t('exportDump.problem.emptyDatabase'));
  }
  if (isCsv(form.format) && form.scope !== 'query') {
    if (form.scope === 'tables' && form.tables.length !== 1)
      problems.push(t('exportDump.problem.csvOneTable'));
    if (form.scope === 'database' && context.catalogTables !== 1)
      problems.push(t('exportDump.problem.csvOneTable'));
    if (form.scope === 'server') problems.push(t('exportDump.problem.serverFormat'));
  }

  if (form.format === 'sql') {
    if (!form.structure && !form.data) problems.push(t('exportDump.problem.noContent'));
    request.structure = form.structure;
    request.data = form.data;
    if (form.drop) request.drop = true;
    if (form.ifNotExists) request.if_not_exists = true;
    if (form.extended) request.extended = true;
    if (form.transaction) request.transaction = true;
    if (form.disableFk) {
      if (driver === 'postgres') problems.push(t('exportDump.problem.fkPostgres'));
      else request.disable_fk = true;
    }
    const statement = whole(form.statementKiB, 1, 4096);
    if (statement === 'bad' || (typeof statement === 'number' && statement < 1))
      problems.push(t('exportDump.problem.statement'));
    else if (statement !== null) request.max_statement_bytes = statement * 1024;
  }
  if (isCsv(form.format)) {
    if (form.delimiter) request.delimiter = form.delimiter;
    if (form.crlf) request.crlf = true;
  }
  if (form.charset === 'utf-8-bom') request.charset = 'utf-8-bom';
  if (form.gzip) request.gzip = true;
  if (form.filename.trim() !== '') {
    if (!FILENAME.test(form.filename.trim())) problems.push(t('exportDump.problem.filename'));
    else request.filename = form.filename.trim();
  }

  const rows = whole(form.maxRows, 1, 10_000_000);
  if (rows === 'bad') problems.push(t('exportDump.problem.maxRows'));
  else if (rows !== null) request.max_rows = rows;
  const mib = whole(form.maxMiB, 1, 1024);
  if (mib === 'bad') problems.push(t('exportDump.problem.maxBytes'));
  else if (mib !== null) {
    if (!context.streamsToDisk && mib * 1024 * 1024 > MEMORY_LIMIT_BYTES)
      problems.push(t('exportDump.problem.memoryCap', { mib: MEMORY_LIMIT_BYTES / 1024 / 1024 }));
    request.max_bytes = mib * 1024 * 1024;
  }
  const seconds = whole(form.timeoutS, 1, 300);
  if (seconds === 'bad') problems.push(t('exportDump.problem.timeout'));
  else if (seconds !== null) request.timeout_ms = seconds * 1000;

  return { request: problems.length ? null : request, problems };
}

export interface PreviewRow {
  label: string;
  value: string;
}

const scopeKeys: Record<Scope, string> = {
  tables: 'exportDump.scope.tables',
  database: 'exportDump.scope.database',
  server: 'exportDump.scope.server',
  query: 'exportDump.scope.query',
};
const formatKeys: Record<ExportFormat, string> = {
  sql: 'exportDump.format.sql',
  csv: 'exportDump.format.csv',
  'excel-csv': 'exportDump.format.excelCsv',
  json: 'exportDump.format.json',
};
export const scopeLabel = (scope: Scope) => t(scopeKeys[scope]);
export const formatLabel = (format: ExportFormat) => t(formatKeys[format]);

/** Human-readable summary of exactly what the request will do (no connection data, no SQL text). */
export function previewRows(request: ExportRequest, streamsToDisk: boolean): PreviewRow[] {
  const yes = t('exportDump.yes');
  const no = t('exportDump.no');
  const format = (request.format ?? 'sql') as ExportFormat;
  const rows: PreviewRow[] = [
    {
      label: t('exportDump.preview.scope'),
      value: scopeLabel((request.scope ?? 'tables') as Scope),
    },
    { label: t('exportDump.preview.format'), value: formatLabel(format) },
  ];
  if (request.scope === 'query')
    rows.push({
      label: t('exportDump.preview.query'),
      value: t('exportDump.preview.queryValue', { n: request.sql?.length ?? 0 }),
    });
  else if (request.scope === 'server')
    rows.push({
      label: t('exportDump.preview.databases'),
      value: (request.databases ?? []).join(', '),
    });
  else if (request.scope === 'tables' || request.tables)
    rows.push({
      label: t('exportDump.preview.tables'),
      value: (request.tables ?? [])
        .map((table) => (table.schema ? `${table.schema}.${table.name}` : table.name))
        .join(', '),
    });
  if (format === 'sql') {
    rows.push({
      label: t('exportDump.preview.content'),
      value: [
        request.structure ? t('exportDump.structure') : '',
        request.data ? t('exportDump.data') : '',
      ]
        .filter(Boolean)
        .join(' + '),
    });
    rows.push({
      label: t('exportDump.preview.sqlOptions'),
      value: [
        request.drop ? 'DROP' : '',
        request.if_not_exists ? 'IF NOT EXISTS' : '',
        request.extended ? t('exportDump.extended') : t('exportDump.singleInserts'),
        request.transaction ? t('exportDump.transaction') : '',
        request.disable_fk ? t('exportDump.disableFk') : '',
      ]
        .filter(Boolean)
        .join(', '),
    });
  } else if (isCsvFormat(format)) {
    rows.push({
      label: t('exportDump.preview.csv'),
      value: `${request.delimiter === '\t' ? 'Tab' : (request.delimiter ?? (format === 'excel-csv' ? ';' : ','))} · ${request.crlf || format === 'excel-csv' ? 'CRLF' : 'LF'}`,
    });
  }
  rows.push({
    label: t('exportDump.preview.charset'),
    value: request.charset === 'utf-8-bom' || format === 'excel-csv' ? 'UTF-8 (BOM)' : 'UTF-8',
  });
  rows.push({ label: t('exportDump.preview.gzip'), value: request.gzip ? yes : no });
  rows.push({
    label: t('exportDump.preview.limits'),
    value: t('exportDump.preview.limitsValue', {
      rows: request.max_rows ? formatNumber(request.max_rows) : t('exportDump.serverDefault'),
      mib: request.max_bytes ? String(request.max_bytes / 1024 / 1024) : '64',
      seconds: request.timeout_ms ? String(request.timeout_ms / 1000) : '60',
    }),
  });
  rows.push({
    label: t('exportDump.preview.target'),
    value: streamsToDisk ? t('exportDump.target.disk') : t('exportDump.target.memory'),
  });
  return rows;
}
const isCsvFormat = isCsv;

/** Fidelity and safety remarks that belong next to the chosen settings. */
export function notices(request: ExportRequest, driver: string): string[] {
  const out: string[] = [];
  if (request.format === 'excel-csv') out.push(t('exportDump.notice.excel'));
  if (request.format === 'csv') out.push(t('exportDump.notice.csvFormula'));
  if (request.scope === 'query') out.push(t('exportDump.notice.queryBestEffort'));
  if (request.scope === 'server') out.push(t('exportDump.notice.serverSnapshot'));
  if ((request.format ?? 'sql') === 'sql') out.push(t('exportDump.notice.sqlFidelity'));
  if ((request.format ?? 'sql') === 'sql' && driver === 'mysql')
    out.push(t('exportDump.notice.mysqlDdl'));
  return out;
}
