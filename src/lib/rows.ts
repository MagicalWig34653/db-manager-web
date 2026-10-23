// SPDX-License-Identifier: AGPL-3.0-only
import { ApiClient, ApiError } from './api';
import * as v3 from './contract/v3/validators.js';
import * as v4 from './contract/v4/validators.js';
import type { components } from './contract/v4/api-types';
import { prepareFilters } from './tables';
import type { DisplayResult } from './workbench';
export type RowSchemas = components['schemas'];
export type Snapshot = RowSchemas['RowSnapshot'];
export type Cell = RowSchemas['Cell'];
export type Change = RowSchemas['RowChange'];
export type Eligibility = {
  update: RowSchemas['MutationEligibility'];
  insert: RowSchemas['InsertEligibility'];
};
export type Operation = 'insert' | 'update' | 'delete';
export type WritePhase = 'sending' | 'settled' | 'unknown';
export interface FieldDraft {
  column: string;
  mode: 'default' | 'unchanged' | 'null' | 'value';
  kind: Exclude<Cell['kind'], 'null'>;
  value: string;
  locked: boolean;
}
export const UNKNOWN_MESSAGE =
  'Der Ausgang ist unbekannt. Die Datenbank kann die Änderung bereits übernommen haben. Nicht erneut senden; prüfe zuerst den aktuellen Datenbankstand.';
