// SPDX-License-Identifier: AGPL-3.0-only
// Draft model, client-side pre-checks and request building for column changes (API 0.9).
// The pre-checks only spare a round trip; the server stays authoritative.
import type { components } from '$lib/contract/v9/api-types';
import type { Driver } from '$lib/workbench';
import { t } from '$lib/i18n';

type Schemas = components['schemas'];
export type ColumnChange = Schemas['ColumnChange'];
export type ColumnDefinition = Schemas['ColumnDefinition'];
export type ColumnsPlan = Schemas['ColumnsPlan'];
export type ColumnsResult = Schemas['ColumnsResult'];
export type ColumnsCapabilities = Schemas['ColumnsCapabilities'];
export type ApiDriver = 'sqlite' | 'mysql' | 'postgres';
export type ActionKey = 'add' | 'change' | 'rename' | 'drop' | 'reorder';
export type TypeKind =
  'int64' | 'text' | 'binary' | 'decimal' | 'boolean' | 'date' | 'timestamp' | 'enum' | 'set';
export type DefaultMode = 'none' | 'null' | 'value';
export type PositionMode = 'keep' | 'first' | 'before' | 'after';

export const MAX_CHANGES = 16;
export const apiDriverOf = (driver: Driver): ApiDriver =>
  driver === 'postgresql' ? 'postgres' : driver;
export const usesPositions = (driver: ApiDriver) => driver === 'mysql';

export interface DefinitionDraft {
  name: string;
  kind: TypeKind | '';
  length: string;
  precision: string;
  scale: string;
  /** One ENUM/SET value per line; empty lines are ignored. */
  values: string;
  nullable: boolean;
  defaultMode: DefaultMode;
  defaultValue: string;
  /** Whether the comment is sent (always for MySQL/MariaDB change/reorder and for new columns). */
  commentSet: boolean;
  /** MySQL/MariaDB change/reorder: the user checked that comment and collation get replaced. */
  replaceAck: boolean;
  comment: string;
  collation: string;
}
export interface PositionDraft {
  mode: PositionMode;
  column: string;
}
export interface PendingChange {
  id: number;
  action: ActionKey;
  /** Existing catalog column (all actions except add). */
  column: string;
  newName: string;
  definition: DefinitionDraft;
  position: PositionDraft;
}
export interface Issue {
  field: string;
  message: string;
}

export const emptyDefinition = (): DefinitionDraft => ({
  name: '',
  kind: '',
  length: '255',
  precision: '10',
  scale: '0',
  values: '',
  nullable: true,
  defaultMode: 'none',
  defaultValue: '',
  commentSet: true,
  replaceAck: false,
  comment: '',
  collation: '',
});
export const noPosition = (): PositionDraft => ({ mode: 'keep', column: '' });

export const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const lonelySurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
export const wellFormed = (value: string) => !lonelySurrogate.test(value);
const codePoints = (value: string) => [...value].length;
// eslint-disable-next-line no-control-regex
const controlCharacters = /[\u0000-\u001f\u007f-\u009f]/;
const integerPattern = /^-?(0|[1-9][0-9]*)$/;
const decimalPattern = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const digits = /^[0-9]{1,6}$/;
const SIGNED64_MIN = -(2n ** 63n);
const SIGNED64_MAX = 2n ** 63n - 1n;

/** Rules for names the user newly chooses (existing names are never re-checked). */
export function newNameProblem(name: string): string {
  if (name === '') return t('columns.errNameEmpty');
  if (!wellFormed(name) || controlCharacters.test(name)) return t('columns.errNameControl');
  if (name !== name.trim()) return t('columns.errNameEdge');
  if (utf8Bytes(name) > 63) return t('columns.errNameLong');
  return '';
}

export function parseValues(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line !== '');
}

function valuesProblem(kind: 'enum' | 'set', values: string[]): string {
  const max = kind === 'enum' ? 256 : 64;
  if (values.length < 1 || values.length > max) return t('columns.errValuesCount', { max });
  const seen = new Set<string>();
  for (const value of values) {
    if (!wellFormed(value) || value.includes('\u0000') || utf8Bytes(value) > 255)
      return t('columns.errValuesInvalid');
    if (value !== value.trimEnd()) return t('columns.errValuesTrailing');
    if (kind === 'set' && value.includes(',')) return t('columns.errValuesComma');
    if (seen.has(value)) return t('columns.errValuesDuplicate');
    seen.add(value);
  }
  return '';
}

