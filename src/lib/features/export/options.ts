// SPDX-License-Identifier: AGPL-3.0-only
// Export form model: builds a contract-valid ExportRequest from the wizard state and explains the
// effective settings before anything is sent.
import { t, formatNumber } from '$lib/i18n';
import type { components } from '$lib/contract/v11/api-types';
import { defaultDelimiter, isCsvFormat, type ExportFormat } from './verify';
import type { ExportApi, ExportRequest } from './run';
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
  // Dump details of API 0.21 (SQL only).
  viewsAsTables: boolean;
  compatibility: '' | 'native' | 'data-only';
  comments: boolean;
  dataStatement: '' | 'insert' | 'insert-ignore' | 'replace';
  /** Catalog key of a source table -> catalog key of the existing target table (aliases). */
  aliases: Record<string, string>;
}

/** Formats that exist since API 0.21; they export data only, never DDL. */
export const EXTENDED_FORMATS: readonly ExportFormat[] = [
  'xml',
  'yaml',
  'php-array',
  'latex',
  'latex-longtable',
  'mediawiki',
  'texy',
  'codegen',
];
export const isExtendedFormat = (format: ExportFormat) => EXTENDED_FORMATS.includes(format);
export const tableKey = (o: { schema?: string; name: string }) =>
  `${o.schema ?? ''}\u0000${o.name}`;

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
  viewsAsTables: false,
  compatibility: '',
  comments: false,
  dataStatement: '',
  aliases: {},
});

export interface BuildContext {
  connection: ConnectionPayload;
  /** True when the file is written through the File System Access API (no memory cap). */
  streamsToDisk: boolean;
  /** Number of regular tables in the catalog (scope "database"). */
  catalogTables: number;
  /** Contract the instance speaks; defaults to 0.21. 0.11 instances only know four formats. */
  api?: ExportApi;
  /** Regular tables of the catalog, used to resolve alias targets (API 0.21). */
  catalog?: TableRef[];
}

export interface Built {
  request: ExportRequest | null;
  problems: string[];
}

const isCsv = isCsvFormat;
const FILENAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/;

function whole(text: string, min: number, max: number): number | null | 'bad' {
  const value = text.trim();
  if (value === '') return null;
  if (!/^\d+$/.test(value)) return 'bad';
  const number = Number(value);
  return number >= min && number <= max ? number : 'bad';
}

