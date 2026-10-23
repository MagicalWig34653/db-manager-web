// SPDX-License-Identifier: AGPL-3.0-only
import { ApiClient, ApiError } from './api';
import * as validators from './contract/v6/validators.js';
import type { components } from './contract/v6/api-types';
export type CreateSchemas = components['schemas'];
export type CreateResult = CreateSchemas['CreateTableResult'];
export type CreateRequest = CreateSchemas['CreateTableRequest'];
export type TypeKind = CreateSchemas['CreateType']['kind'];
export interface CreateColumnDraft {
  id: number;
  name: string;
  kind: TypeKind;
  length: string;
  precision: string;
  scale: string;
  nullable: boolean;
  defaultMode: 'none' | 'null' | 'value';
  value: string;
}
export interface CreateDraft {
  name: string;
  schema: string;
  columns: CreateColumnDraft[];
  primary: number[];
}
export const CREATE_UNKNOWN_MESSAGE =
  'Die Tabelle könnte bereits angelegt sein. Nicht erneut senden oder entfernen. Prüfe zuerst den aktuellen Datenbankstand; es gibt keine automatische Wiederholung.';
export const newCreateColumn = (id: number): CreateColumnDraft => ({
  id,
  name: '',
  kind: 'text',
  length: '255',
  precision: '20',
  scale: '4',
  nullable: true,
  defaultMode: 'none',
  value: '',
});
export const newCreateDraft = (): CreateDraft => ({
  name: '',
  schema: '',
  columns: [{ ...newCreateColumn(1), name: 'id', kind: 'int64', nullable: false }],
  primary: [1],
});
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const wellFormed = (value: string) =>
  ![...value].some((character) => {
    const code = character.codePointAt(0)!;
    return code >= 0xd800 && code <= 0xdfff;
  });