function defaultProblem(draft: DefinitionDraft): string {
  const value = draft.defaultValue;
  switch (draft.kind) {
    case 'int64': {
      if (!integerPattern.test(value) || value === '-0') return t('columns.errDefaultInteger');
      const parsed = BigInt(value);
      return parsed < SIGNED64_MIN || parsed > SIGNED64_MAX ? t('columns.errDefaultRange') : '';
    }
    case 'text': {
      if (!wellFormed(value) || value.includes('\u0000')) return t('columns.errDefaultText');
      const length = Number(draft.length);
      return utf8Bytes(value) > 4096 || codePoints(value) > length
        ? t('columns.errDefaultLength', { length })
        : '';
    }
    case 'decimal': {
      if (value.length > 80 || !decimalPattern.test(value)) return t('columns.errDefaultDecimal');
      const precision = Number(draft.precision);
      const scale = Number(draft.scale === '' ? '0' : draft.scale);
      const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
      const wholeDigits = whole === '0' ? 0 : whole.length;
      return wholeDigits <= precision - scale && fraction.length <= scale
        ? ''
        : t('columns.errDefaultDigits', { precision, scale });
    }
    case 'boolean':
      return value === 'true' || value === 'false' ? '' : t('columns.errDefaultBoolean');
    case 'date':
    case 'timestamp':
      return value === '' || utf8Bytes(value) > 64 || controlCharacters.test(value)
        ? t('columns.errDefaultTemporal')
        : '';
    case 'enum':
    case 'set': {
      const members = parseValues(draft.values);
      const parts = draft.kind === 'set' ? value.split(',') : [value];
      return parts.every((part) => members.includes(part)) ? '' : t('columns.errDefaultMember');
    }
    default:
      return t('columns.errDefaultBinary');
  }
}

export interface DefinitionContext {
  driver: ApiDriver;
  action: 'add' | 'change' | 'reorder';
  /** Types offered by the backend for this driver. */
  types: readonly string[];
}

/** Blocking problems of one definition. */
export function definitionIssues(draft: DefinitionDraft, context: DefinitionContext): Issue[] {
  const issues: Issue[] = [];
  const add = (field: string, message: string) => issues.push({ field, message });
  if (context.action === 'add') {
    const problem = newNameProblem(draft.name);
    if (problem) add('name', problem);
  }
  if (draft.kind === '' || !context.types.includes(draft.kind)) {
    add('kind', t('columns.errType'));
    return issues;
  }
  if (draft.kind === 'text') {
    const length = Number(draft.length);
    if (!digits.test(draft.length) || length < 1 || length > 1024)
      add('length', t('columns.errLength'));
  }
  if (draft.kind === 'decimal') {
    const precision = Number(draft.precision);
    const scale = Number(draft.scale === '' ? '0' : draft.scale);
    if (
      !digits.test(draft.precision) ||
      precision < 1 ||
      precision > 38 ||
      (draft.scale !== '' && !digits.test(draft.scale)) ||
      scale > precision
    )
      add('precision', t('columns.errDecimal'));
  }
  if (draft.kind === 'enum' || draft.kind === 'set') {
    const problem = valuesProblem(draft.kind, parseValues(draft.values));
    if (problem) add('values', problem);
  }
  if (draft.defaultMode === 'null' && !draft.nullable)
    add('default', t('columns.errNullDefaultNotNull'));
  if (draft.defaultMode === 'value') {
    const problem = defaultProblem(draft);
    if (problem) add('default', problem);
  }
  if (context.driver === 'sqlite' && context.action === 'add' && !draft.nullable) {
    if (draft.defaultMode !== 'value') add('default', t('columns.errSqliteNotNull'));
  }
  if (context.driver === 'mysql' && context.action !== 'add' && !draft.replaceAck)
    add('replaceAck', t('columns.errReplaceAck'));
  if (draft.commentSet && utf8Bytes(draft.comment) > 2048) add('comment', t('columns.errComment'));
  if (draft.commentSet && (!wellFormed(draft.comment) || draft.comment.includes('\u0000')))
    add('comment', t('columns.errCommentChars'));
  if (draft.kind === 'text' && draft.collation !== '') {
    if (draft.collation.length > 1024 || controlCharacters.test(draft.collation))
      add('collation', t('columns.errCollation'));
  }
  if (
    context.driver === 'mysql' &&
    context.action !== 'add' &&
    draft.kind === 'text' &&
    draft.collation === ''
  )
    add('collation', t('columns.errCollationRequired'));
  return issues;
}