const selectedKeys = (form: ExportForm) => new Set(form.tables.map(tableKey));
const refOf = (table: TableRef): TableRef => ({
  ...(table.schema ? { schema: table.schema } : {}),
  name: table.name,
});

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
  const api = context.api ?? 'v21';
  if (api === 'v11' && isExtendedFormat(form.format))
    problems.push(t('exportDump.problem.needsV21'));
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
    if (isCsv(form.format)) problems.push(t('exportDump.problem.serverFormat'));
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
    const dataOnly = api === 'v21' && form.compatibility === 'data-only';
    if (dataOnly && (form.structure || form.drop || form.ifNotExists))
      problems.push(t('exportDump.problem.dataOnlyConflict'));
    const structure = dataOnly ? false : form.structure;
    if (!structure && !form.data) problems.push(t('exportDump.problem.noContent'));
    request.structure = structure;
    request.data = form.data;
    // DROP and IF NOT EXISTS belong to the DDL part; the contract rejects them without structure.
    if (form.drop && structure) request.drop = true;
    if (form.ifNotExists && structure) request.if_not_exists = true;
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
    if (api === 'v21') {
      if (form.viewsAsTables) request.views_as_tables = true;
      if (form.compatibility !== '') request.compatibility = form.compatibility;
      if (form.comments) request.comments = true;
      if (form.dataStatement !== '' && form.dataStatement !== 'insert') {
        if (driver === 'postgres') problems.push(t('exportDump.problem.dataStatementPostgres'));
        else request.data_statement = form.dataStatement;
      }
      const aliases = Object.entries(form.aliases).filter(
        ([source, target]) => target !== '' && selectedKeys(form).has(source),
      );
      if (aliases.length > 0) {
        const catalog = context.catalog ?? [];
        const find = (key: string) => catalog.find((table) => tableKey(table) === key);
        if (form.scope !== 'tables' || (structure && !dataOnly))
          problems.push(t('exportDump.problem.aliasNeedsData'));
        const targets = aliases.map(([, target]) => target);
        if (new Set(targets).size !== targets.length)
          problems.push(t('exportDump.problem.aliasDuplicate'));
        request.aliases = aliases.flatMap(([source, target]) => {
          const from = find(source);
          const to = find(target);
          if (!from || !to) return [];
          return [{ source: refOf(from), target: refOf(to) }];
        });
        if (request.aliases.length !== aliases.length)
          problems.push(t('exportDump.problem.aliasUnknown'));
      }
    }
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
  xml: 'exportDump.format.xml',
  yaml: 'exportDump.format.yaml',
  'php-array': 'exportDump.format.phpArray',
  latex: 'exportDump.format.latex',
  'latex-longtable': 'exportDump.format.latexLongtable',
  mediawiki: 'exportDump.format.mediawiki',
  texy: 'exportDump.format.texy',
  codegen: 'exportDump.format.codegen',
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
    const extra = [
      request.views_as_tables ? t('exportDump.viewsAsTables') : '',
      request.compatibility === 'data-only' ? t('exportDump.compat.dataOnly') : '',
      request.comments ? t('exportDump.comments') : '',
      request.data_statement ? request.data_statement.toUpperCase().replace('-', ' ') : '',
      request.aliases?.length
        ? t('exportDump.preview.aliasCount', { n: request.aliases.length })
        : '',
    ].filter(Boolean);
    if (extra.length)
      rows.push({ label: t('exportDump.preview.dumpDetails'), value: extra.join(', ') });
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
      value: `${request.delimiter === '\t' ? 'Tab' : (request.delimiter ?? defaultDelimiter(format))} · ${request.crlf || format === 'excel-csv' ? 'CRLF' : 'LF'}`,
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

const noticeKey: Record<string, string> = {
  xml: 'xml',
  yaml: 'yaml',
  'php-array': 'php',
  latex: 'latex',
  'latex-longtable': 'longtable',
  mediawiki: 'wiki',
  texy: 'wiki',
  codegen: 'codegen',
};

/** Fidelity and safety remarks that belong next to the chosen settings. */
export function notices(request: ExportRequest, driver: string): string[] {
  const out: string[] = [];
  if (request.format === 'excel-csv') out.push(t('exportDump.notice.excel'));
  if (request.format === 'csv') out.push(t('exportDump.notice.csvFormula'));
  if (request.scope === 'query') out.push(t('exportDump.notice.queryBestEffort'));
  if (request.scope === 'server') out.push(t('exportDump.notice.serverSnapshot'));
  const kind = (request.format ?? 'sql') as ExportFormat;
  if (isExtendedFormat(kind)) {
    out.push(t('exportDump.notice.textFormat'));
    out.push(t(`exportDump.notice.fmt.${noticeKey[kind]}`));
  }
  if (request.views_as_tables) out.push(t('exportDump.notice.views'));
  if (request.data_statement && request.data_statement !== 'insert')
    out.push(t('exportDump.notice.dataStatement'));
  if (request.aliases?.length) out.push(t('exportDump.notice.alias'));
  if (request.compatibility === 'data-only') out.push(t('exportDump.notice.dataOnly'));
  if ((request.format ?? 'sql') === 'sql') out.push(t('exportDump.notice.sqlFidelity'));
  if ((request.format ?? 'sql') === 'sql' && driver === 'mysql')
    out.push(t('exportDump.notice.mysqlDdl'));
  return out;
}
