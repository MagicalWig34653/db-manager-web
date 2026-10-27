// SPDX-License-Identifier: AGPL-3.0-only
import type { DisplayResult, DisplayCell } from './workbench';
export const MAX_EXPORT_BYTES = 8 * 1024 * 1024;
export type ExportScope =
  | { kind: 'sql_result' }
  | { kind: 'table_page'; offset: number; page_size: number; has_more: boolean }
  // Rows the user ticked on one loaded table page (W-P13); same page coordinates, only the selected rows are exported.
  | { kind: 'table_selection'; offset: number; page_size: number; has_more: boolean };
export type ExportFormat = 'json' | 'csv-spreadsheet' | 'csv-raw';
const kinds = new Set([
  'null',
  'text',
  'integer',
  'decimal',
  'float',
  'boolean',
  'binary',
  'timestamp',
]);
function copyCell(cell: DisplayCell): DisplayCell {
  if (!kinds.has(cell.kind) || (cell.kind !== 'null' && typeof cell.value !== 'string'))
    throw new Error('Das Ergebnis enthält einen ungültigen Zellwert.');
  return cell.kind === 'null' ? { kind: 'null' } : { kind: cell.kind, value: cell.value! };
}
export function snapshot(result: DisplayResult, scope: ExportScope) {
  if (result.rows.some((row) => row.length !== result.columns.length))
    throw new Error('Die Ergebniszeilen passen nicht zu den Spalten.');
  const source =
    scope.kind === 'sql_result'
      ? { kind: 'sql_result' as const }
      : {
          kind: scope.kind,
          offset: scope.offset,
          page_size: scope.page_size,
          has_more: scope.has_more,
        };
  return {
    schema_version: 1 as const,
    scope: source,
    truncated: result.truncated,
    columns: result.columns.map((column) => ({ name: column.name, type: column.type })),
    rows: result.rows.map((row) => row.map(copyCell)),
  };
}
export function encodeExport(result: DisplayResult, scope: ExportScope, format: ExportFormat) {
  const data = snapshot(result, scope);
  let content: string;
  if (format === 'json') content = JSON.stringify(data, null, 2) + '\n';
  else {
    const quote = (value: string) => {
      if (/[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(value))
        throw new Error(
          'Dieses Ergebnis enthält Steuerzeichen, die CSV hier nicht unterstützt. Lade es als JSON unverändert herunter.',
        );
      return '"' + ((format === 'csv-spreadsheet' ? "'" : '') + value).replaceAll('"', '""') + '"';
    };
    content =
      [
        data.columns.map((column) => quote(column.name)).join(','),
        ...data.rows.map((row) =>
          row.map((cell) => (cell.kind === 'null' ? '\\N' : quote(cell.value!))).join(','),
        ),
      ].join('\r\n') + '\r\n';
  }
  const bytes = new TextEncoder().encode(content);
  if (bytes.byteLength > MAX_EXPORT_BYTES)
    throw new Error('Der Export überschreitet 8 MiB. Es wurde keine Datei erzeugt.');
  return {
    bytes,
    mime: format === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8',
    filename: format === 'json' ? 'db-manager-result.json' : 'db-manager-result.csv',
  };
}
