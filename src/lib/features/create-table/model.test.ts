// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as validators from '$lib/contract/v6/validators.js';
import {
  buildRequest,
  emptyDraft,
  newColumn,
  normalizeColumn,
  validateDraft,
  type ColumnDraft,
  type TableDraft,
} from './model';

const connection = { driver: 'sqlite' as const, database: 'synthetic' };
const column = (patch: Partial<ColumnDraft>): ColumnDraft => ({ ...newColumn(), ...patch });
const draft = (patch: Partial<TableDraft> = {}, columns?: ColumnDraft[]): TableDraft => {
  const list = columns ?? [column({ name: 'id', kind: 'int64', nullable: false })];
  return { schema: '', name: 'created', columns: list, primaryKey: [], ...patch };
};
const messages = (value: TableDraft) => validateDraft(value).map((issue) => issue.message);

describe('vendored API 0.6 contract', () => {
  it('is the exact released byte copy with provenance', () => {
    const provenance = JSON.parse(readFileSync('src/lib/contract/v6/provenance.json', 'utf8'));
    const hash = createHash('sha256')
      .update(readFileSync('src/lib/contract/v6/api-v0.6.0.json'))
      .digest('hex');
    expect(hash).toBe('b08b6aba858f72a3bad1fce2933e487eed017f5e35b4690cfd9fae3a590a6887');
    expect(provenance.sha256).toBe(hash);
    expect(provenance.source_commit).toBe('3d21e42b0806f2a1953bcbad47f1e9fcb2acda93');
  });
});

describe('request building', () => {
  it('builds a contract-valid request with all four types, defaults and an ordered key', () => {
    const a = column({
      name: 'a',
      kind: 'int64',
      nullable: false,
      defaultMode: 'value',
      defaultValue: '9223372036854775807',
    });
    const b = column({
      name: 'b',
      kind: 'text',
      length: '40',
      nullable: false,
      defaultMode: 'value',
      defaultValue: '',
    });
    const c = column({ name: 'c', kind: 'binary', nullable: true, defaultMode: 'null' });
    const d = column({
      name: 'd',
      kind: 'decimal',
      precision: '10',
      scale: '2',
      defaultMode: 'value',
      defaultValue: '-12.50',
    });
    const request = buildRequest(
      draft({ primaryKey: [b.key, a.key] }, [a, b, c, d]),
      connection,
      false,
    );
    expect(validators.CreateTableRequest(request)).toBe(true);
    expect(request.confirm).toBe(true);
    expect(request.primary_key).toEqual(['b', 'a']);
    expect(request.table).toEqual({ name: 'created' });
    expect(request.columns.map((x) => x.type)).toEqual([
      { kind: 'int64' },
      { kind: 'text', length: 40 },
      { kind: 'binary' },
      { kind: 'decimal', precision: 10, scale: 2 },
    ]);
    expect(request.columns[1].default).toEqual({
      mode: 'value',
      value: { kind: 'text', value: '' },
    });
    expect(request.columns[2].default).toEqual({ mode: 'null' });
    expect(request.columns[3].default).toEqual({
      mode: 'value',
      value: { kind: 'decimal', value: '-12.50' },
    });
  });
  it('allows an empty primary key and includes the schema only when requested', () => {
    const value = draft({ schema: 'app' });
    expect(buildRequest(value, connection).primary_key).toEqual([]);
    expect(buildRequest(value, connection).table).toEqual({ name: 'created', schema: 'app' });
    expect(buildRequest(value, connection, false).table).toEqual({ name: 'created' });
  });
  it('keeps special names byte-exact and never turns them into SQL', () => {
    const names = ['odd"name', 'back`tick', 'with space', "x'; DROP TABLE y;--", 'ünï 日本'];
    const value = draft(
      { name: names[3] },
      names.map((name) => column({ name, nullable: true })),
    );
    const request = buildRequest(value, connection);
    expect(request.table.name).toBe(names[3]);
    expect(request.columns.map((x) => x.name)).toEqual(names);
    expect(validators.CreateTableRequest(request)).toBe(true);
  });
  it('refuses to build an invalid draft', () => {
    expect(() => buildRequest(draft({ name: '' }), connection)).toThrow();
  });
});