export const copySnapshot = (value: Snapshot): Snapshot => ({
  columns: [...value.columns],
  values: value.values.map((cell) => ({ ...cell })),
});
export function validateRow<T extends keyof RowSchemas>(name: T, value: unknown): RowSchemas[T] {
  const validate = name.startsWith('Insert')
    ? v4[name as keyof typeof v4]
    : v3[name as keyof typeof v3];
  if (!validate || !validate(value))
    throw new ApiError(
      'invalid_response',
      'Die Antwort des Zeileneditors ist ungültig. Prüfe die Version deiner Instanz.',
    );
  return value as RowSchemas[T];
}
export function snapshotResult(
  snapshot: Snapshot,
  description: RowSchemas['TableDescription'],
): DisplayResult {
  if (snapshot.columns.length !== snapshot.values.length)
    throw new ApiError('invalid_response', 'Der gemeldete Zeilenzustand ist unvollständig.');
  return {
    columns: snapshot.columns.map((name) => ({
      name,
      type: description.columns.find((column) => column.name === name)?.database_type ?? '',
    })),
    rows: [snapshot.values.map((cell) => ({ ...cell }))],
    truncated: false,
  };
}
export function defaultKind(type: string): FieldDraft['kind'] {
  if (/INT/i.test(type)) return 'integer';
  if (/DECIMAL|NUMERIC/i.test(type)) return 'decimal';
  if (/REAL|FLOAT|DOUBLE/i.test(type)) return 'float';
  if (/BOOL/i.test(type)) return 'boolean';
  if (/BLOB|BINARY|BYTEA/i.test(type)) return 'binary';
  if (/DATE|TIME/i.test(type)) return 'timestamp';
  return 'text';
}
export function prepareChanges(fields: FieldDraft[], operation: Operation): Change[] {
  const changes: Change[] = [];
  for (const field of fields) {
    if (field.locked || field.mode === 'default' || field.mode === 'unchanged') continue;
    const value: Cell =
      field.mode === 'null' ? { kind: 'null' } : { kind: field.kind, value: field.value };
    if (value.kind !== 'null')
      prepareFilters(
        [{ column: field.column, operator: 'eq', kind: field.kind, value: field.value }],
        [field.column],
      );
    changes.push({ column: field.column, value });
  }
  if (operation === 'update' && changes.length === 0)
    throw new Error('Wähle mindestens einen Wert zum Ändern.');
  return changes;
}
export class RowClient {
  constructor(private client = new ApiClient()) {}
  async eligibility(
    connection: RowSchemas['Connection'],
    table: RowSchemas['TableRef'],
    token: string,
    signal: AbortSignal,
  ): Promise<Eligibility> {
    try {
      const cap4 = validateRow(
        'InsertCapabilities',
        await this.client.requestRaw('/api/v4/capabilities', token, undefined, signal),
      );
      const cap3 = validateRow(
        'MutationCapabilities',
        await this.client.requestRaw('/api/v3/capabilities', token, undefined, signal),
      );
      if (
        !['row_insert_eligibility', 'row_insert'].every((feature) =>
          cap4.features.includes(feature as never),
        ) ||
        !['row_eligibility', 'row_update', 'row_delete'].every((feature) =>
          cap3.features.includes(feature as never),
        )
      )
        throw new ApiError(
          'unsupported_feature',
          'Diese Instanz bietet keinen freigegebenen Zeileneditor. SQL und Tabellenansicht bleiben verfügbar.',
        );
    } catch (cause) {
      if (cause instanceof ApiError && ['not_found', 'invalid_response'].includes(cause.code))
        throw new ApiError(
          'unsupported_feature',
          'Diese Instanz bietet keinen freigegebenen Zeileneditor. SQL und Tabellenansicht bleiben verfügbar.',
        );
      throw cause;
    }
    const input = { connection, table };
    const update = validateRow(
      'MutationEligibility',
      await this.client.requestRaw('/api/v3/tables/eligibility', token, input, signal),
    );
    const insert = validateRow(
      'InsertEligibility',
      await this.client.requestRaw('/api/v4/tables/insert-eligibility', token, input, signal),
    );
    for (const description of [update.description, insert.description]) {
      if (
        description.table.name !== table.name ||
        (table.schema !== undefined && description.table.schema !== table.schema)
      )
        throw new ApiError(
          'invalid_response',
          'Die Eignung gehört nicht zur ausgewählten Tabelle.',
        );
    }
    return { update, insert };
  }
  async mutate(
    operation: Operation,
    connection: RowSchemas['Connection'],
    table: RowSchemas['TableRef'],
    expected: Snapshot | null,
    changes: Change[],
    token: string,
    signal: AbortSignal,
    onDispatch: () => void,
  ): Promise<RowSchemas['MutationResult'] | RowSchemas['InsertResult']> {
    const input =
      operation === 'insert'
        ? { connection, table, values: changes, confirm: true as const, timeout_ms: 10000 }
        : {
            connection,
            table,
            expected: expected!,
            confirm: true as const,
            timeout_ms: 10000,
            ...(operation === 'update' ? { changes } : {}),
          };
    const schema =
      operation === 'insert'
        ? 'InsertRequest'
        : operation === 'update'
          ? 'UpdateRequest'
          : 'DeleteRequest';
    validateRow(schema, input);
    if (signal.aborted) throw new DOMException('Abgebrochen', 'AbortError');
    let dispatched = false;
    try {
      const payload = await this.client.requestRaw(
        `/api/v${operation === 'insert' ? 4 : 3}/rows/${operation}`,
        token,
        input,
        signal,
        {
          onDispatch: () => {
            dispatched = true;
            onDispatch();
          },
        },
      );
      const result =
        operation === 'insert'
          ? validateRow('InsertResult', payload)
          : validateRow('MutationResult', payload);
      if (result.row) {
        validateRow('RowSnapshot', result.row);
        if (
          result.row.columns.length !== result.row.values.length ||
          new Set(result.row.columns).size !== result.row.columns.length
        )
          throw new ApiError('invalid_response', 'Die gemeldete Nachherzeile ist unvollständig.');
      }
      return result;
    } catch (cause) {
      if (
        dispatched &&
        (!(cause instanceof ApiError) ||
          ['invalid_response', 'outcome_unknown', 'network_error', 'timeout'].includes(cause.code))
      )
        throw new ApiError('outcome_unknown', UNKNOWN_MESSAGE);
      throw cause;
    }
  }
}
export const rows = new RowClient();
