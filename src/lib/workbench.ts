// SPDX-License-Identifier: AGPL-3.0-only
// Presentation types, independent of the transport contract.
export type Driver = 'sqlite' | 'mysql' | 'postgresql';
export interface ConnectionDraft {
  name: string;
  driver: Driver;
  database: string;
  host: string;
  port: number;
  username: string;
  password: string;
}
export const emptyConnection = (): ConnectionDraft => ({
  name: '',
  driver: 'sqlite',
  database: '',
  host: 'localhost',
  port: 5432,
  username: '',
  password: '',
});
export interface CatalogObject {
  name: string;
  schema?: string;
  type: string;
}
export interface ResultColumn {
  name: string;
  type: string;
}
export interface DisplayCell {
  kind: string;
  value?: string;
}
export interface DisplayResult {
  columns: ResultColumn[];
  rows: DisplayCell[][];
  affectedRows?: string;
  truncated: boolean;
}
export interface Execution {
  results: DisplayResult[];
  elapsedMs: number;
  warnings: string[];
}
export function displayCell(cell: DisplayCell): string {
  if (cell.kind === 'null') return 'NULL';
  return cell.value === undefined ? '' : String(cell.value);
}
export function isNumeric(cell: DisplayCell): boolean {
  return ['integer', 'decimal', 'float'].includes(cell.kind);
}
export function quoteIdentifier(name: string, driver: Driver): string {
  const quote = driver === 'mysql' ? '`' : '"';
  return `${quote}${name.replaceAll(quote, quote + quote)}${quote}`;
}
export function selectObject(object: CatalogObject, driver: Driver): string {
  const parts = object.schema ? [object.schema, object.name] : [object.name];
  return `SELECT * FROM ${parts.map((name) => quoteIdentifier(name, driver)).join('.')};`;
}