export function buildDefinition(draft: DefinitionDraft, isAdd: boolean): ColumnDefinition {
  let type: ColumnDefinition['type'];
  switch (draft.kind) {
    case 'text':
      type = { kind: 'text', length: Number(draft.length) };
      break;
    case 'decimal':
      type = {
        kind: 'decimal',
        precision: Number(draft.precision),
        ...(draft.scale === '' ? {} : { scale: Number(draft.scale) }),
      };
      break;
    case 'enum':
    case 'set':
      type = { kind: draft.kind, values: parseValues(draft.values) };
      break;
    case '':
      throw new Error('type missing');
    default:
      type = { kind: draft.kind };
  }
  let valueKind: 'integer' | 'text' | 'decimal' | 'boolean' = 'text';
  if (draft.kind === 'int64') valueKind = 'integer';
  else if (draft.kind === 'decimal') valueKind = 'decimal';
  else if (draft.kind === 'boolean') valueKind = 'boolean';
  const definition: ColumnDefinition = {
    name: draft.name,
    type,
    nullable: draft.nullable,
    default:
      draft.defaultMode === 'value'
        ? { mode: 'value', value: { kind: valueKind, value: draft.defaultValue } }
        : { mode: draft.defaultMode },
  };
  if (draft.commentSet && (draft.comment !== '' || !isAdd)) definition.comment = draft.comment;
  if (draft.kind === 'text' && draft.collation !== '') definition.collation = draft.collation;
  return definition;
}

function buildPosition(position: PositionDraft): Schemas['ColumnPosition'] | undefined {
  if (position.mode === 'first') return { mode: 'first' };
  if (position.mode === 'before' || position.mode === 'after')
    return { mode: position.mode, column: position.column };
  return undefined;
}

/** The API change for a pending entry. Throws when the type is still open (callers validate first). */
export function buildChange(change: PendingChange): ColumnChange {
  switch (change.action) {
    case 'drop':
      return { action: 'drop', column: change.column };
    case 'rename':
      return { action: 'rename', column: change.column, new_name: change.newName };
    case 'add': {
      const position = buildPosition(change.position);
      return {
        action: 'add',
        definition: buildDefinition(change.definition, change.action === 'add'),
        ...(position ? { position } : {}),
      };
    }
    case 'change': {
      const position = buildPosition(change.position);
      return {
        action: 'change',
        column: change.column,
        definition: buildDefinition(change.definition, false),
        ...(position ? { position } : {}),
      };
    }
    case 'reorder': {
      const position = buildPosition(change.position);
      if (!position) throw new Error('position missing');
      return {
        action: 'reorder',
        column: change.column,
        definition: buildDefinition(change.definition, false),
        position,
      };
    }
  }
}

export interface BatchContext {
  driver: ApiDriver;
  existing: readonly string[];
}

/** Problems of a single pending change (name rules, position reference). */
export function changeIssues(
  change: PendingChange,
  context: BatchContext,
  types: readonly string[],
): Issue[] {
  const issues: Issue[] = [];
  if (change.action === 'rename') {
    const problem = newNameProblem(change.newName);
    if (problem) issues.push({ field: 'newName', message: problem });
    else if (sameName(change.newName, change.column, context.driver))
      issues.push({ field: 'newName', message: t('columns.errNameSame') });
  }
  if (change.action === 'add' || change.action === 'change' || change.action === 'reorder') {
    issues.push(
      ...definitionIssues(change.definition, {
        driver: context.driver,
        action: change.action,
        types,
      }),
    );
  }
  if (change.action === 'reorder' && change.position.mode === 'keep')
    issues.push({ field: 'position', message: t('columns.errPositionNeeded') });
  if (change.position.mode === 'before' || change.position.mode === 'after') {
    if (!context.existing.includes(change.position.column))
      issues.push({ field: 'position', message: t('columns.errPositionColumn') });
    else if (change.position.column === change.column)
      issues.push({ field: 'position', message: t('columns.errPositionSelf') });
  }
  return issues;
}

const sameName = (a: string, b: string, driver: ApiDriver) =>
  driver === 'postgres' ? a === b : a.toLowerCase() === b.toLowerCase();

/** Problems across the whole batch (limits, duplicate targets, colliding new names). */
export function batchIssues(changes: readonly PendingChange[], context: BatchContext): string[] {
  const problems: string[] = [];
  if (changes.length === 0) problems.push(t('columns.errNoChanges'));
  if (changes.length > MAX_CHANGES) problems.push(t('columns.errTooMany', { max: MAX_CHANGES }));
  const targets = new Set<string>();
  const names: string[] = [];
  const dropped = new Set(changes.filter((c) => c.action === 'drop').map((c) => c.column));
  for (const change of changes) {
    if (change.action !== 'add') {
      if (targets.has(change.column))
        problems.push(t('columns.errTargetTwice', { name: change.column }));
      targets.add(change.column);
    }
    if (change.action === 'add') names.push(change.definition.name);
    if (change.action === 'rename') names.push(change.newName);
    if (
      (change.position.mode === 'before' || change.position.mode === 'after') &&
      dropped.has(change.position.column)
    )
      problems.push(t('columns.errPositionDropped', { name: change.position.column }));
  }
  names.forEach((name, index) => {
    const clash =
      context.existing.some((existing) => sameName(existing, name, context.driver)) ||
      names.slice(0, index).some((other) => sameName(other, name, context.driver));
    if (clash) problems.push(t('columns.errNameExists', { name }));
  });
  return [...new Set(problems)];
}

