// SPDX-License-Identifier: AGPL-3.0-only
import { ApiClient, ApiError } from './api';
import * as validators from './contract/v5/validators.js';
import type { components } from './contract/v5/api-types';
export type StructureSchemas = components['schemas'];
export type TableStructure = StructureSchemas['TableStructure'];
export const stateLabel = (value: string) =>
  ({ yes: 'Ja', no: 'Nein', unknown: 'Unbekannt', not_applicable: 'Nicht anwendbar' })[value] ??
  'Unbekannt';
export const coverageLabel = (value: string) =>
  ({ catalog: 'Katalogangaben', partial: 'Teilweise erfasst', unavailable: 'Nicht verfügbar' })[
    value
  ] ?? 'Unbekannt';
export const actionLabel = (value: string) =>
  ({
    no_action: 'Keine Folgeaktion (NO ACTION)',
    restrict: 'Verhindern (RESTRICT)',
    cascade: 'Weitergeben (CASCADE)',
    set_null: 'Auf NULL setzen',
    set_default: 'Auf Default setzen',
    unknown: 'Unbekannt',
    not_applicable: 'Nicht anwendbar',
  })[value] ?? 'Unbekannt';
export const kindLabel = (value: string) =>
  ({
    primary_key: 'Primärschlüssel',
    unique: 'Eindeutigkeit',
    foreign_key: 'Fremdschlüssel',
    check: 'Prüfbedingung (CHECK)',
    not_null: 'Nicht-NULL',
    other: 'Sonstige',
  })[value] ?? 'Unbekannt';
export const roleLabel = (value: string) =>
  ({
    key: 'Schlüsselterm',
    include: 'Mitgeführter Wert (INCLUDE)',
    auxiliary: 'Hilfsterm',
    unknown: 'Unbekannt',
  })[value] ?? 'Unbekannt';
export const directionLabel = (value: string) =>
  ({
    asc: 'Aufsteigend',
    desc: 'Absteigend',
    unknown: 'Unbekannt',
    not_applicable: 'Nicht anwendbar',
  })[value] ?? 'Unbekannt';
export const objectLabel = (value: StructureSchemas['StructureObjectRef']) =>
  value.schema === undefined ? value.name : `${value.schema} · ${value.name}`;
export function validateStructure<T extends keyof StructureSchemas>(
  name: T,
  data: unknown,
): StructureSchemas[T] {
  if (!validators[name](data))
    throw new ApiError(
      'invalid_response',
      'Die erweiterte Strukturantwort ist ungültig. Die Spaltenstruktur bleibt verfügbar.',
    );
  return data as StructureSchemas[T];
}
export class StructureClient {
  constructor(private client = new ApiClient()) {}
  async read(
    connection: StructureSchemas['Connection'],
    table: StructureSchemas['TableRef'],
    token: string,
    signal: AbortSignal,
  ): Promise<TableStructure> {
    try {
      const cap = validateStructure(
        'StructureCapabilities',
        await this.client.requestRaw('/api/v5/capabilities', token, undefined, signal),
      );
      if (!cap.features.includes('table_structure'))
        throw new ApiError(
          'unsupported_feature',
          'Diese Instanz bietet keine erweiterten Index-/Constraintangaben. Die Spaltenstruktur bleibt verfügbar.',
        );
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'not_found')
        throw new ApiError(
          'unsupported_feature',
          'Diese Instanz bietet keine erweiterten Index-/Constraintangaben. Die Spaltenstruktur bleibt verfügbar.',
        );
      throw cause;
    }
    const body = { connection, table };
    validateStructure('DescribeRequest', body);
    const data = validateStructure(
      'TableStructure',
      await this.client.requestRaw('/api/v5/tables/structure', token, body, signal),
    );
    if (
      data.table.name !== table.name ||
      (table.schema !== undefined && data.table.schema !== table.schema)
    )
      throw new ApiError(
        'invalid_response',
        'Die Strukturangaben gehören nicht zur ausgewählten Tabelle.',
      );
    if (
      data.indexes.reduce((sum, index) => sum + index.terms.length, 0) > 8192 ||
      data.indexes.some(
        (index) => new Set(index.terms.map((term) => term.position)).size !== index.terms.length,
      )
    )
      throw new ApiError(
        'invalid_response',
        'Die Indexpositionen oder Metadatengrenzen sind ungültig.',
      );
    return {
      ...data,
      indexes: data.indexes.map((index) => ({
        ...index,
        terms: [...index.terms].sort((a, b) => a.position - b.position),
      })),
    };
  }
}
export const structure = new StructureClient();
