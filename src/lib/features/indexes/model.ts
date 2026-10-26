// SPDX-License-Identifier: AGPL-3.0-only
import type { components } from '$lib/contract/v13/api-types';
import * as validators from '$lib/contract/v13/validators.js';
import { t } from '$lib/i18n';
export type Schemas = components['schemas'];
export type IndexesCapabilities = Schemas['IndexesCapabilities'];
export type IndexesPlan = Schemas['IndexesPlan'];
export type IndexesResult = Schemas['IndexesResult'];
export type Action = Schemas['IndexesConfirmation']['action'];
export type Driver = 'sqlite' | 'mysql' | 'postgres';
export const actions: Action[] = [
  'index_create',
  'index_alter',
  'index_rename',
  'index_drop',
  'primary_set',
  'primary_drop',
  'foreign_key_create',
  'foreign_key_alter',
  'foreign_key_drop',
];
export interface TermDraft {
  column: string;
  direction: '' | 'asc' | 'desc';
  prefix: string;
  expression: '' | 'lower' | 'upper';
  referenced: string;
}
export const emptyTerm = (): TermDraft => ({
  column: '',
  direction: '',
  prefix: '',
  expression: '',
  referenced: '',
});
export interface Draft {
  action: Action;
  name: string;
  newName: string;
  kind: Schemas['IndexDefinition']['kind'];
  terms: TermDraft[];
  schema: string;
  table: string;
  onDelete: Schemas['ForeignKeyDefinition']['on_delete'];
  onUpdate: Schemas['ForeignKeyDefinition']['on_update'];
  predicateColumn: string;
  predicateOperator: 'is_null' | 'is_not_null';
}
export const emptyDraft = (action: Action = 'index_create'): Draft => ({
  action,
  name: '',
  newName: '',
  kind: action === 'primary_set' ? 'primary' : 'index',
  terms: [emptyTerm()],
  schema: '',
  table: '',
  onDelete: 'no_action',
  onUpdate: 'no_action',
  predicateColumn: '',
  predicateOperator: 'is_not_null',
});
export const isForeign = (a: Action) => a === 'foreign_key_create' || a === 'foreign_key_alter';
export const isIndex = (a: Action) =>
  a === 'index_create' || a === 'index_alter' || a === 'primary_set';
export const needsTarget = (a: Action) =>
  ['index_alter', 'index_rename', 'index_drop', 'foreign_key_alter', 'foreign_key_drop'].includes(
    a,
  );
export function buildChange(d: Draft): Record<string, unknown> {
  const base: Record<string, unknown> = { action: d.action };
  if (needsTarget(d.action)) base.name = d.name;
  if (d.action === 'index_rename') base.new_name = d.newName;
  if (isIndex(d.action))
    base.index = {
      name: d.newName,
      kind: d.action === 'primary_set' ? 'primary' : d.kind,
      terms: d.terms.map((term) => ({
        column: term.column,
        ...(term.direction ? { direction: term.direction } : {}),
        ...(term.prefix ? { prefix_length: Number(term.prefix) } : {}),
        ...(term.expression ? { expression: term.expression } : {}),
      })),
      ...(d.predicateColumn
        ? { predicate: { column: d.predicateColumn, operator: d.predicateOperator } }
        : {}),
    };
  if (isForeign(d.action))
    base.foreign_key = {
      name: d.newName,
      columns: d.terms.map((term) => term.column),
      referenced_table: { name: d.table, ...(d.schema ? { schema: d.schema } : {}) },
      referenced_columns: d.terms.map((term) => term.referenced),
      on_delete: d.onDelete,
      on_update: d.onUpdate,
    };
  return base;
}
export function validNewName(name: string) {
  return (
    name.length > 0 &&
    name.trim() === name &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(name) &&
    new TextEncoder().encode(name).length <= 63
  );
}
export function draftIssues(
  d: Draft,
  columns: string[],
  driver: Driver,
  caps: IndexesCapabilities,
): string[] {
  const fail = () => [t('indexes.invalidDraft')];
  const support = caps.drivers[driver];
  if (support[d.action].support === 'unsupported') return fail();
  if (
    (isIndex(d.action) || isForeign(d.action) || d.action === 'index_rename') &&
    !validNewName(d.newName)
  )
    return fail();
  if (isIndex(d.action) || isForeign(d.action)) {
    if (
      d.terms.length < 1 ||
      d.terms.length > 16 ||
      new Set(d.terms.map((x) => x.column)).size !== d.terms.length ||
      d.terms.some((x) => !columns.includes(x.column))
    )
      return fail();
  }
  if (isIndex(d.action)) {
    if (
      (d.kind === 'fulltext' || d.kind === 'spatial') &&
      support[d.kind].support === 'unsupported'
    )
      return fail();
    for (const term of d.terms) {
      if (
        term.prefix &&
        (!/^\d+$/.test(term.prefix) ||
          Number(term.prefix) < 1 ||
          support.prefix.support === 'unsupported')
      )
        return fail();
      if (
        (term.direction && support.direction.support === 'unsupported') ||
        (term.expression && support.expression.support === 'unsupported')
      )
        return fail();
      if (
        (d.action === 'primary_set' &&
          (term.direction || term.prefix || term.expression || d.predicateColumn)) ||
        (['fulltext', 'spatial'].includes(d.kind) &&
          (term.direction || term.prefix || term.expression))
      )
        return fail();
    }
    if (d.kind === 'spatial' && d.terms.length !== 1) return fail();
    if (
      d.predicateColumn &&
      (!columns.includes(d.predicateColumn) || support.partial.support === 'unsupported')
    )
      return fail();
  }
  if (
    isForeign(d.action) &&
    (d.terms.some((x) => !x.referenced) ||
      (driver !== 'postgres' && (d.onDelete === 'set_default' || d.onUpdate === 'set_default')))
  )
    return fail();
  const body = {
    connection: { driver, database: 'validation' },
    table: { name: 'validation' },
    ...buildChange(d),
  };
  return validators.IndexesPlanRequest(body) ? [] : fail();
}
