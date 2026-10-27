// SPDX-License-Identifier: AGPL-3.0-only
import { ApiClient, ApiError } from './api';
import * as validators from './contract/v5/validators.js';
import type { components } from './contract/v5/api-types';
import { t } from './i18n';
export type StructureSchemas = components['schemas'];
export type TableStructure = StructureSchemas['TableStructure'];
export const stateLabel = (value: string) =>
  t(
    (
      {
        yes: 'structureView.yes',
        no: 'structureView.no',
        unknown: 'structureView.unknown',
        not_applicable: 'structureView.notApplicable',
      } as Record<string, string>
    )[value] ?? 'structureView.unknown',
  );
export const coverageLabel = (value: string) =>
  t(
    (
      {
        catalog: 'structureView.coverageCatalog',
        partial: 'structureView.coveragePartial',
        unavailable: 'structureView.coverageUnavailable',
      } as Record<string, string>
    )[value] ?? 'structureView.unknown',
  );
export const actionLabel = (value: string) =>
  t(
    (
      {
        no_action: 'structureView.actionNoAction',
        restrict: 'structureView.actionRestrict',
        cascade: 'structureView.actionCascade',
        set_null: 'structureView.actionSetNull',
        set_default: 'structureView.actionSetDefault',
        unknown: 'structureView.unknown',
        not_applicable: 'structureView.notApplicable',
      } as Record<string, string>
    )[value] ?? 'structureView.unknown',
  );
export const kindLabel = (value: string) =>
  t(
    (
      {
        primary_key: 'structureView.kindPrimaryKey',
        unique: 'structureView.kindUnique',
        foreign_key: 'structureView.kindForeignKey',
        check: 'structureView.kindCheck',
        not_null: 'structureView.kindNotNull',
        other: 'structureView.kindOther',
      } as Record<string, string>
    )[value] ?? 'structureView.unknown',
  );
export const roleLabel = (value: string) =>
  t(
    (
      {
        key: 'structureView.roleKey',
        include: 'structureView.roleInclude',
        auxiliary: 'structureView.roleAuxiliary',
        unknown: 'structureView.unknown',
      } as Record<string, string>
    )[value] ?? 'structureView.unknown',
  );
export const directionLabel = (value: string) =>
  t(
    (
      {
        asc: 'structureView.dirAsc',
        desc: 'structureView.dirDesc',
        unknown: 'structureView.unknown',
        not_applicable: 'structureView.notApplicable',
      } as Record<string, string>
    )[value] ?? 'structureView.unknown',
  );
export const identifierLabel = (value: string): string => JSON.stringify(value);
export const objectLabel = (value: StructureSchemas['StructureObjectRef']) =>
  value.schema === undefined
    ? identifierLabel(value.name)
    : `${identifierLabel(value.schema)} · ${identifierLabel(value.name)}`;
export function validateStructure<T extends keyof StructureSchemas & keyof typeof validators>(
  name: T,
  data: unknown,
): StructureSchemas[T] {
  if (!validators[name](data))
    throw new ApiError('invalid_response', t('structureView.invalidResponse'));
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
        throw new ApiError('unsupported_feature', t('structureView.noExtended'));
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'not_found')
        throw new ApiError('unsupported_feature', t('structureView.noExtended'));
      throw cause;
    }
    const body = { connection, table };
    validateStructure('DescribeRequest', body);
    let payload: unknown;
    try {
      payload = await this.client.requestRaw('/api/v5/tables/structure', token, body, signal);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'unsupported_table')
        throw new ApiError('unsupported_table', t('structureView.unsupportedTable'));
      throw cause;
    }
    const data = validateStructure('TableStructure', payload);
    if (
      data.table.name !== table.name ||
      (table.schema !== undefined && data.table.schema !== table.schema)
    )
      throw new ApiError('invalid_response', t('structureView.wrongTable'));
    if (
      data.indexes.reduce((sum, index) => sum + index.terms.length, 0) > 8192 ||
      data.indexes.some(
        (index) => new Set(index.terms.map((term) => term.position)).size !== index.terms.length,
      )
    )
      throw new ApiError('invalid_response', t('structureView.badPositions'));
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