describe('client-side pre-check mirrors the documented limits', () => {
  it('accepts the initial draft once a name exists and rejects empty names', () => {
    expect(validateDraft({ ...emptyDraft(), name: 'ok' })).toEqual([]);
    expect(messages(draft({ name: '' })).join()).toContain('Tabellennamen');
    expect(messages(draft({}, [column({ name: '' })])).join()).toContain('Namen');
  });
  it('measures names in UTF-8 bytes (63) and rejects NUL and lone surrogates', () => {
    expect(validateDraft(draft({ name: 'a'.repeat(63) }))).toEqual([]);
    expect(validateDraft(draft({ name: 'a'.repeat(64) }))).not.toEqual([]);
    expect(validateDraft(draft({ name: 'ü'.repeat(31) }))).toEqual([]);
    expect(validateDraft(draft({ name: 'ü'.repeat(32) }))).not.toEqual([]);
    expect(validateDraft(draft({ name: 'a\u0000b' }))).not.toEqual([]);
    expect(validateDraft(draft({ name: 'a\uD800' }))).not.toEqual([]);
  });
  it('limits columns to 32 and rejects case-insensitive duplicates', () => {
    const many = Array.from({ length: 33 }, (_, i) => column({ name: `c${i}`, length: '1' }));
    expect(validateDraft(draft({}, many.slice(0, 32)))).toEqual([]);
    expect(messages(draft({}, many)).join()).toContain('höchstens 32');
    expect(messages(draft({}, [column({ name: 'A' }), column({ name: 'a' })])).join()).toContain(
      'Groß-/Kleinschreibung',
    );
  });
  it('checks text length and decimal precision and scale', () => {
    for (const length of ['0', '1025', '', '1.5', '-3', 'abc'])
      expect(validateDraft(draft({}, [column({ name: 'x', kind: 'text', length })]))).not.toEqual(
        [],
      );
    expect(validateDraft(draft({}, [column({ name: 'x', kind: 'text', length: '1024' })]))).toEqual(
      [],
    );
    const decimal = (precision: string, scale: string) =>
      validateDraft(draft({}, [column({ name: 'x', kind: 'decimal', precision, scale })]));
    expect(decimal('38', '38')).toEqual([]);
    expect(decimal('39', '0')).not.toEqual([]);
    expect(decimal('5', '6')).not.toEqual([]);
    expect(decimal('0', '0')).not.toEqual([]);
  });
  it('mirrors the server rules for constant defaults', () => {
    const withDefault = (patch: Partial<ColumnDraft>) =>
      validateDraft(draft({}, [column({ name: 'x', defaultMode: 'value', ...patch })]));
    expect(withDefault({ kind: 'int64', defaultValue: '-9223372036854775808' })).toEqual([]);
    expect(withDefault({ kind: 'int64', defaultValue: '9223372036854775808' })).not.toEqual([]);
    expect(withDefault({ kind: 'int64', defaultValue: '007' })).not.toEqual([]);
    expect(withDefault({ kind: 'int64', defaultValue: '1e3' })).not.toEqual([]);
    expect(withDefault({ kind: 'int64', defaultValue: '' })).not.toEqual([]);
    expect(withDefault({ kind: 'text', length: '3', defaultValue: 'äöü' })).toEqual([]);
    expect(withDefault({ kind: 'text', length: '3', defaultValue: 'abcd' })).not.toEqual([]);
    expect(
      withDefault({ kind: 'decimal', precision: '5', scale: '2', defaultValue: '123.45' }),
    ).toEqual([]);
    expect(
      withDefault({ kind: 'decimal', precision: '5', scale: '2', defaultValue: '1234.5' }),
    ).not.toEqual([]);
    expect(
      withDefault({ kind: 'decimal', precision: '5', scale: '2', defaultValue: '1.234' }),
    ).not.toEqual([]);
    expect(
      withDefault({ kind: 'decimal', precision: '5', scale: '2', defaultValue: '1e2' }),
    ).not.toEqual([]);
    expect(withDefault({ kind: 'binary', defaultValue: 'x' })).not.toEqual([]);
  });
  it('rejects the NULL default on a NOT NULL column and normalizes inconsistent choices', () => {
    expect(
      validateDraft(draft({}, [column({ name: 'x', nullable: false, defaultMode: 'null' })])),
    ).not.toEqual([]);
    expect(normalizeColumn(column({ nullable: false, defaultMode: 'null' })).defaultMode).toBe(
      'none',
    );
    expect(
      normalizeColumn(column({ kind: 'binary', defaultMode: 'value', defaultValue: 'x' })),
    ).toMatchObject({ defaultMode: 'none', defaultValue: '' });
  });
  it('limits the text budget to 4096', () => {
    const four = Array.from({ length: 4 }, (_, i) => column({ name: `t${i}`, length: '1024' }));
    expect(validateDraft(draft({}, four))).toEqual([]);
    expect(messages(draft({}, [...four, column({ name: 'more', length: '1' })])).join()).toContain(
      '4096',
    );
  });
  it('validates the primary key: count, types, nullability and byte budget', () => {
    const key = (k: ColumnDraft) => draft({ primaryKey: [k.key] }, [k]);
    expect(validateDraft(key(column({ name: 'k', kind: 'int64', nullable: false })))).toEqual([]);
    expect(validateDraft(key(column({ name: 'k', kind: 'decimal', nullable: false })))).not.toEqual(
      [],
    );
    expect(validateDraft(key(column({ name: 'k', kind: 'binary', nullable: false })))).not.toEqual(
      [],
    );
    expect(validateDraft(key(column({ name: 'k', kind: 'int64', nullable: true })))).not.toEqual(
      [],
    );
    const nine = Array.from({ length: 9 }, (_, i) =>
      column({ name: `k${i}`, kind: 'int64', nullable: false }),
    );
    expect(validateDraft(draft({ primaryKey: nine.slice(0, 8).map((x) => x.key) }, nine))).toEqual(
      [],
    );
    expect(validateDraft(draft({ primaryKey: nine.map((x) => x.key) }, nine))).not.toEqual([]);
    const wide = Array.from({ length: 2 }, (_, i) =>
      column({ name: `w${i}`, kind: 'text', length: '257', nullable: false }),
    );
    expect(
      validateDraft(draft({ primaryKey: wide.map((x) => x.key) }, wide)).map((i) => i.scope),
    ).toContain('primary-key');
  });
});