/** Best-effort structured type from the database type text of the table description. */
export function parseDatabaseType(raw: string, driver: ApiDriver): Partial<DefinitionDraft> {
  const text = raw.trim().toLowerCase();
  const match = /^([a-z ]+?)\s*(?:\((.*)\))?$/.exec(text);
  const base = match?.[1] ?? text;
  const args = match?.[2] ?? '';
  if (/^(bigint|int8)$/.test(base) && (args === '' || /^[0-9]+$/.test(args)))
    return { kind: 'int64' };
  if (/^(varchar|character varying)$/.test(base) && /^[0-9]+$/.test(args))
    return { kind: 'text', length: args };
  if (/^(decimal|numeric)$/.test(base) && /^[0-9]+(,\s*[0-9]+)?$/.test(args)) {
    const [precision, scale = '0'] = args.split(',').map((part) => part.trim());
    return { kind: 'decimal', precision, scale };
  }
  if (/^(blob|bytea)$/.test(base) && args === '') return { kind: 'binary' };
  if (/^(boolean|bool)$/.test(base) && args === '') return { kind: 'boolean' };
  if (base === 'date' && args === '') return { kind: 'date' };
  // Only the plain, zone-less timestamp matches; "with time zone" and precisions are not claimed.
  if (text === 'timestamp' || text === 'timestamp without time zone') return { kind: 'timestamp' };
  if (driver === 'mysql' && (base === 'enum' || base === 'set')) {
    const raw2 = raw.slice(raw.indexOf('(') + 1, raw.lastIndexOf(')'));
    const values = [...raw2.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replaceAll("''", "'"));
    if (values.length > 0) return { kind: base, values: values.join('\n') };
  }
  return {};
}

/** Draft pre-filled from an existing column (type text parsed where possible). */
export function draftFromColumn(
  column: { name: string; database_type: string; nullable: boolean; default_value?: string },
  driver: ApiDriver,
  action: 'change' | 'reorder',
): DefinitionDraft {
  const draft: DefinitionDraft = {
    ...emptyDefinition(),
    name: column.name,
    nullable: column.nullable,
    commentSet: driver === 'mysql',
    ...parseDatabaseType(column.database_type, driver),
  };
  void action;
  const old = column.default_value;
  if (old !== undefined) {
    if (integerPattern.test(old) || decimalPattern.test(old)) {
      draft.defaultMode = 'value';
      draft.defaultValue = old;
    } else {
      const quoted = /^'((?:[^']|'')*)'(?:::[a-z ]+)?$/.exec(old);
      if (quoted) {
        draft.defaultMode = 'value';
        draft.defaultValue = quoted[1].replaceAll("''", "'");
      }
    }
  }
  if (draft.defaultMode === 'value' && draft.kind === 'boolean')
    draft.defaultMode = /^(true|false)$/.test(draft.defaultValue) ? 'value' : 'none';
  return draft;
}

export const typeLabels: Record<TypeKind, string> = {
  int64: 'columns.typeInt64',
  text: 'columns.typeText',
  decimal: 'columns.typeDecimal',
  binary: 'columns.typeBinary',
  boolean: 'columns.typeBoolean',
  date: 'columns.typeDate',
  timestamp: 'columns.typeTimestamp',
  enum: 'columns.typeEnum',
  set: 'columns.typeSet',
};
export const TYPE_ORDER: TypeKind[] = [
  'int64',
  'text',
  'decimal',
  'binary',
  'boolean',
  'date',
  'timestamp',
  'enum',
  'set',
];

const reasonKeys: Record<string, string> = {
  database_error: 'columns.reasonDatabase',
  permission_denied: 'columns.reasonPermission',
  dependency_blocks: 'columns.reasonDependency',
  lock_timeout: 'columns.reasonLock',
  connection_lost: 'columns.reasonConnection',
  canceled: 'columns.reasonCanceled',
  observation_unavailable: 'columns.reasonObservation',
  commit_unknown: 'columns.reasonCommitUnknown',
};
export const reasonText = (reason: string | undefined) =>
  reason && reasonKeys[reason] ? t(reasonKeys[reason]) : t('columns.reasonDatabase');
export const observationText = (state: string) =>
  state === 'transactional'
    ? t('columns.obsTransactional')
    : state === 'observed'
      ? t('columns.obsObserved')
      : t('columns.obsUnavailable');

export function describeChange(change: PendingChange): string {
  switch (change.action) {
    case 'add':
      return t('columns.sumAdd', { name: change.definition.name });
    case 'change':
      return t('columns.sumChange', { name: change.column });
    case 'rename':
      return t('columns.sumRename', { name: change.column, to: change.newName });
    case 'drop':
      return t('columns.sumDrop', { name: change.column });
    case 'reorder':
      return t('columns.sumReorder', { name: change.column });
  }
}
