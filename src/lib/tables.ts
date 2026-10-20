// SPDX-License-Identifier: AGPL-3.0-only
import { ApiClient, ApiError } from './api';
import * as validators from './contract/v2/validators.js';
import type { components } from './contract/v2/api-types';
import type { DisplayResult } from './workbench';
export type TableSchemas = components['schemas'];
export type TableDescription = TableSchemas['TableDescription'];
export type BrowseResult = TableSchemas['BrowseResult'];
export type TableFilter = TableSchemas['TableFilter'];
export type TableSort = TableSchemas['TableSort'];
export function validateTable<T extends keyof TableSchemas>(
  schema: T,
  value: unknown,
): TableSchemas[T] {
  if (!validators[schema](value))
    throw new ApiError(
      'invalid_response',
      'Die Tabellenantwort ist ungültig. Prüfe die Version deiner Instanz.',
    );
  return value as TableSchemas[T];
}
export function tableResult(data: BrowseResult): DisplayResult {
  if (
    data.result.rows.length > data.page_size ||
    data.result.rows.some((row) => row.length !== data.result.columns.length)
  ) {
    throw new ApiError(
      'invalid_response',
      'Die Tabellenzeilen passen nicht zu den gelieferten Spalten oder Seitengrenzen.',
    );
  }
  return {
    columns: data.result.columns.map((column) => ({
      name: column.name,
      type: column.database_type,
    })),
    rows: data.result.rows,
    truncated: data.result.truncated,
  };
}
export class TableClient {
  constructor(private client = new ApiClient()) {}
  async capabilities(token: string, signal: AbortSignal) {
    let payload: unknown;
    try {
      payload = await this.client.requestRaw('/api/v2/capabilities', token, undefined, signal);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'not_found')
        throw new ApiError(
          'unsupported_feature',
          'Diese Instanz bietet noch keine Tabellenansicht. SQL-Abfragen stehen weiterhin zur Verfügung.',
        );
      throw cause;
    }
    const data = validateTable('TableCapabilities', payload);
    if (!data.features.includes('table_describe') || !data.features.includes('table_browse'))
      throw new ApiError(
        'unsupported_feature',
        'Diese Instanz bietet noch keine Tabellenansicht. SQL-Abfragen stehen weiterhin zur Verfügung.',
      );
    return data;
  }
  async describe(input: TableSchemas['DescribeRequest'], token: string, signal: AbortSignal) {
    validateTable('DescribeRequest', input);
    return validateTable(
      'TableDescription',
      await this.client.requestRaw('/api/v2/tables/describe', token, input, signal),
    );
  }
  async browse(input: TableSchemas['BrowseRequest'], token: string, signal: AbortSignal) {
    validateTable('BrowseRequest', input);
    const data = validateTable(
      'BrowseResult',
      await this.client.requestRaw('/api/v2/tables/browse', token, input, signal),
    );
    if (data.offset !== (input.offset ?? 0) || data.page_size !== (input.page_size || 100))
      throw new ApiError(
        'invalid_response',
        'Die gelieferten Seitengrenzen stimmen nicht mit der Anfrage überein.',
      );
    tableResult(data);
    return data;
  }
}
export const tables = new TableClient();
export interface FilterDraft {
  column: string;
  operator: 'eq' | 'is_null' | 'is_not_null';
  kind: TableSchemas['FilterValue']['kind'];
  value: string;
}
export const emptyFilter = (column: string): FilterDraft => ({
  column,
  operator: 'eq',
  kind: 'text',
  value: '',
});
export function prepareFilters(filters: FilterDraft[], columns: string[]): TableFilter[] {
  return filters.map((filter) => {
    if (!columns.includes(filter.column)) throw new Error('Wähle eine vorhandene Filterspalte.');
    if (filter.operator !== 'eq') return { column: filter.column, operator: filter.operator };
    const value = filter.value;
    if (filter.kind === 'integer' && !/^-?\d+$/.test(value))
      throw new Error('Ganze Zahlen ohne Tausendertrennzeichen eingeben.');
    if (filter.kind === 'decimal' && !/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))
      throw new Error('Dezimalwerte mit Punkt und ohne Tausendertrennzeichen eingeben.');
    if (filter.kind === 'float' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))
      throw new Error('Fließkommawerte mit Punkt und optionalem Exponenten eingeben.');
    if (filter.kind === 'boolean' && !['true', 'false'].includes(value))
      throw new Error('Wahrheitswerte als true oder false eingeben.');
    if (
      filter.kind === 'binary' &&
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
    )
      throw new Error('Binärwerte als gültiges Base64 eingeben.');
    return { column: filter.column, operator: 'eq', value: { kind: filter.kind, value } };
  });
}