describe('reserved targets and "-0" (mirror of the server rules)', () => {
  const sqlite = { driver: 'sqlite' as const, database: 'd' };
  it('rejects sqlite_ table names case-insensitively on SQLite only', () => {
    expect(validateDraft(draft({ name: 'SQLite_x' }), sqlite)).not.toEqual([]);
    expect(
      validateDraft(draft({ name: 'sqlite_x' }), { driver: 'postgresql', database: 'd' }),
    ).toEqual([]);
    expect(validateDraft(draft({ name: 'my_sqlite_x' }), sqlite)).toEqual([]);
  });
  it('rejects reserved MySQL and PostgreSQL schemas, also via the connection database', () => {
    const my = { driver: 'mysql' as const, database: 'app' };
    for (const schema of ['mysql', 'SYS', 'information_schema', 'performance_schema'])
      expect(validateDraft(draft({ schema }), my)).not.toEqual([]);
    expect(validateDraft(draft({}), { driver: 'mysql', database: 'Mysql' })).not.toEqual([]);
    expect(validateDraft(draft({ schema: 'app2' }), my)).toEqual([]);
    const pg = { driver: 'postgresql' as const, database: 'd' };
    for (const schema of ['pg_catalog', 'PG_temp', 'information_schema'])
      expect(validateDraft(draft({ schema }), pg)).not.toEqual([]);
    expect(validateDraft(draft({ schema: 'public' }), pg)).toEqual([]);
  });
  it('rejects the integer default -0', () => {
    expect(
      validateDraft(
        draft({}, [column({ name: 'x', kind: 'int64', defaultMode: 'value', defaultValue: '-0' })]),
      ),
    ).not.toEqual([]);
  });
});