function identifier(value: string, label: string) {
  if (!value || value.includes('\0') || !wellFormed(value) || bytes(value) > 63)
    throw new Error(
      `${label}: 1 bis 63 UTF-8-Bytes ohne NUL erforderlich. Namen werden nicht gekürzt oder bereinigt.`,
    );
}
function parameter(value: string, minimum: number, maximum: number, label: string) {
  if (
    !/^[0-9]+$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < minimum ||
    Number(value) > maximum
  )
    throw new Error(`${label}: ganze Zahl von ${minimum} bis ${maximum} erforderlich.`);
  return Number(value);
}
export function validateCreate<T extends keyof CreateSchemas>(
  name: T,
  value: unknown,
): CreateSchemas[T] {
  if (!validators[name](value))
    throw new ApiError(
      name === 'CreateTableRequest' ? 'invalid_request' : 'invalid_response',
      name === 'CreateTableRequest'
        ? 'Die Tabellendefinition ist ungültig.'
        : 'Die Antwort der Tabellenanlage ist ungültig. Prüfe die Version deiner Instanz.',
    );
  return value as CreateSchemas[T];
}
export function prepareCreate(
  draft: CreateDraft,
  connection: CreateSchemas['Connection'],
): CreateRequest {
  identifier(draft.name, 'Tabellenname');
  if (draft.schema !== '') identifier(draft.schema, 'Schema');
  const schema =
    draft.schema ||
    (connection.driver === 'sqlite'
      ? 'main'
      : connection.driver === 'mysql'
        ? (connection.database ?? '')
        : 'public');
  identifier(schema, 'Schema');
  if (
    (connection.driver === 'sqlite' &&
      (schema !== 'main' || draft.name.toLowerCase().startsWith('sqlite_'))) ||
    (connection.driver === 'mysql' &&
      ['mysql', 'sys', 'information_schema', 'performance_schema'].includes(
        schema.toLowerCase(),
      )) ||
    (connection.driver === 'postgres' &&
      (schema.toLowerCase().startsWith('pg_') || schema.toLowerCase() === 'information_schema'))
  )
    throw new Error(
      'Dieses Schema oder dieser Tabellenname ist für die Tabellenanlage nicht freigegeben.',
    );
  if (draft.columns.length < 1 || draft.columns.length > 32)
    throw new Error('Definiere 1 bis 32 Spalten.');
  if (draft.primary.length > 8 || new Set(draft.primary).size !== draft.primary.length)
    throw new Error('Der Primärschlüssel erlaubt höchstens acht unterschiedliche Spalten.');
  const names = new Set<string>();
  let textBudget = 0;
  const columns = draft.columns.map((field): CreateSchemas['CreateColumn'] => {
    identifier(field.name, 'Spaltenname');
    const folded = field.name.toLowerCase();
    if (names.has(folded))
      throw new Error('Spaltennamen müssen auch ohne Groß-/Kleinschreibung unterschiedlich sein.');
    names.add(folded);
    let type: CreateSchemas['CreateType'];
    if (field.kind === 'text') {
      const length = parameter(field.length, 1, 1024, 'Textlänge');
      textBudget += length;
      type = { kind: 'text', length };
    } else if (field.kind === 'decimal') {
      const precision = parameter(field.precision, 1, 38, 'Dezimalpräzision');
      type = {
        kind: 'decimal',
        precision,
        scale: parameter(field.scale, 0, precision, 'Dezimalskala'),
      };
    } else type = { kind: field.kind };
    let fallback: CreateSchemas['CreateDefault'] = { mode: field.defaultMode as 'none' | 'null' };
    if (field.defaultMode === 'null' && !field.nullable)
      throw new Error('Ein NULL-Default benötigt eine NULL-fähige Spalte.');
    if (field.defaultMode === 'value') {
      if (type.kind === 'binary')
        throw new Error('Binärspalten unterstützen keinen konstanten Wertdefault.');
      if (type.kind === 'int64') {
        if (!/^-?(0|[1-9][0-9]*)$/.test(field.value) || field.value.length > 20)
          throw new Error('Ganzzahldefault als kanonischen Int64-String eingeben.');
        const value = BigInt(field.value);
        if (
          String(value) !== field.value ||
          value < -9223372036854775808n ||
          value > 9223372036854775807n
        )
          throw new Error('Ganzzahldefault liegt außerhalb des kanonischen Int64-Bereichs.');
      } else if (type.kind === 'decimal') {
        if (!/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(field.value) || field.value.length > 80)
          throw new Error('Dezimaldefault ohne Exponent als exakten String eingeben.');
        const [whole, fraction = ''] = field.value.replace(/^-/, '').split('.');
        if (
          (whole === '0' ? 0 : whole.length) > type.precision - type.scale ||
          fraction.length > type.scale
        )
          throw new Error('Der Dezimaldefault überschreitet Präzision oder Skala.');
      } else if (
        !wellFormed(field.value) ||
        field.value.includes('\0') ||
        bytes(field.value) > 4096 ||
        [...field.value].length > type.length
      )
        throw new Error(
          'Textdefault überschreitet die Textlänge/4096 UTF-8-Bytes oder enthält ungültige Zeichen.',
        );
      fallback = {
        mode: 'value',
        value: { kind: type.kind === 'int64' ? 'integer' : type.kind, value: field.value },
      };
    }
    return { name: field.name, type, nullable: field.nullable, default: fallback };
  });
  if (textBudget > 4096)
    throw new Error('Die Summe aller Textlängen darf höchstens 4096 betragen.');
  let keyBytes = 0;
  const primary_key = draft.primary.map((id) => {
    const index = draft.columns.findIndex((field) => field.id === id);
    if (index < 0) throw new Error('Eine Primärschlüsselspalte fehlt.');
    const column = columns[index];
    if (column.nullable || !['text', 'int64'].includes(column.type.kind))
      throw new Error(
        'Primärschlüsselspalten müssen nicht-NULL und vom Typ Ganzzahl oder Text sein.',
      );
    keyBytes += column.type.kind === 'text' ? column.type.length * 4 : 8;
    return column.name;
  });
  if (keyBytes > 2048)
    throw new Error('Der Primärschlüssel überschreitet das Budget von 2048 Bytes.');
  const input: CreateRequest = {
    connection,
    table: { name: draft.name, ...(draft.schema === '' ? {} : { schema: draft.schema }) },
    columns,
    primary_key,
    confirm: true,
    timeout_ms: 10000,
  };
  validateCreate('CreateTableRequest', input);
  if (bytes(JSON.stringify(input)) > 1024 * 1024)
    throw new ApiError(
      'request_too_large',
      'Die endgültige Tabellendefinition überschreitet 1 MiB.',
    );
  return input;
}
export class CreateTableClient {
  constructor(private client = new ApiClient()) {}
  async capabilities(token: string, signal: AbortSignal) {
    try {
      const result = validateCreate(
        'CreateCapabilities',
        await this.client.requestRaw('/api/v6/capabilities', token, undefined, signal),
      );
      if (!result.features.includes('table_create')) throw new Error('unsupported');
      return result;
    } catch (cause) {
      if (cause instanceof ApiError && !['not_found', 'invalid_response'].includes(cause.code))
        throw cause;
      throw new ApiError(
        'unsupported_feature',
        'Diese Instanz bietet keine freigegebene Tabellenanlage. SQL, Daten und bisherige Strukturansicht bleiben verfügbar.',
      );
    }
  }
  async create(
    input: CreateRequest,
    token: string,
    signal: AbortSignal,
    onDispatch: () => void,
  ): Promise<CreateResult> {
    validateCreate('CreateTableRequest', input);
    if (bytes(JSON.stringify(input)) > 1024 * 1024)
      throw new ApiError(
        'request_too_large',
        'Die endgültige Tabellendefinition überschreitet 1 MiB.',
      );
    await this.capabilities(token, signal);
    let dispatched = false;
    try {
      const payload = await this.client.requestRaw('/api/v6/tables/create', token, input, signal, {
        onDispatch: () => {
          dispatched = true;
          onDispatch();
        },
      });
      return validateCreate('CreateTableResult', payload);
    } catch (cause) {
      if (
        dispatched &&
        (!(cause instanceof ApiError) ||
          ['invalid_response', 'outcome_unknown', 'network_error', 'timeout'].includes(cause.code))
      )
        throw new ApiError('outcome_unknown', CREATE_UNKNOWN_MESSAGE);
      throw cause;
    }
  }
}
export const createTable = new CreateTableClient();
