// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as validators from '$lib/contract/v9/validators.js';
import {
  batchIssues,
  buildChange,
  changeIssues,
  definitionIssues,
  draftFromColumn,
  emptyDefinition,
  newNameProblem,
  noPosition,
  parseDatabaseType,
  type DefinitionDraft,
  type PendingChange,
} from './model';

const allTypes = ['int64', 'text', 'binary', 'decimal', 'boolean', 'date', 'timestamp'];
const myTypes = [...allTypes, 'enum', 'set'];
const def = (over: Partial<DefinitionDraft> = {}): DefinitionDraft => ({
  ...emptyDefinition(),
  name: 'col',
  kind: 'int64',
  ...over,
});
const change = (over: Partial<PendingChange> = {}): PendingChange => ({
  id: 1,
  action: 'add',
  column: '',
  newName: '',
  definition: def(),
  position: noPosition(),
  ...over,
});

describe('contract fixtures', () => {
  const dir = 'src/lib/features/columns/fixtures';
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    const schema = file.split('.')[0] as keyof typeof validators;
    if (typeof validators[schema] !== 'function') continue;
    it(`${file} ${file.includes('.invalid.') ? 'is rejected' : 'is accepted'}`, () => {
      const value = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'));
      expect((validators[schema] as (v: unknown) => boolean)(value)).toBe(
        !file.includes('.invalid.'),
      );
    });
  }
});

describe('names of new columns', () => {
  it('rejects edge spaces, control characters, empty and long names', () => {
    expect(newNameProblem('')).not.toBe('');
    expect(newNameProblem(' a')).not.toBe('');
    expect(newNameProblem('a ')).not.toBe('');
    expect(newNameProblem('a\tb')).not.toBe('');
    expect(newNameProblem('a\nb')).not.toBe('');
    expect(newNameProblem('a\u0085b')).not.toBe('');
    expect(newNameProblem('a\u0000b')).not.toBe('');
    expect(newNameProblem('x'.repeat(64))).not.toBe('');
    expect(newNameProblem('ä'.repeat(32))).not.toBe('');
  });
  it('accepts unicode, inner spaces, quotes and SQL text', () => {
    for (const name of ['wert ä', 'a"b', "a'b`c", 'x; DROP TABLE t;--', 'x'.repeat(63)])
      expect(newNameProblem(name)).toBe('');
  });
  it('does not re-check existing names when changing a definition', () => {
    const issues = changeIssues(
      change({ action: 'change', column: 'edge ', definition: def({ name: 'edge ' }) }),
      { driver: 'postgres', existing: ['edge '] },
      allTypes,
    );
    expect(issues).toEqual([]);
  });
});

describe('definition checks', () => {
  const ctx = (driver: 'sqlite' | 'mysql' | 'postgres' = 'postgres', action = 'add' as const) => ({
    driver,
    action,
    types: driver === 'mysql' ? myTypes : allTypes,
  });
  it('requires a type offered for the driver', () => {
    expect(definitionIssues(def({ kind: '' }), ctx()).map((i) => i.field)).toContain('kind');
    expect(definitionIssues(def({ kind: 'enum', values: 'a' }), ctx('postgres')).length).toBe(1);
  });
  it('checks text length and decimal parameters', () => {
    expect(definitionIssues(def({ kind: 'text', length: '0' }), ctx()).length).toBe(1);
    expect(definitionIssues(def({ kind: 'text', length: '1025' }), ctx()).length).toBe(1);
    expect(definitionIssues(def({ kind: 'text', length: '1024' }), ctx())).toEqual([]);
    expect(
      definitionIssues(def({ kind: 'decimal', precision: '39', scale: '0' }), ctx()).length,
    ).toBe(1);
    expect(
      definitionIssues(def({ kind: 'decimal', precision: '5', scale: '6' }), ctx()).length,
    ).toBe(1);
    expect(definitionIssues(def({ kind: 'decimal', precision: '10', scale: '2' }), ctx())).toEqual(
      [],
    );
  });
  it('checks enum and set values', () => {
    const my = ctx('mysql');
    expect(definitionIssues(def({ kind: 'enum', values: 'a\nb' }), my)).toEqual([]);
    expect(definitionIssues(def({ kind: 'enum', values: 'a\na' }), my).length).toBe(1);
    expect(definitionIssues(def({ kind: 'enum', values: 'a \nb' }), my).length).toBe(1);
    expect(definitionIssues(def({ kind: 'set', values: 'a,b' }), my).length).toBe(1);
    expect(definitionIssues(def({ kind: 'enum', values: '' }), my).length).toBe(1);
    expect(definitionIssues(def({ kind: 'enum', values: 'a,b\nc' }), my)).toEqual([]);
  });
  it('checks defaults per type', () => {
    const d = (over: Partial<DefinitionDraft>) =>
      definitionIssues(def({ defaultMode: 'value', ...over }), ctx()).length;
    expect(d({ defaultValue: '12' })).toBe(0);
    expect(d({ defaultValue: '012' })).toBe(1);
    expect(d({ defaultValue: '9223372036854775808' })).toBe(1);
    expect(d({ kind: 'text', length: '3', defaultValue: 'abcd' })).toBe(1);
    expect(d({ kind: 'text', length: '3', defaultValue: "a'b" })).toBe(0);
    expect(d({ kind: 'decimal', precision: '5', scale: '2', defaultValue: '123.45' })).toBe(0);
    expect(d({ kind: 'decimal', precision: '5', scale: '2', defaultValue: '1234.5' })).toBe(1);
    expect(d({ kind: 'boolean', defaultValue: 'yes' })).toBe(1);
    expect(d({ kind: 'boolean', defaultValue: 'true' })).toBe(0);
    expect(d({ kind: 'binary', defaultValue: 'x' })).toBe(1);
    expect(definitionIssues(def({ nullable: false, defaultMode: 'null' }), ctx()).length).toBe(1);
  });
  it('mirrors driver rules: SQLite NOT NULL needs a default, MySQL change needs a collation', () => {
    expect(definitionIssues(def({ nullable: false }), ctx('sqlite')).map((i) => i.field)).toEqual([
      'default',
    ]);
    expect(
      definitionIssues(
        def({ nullable: false, defaultMode: 'value', defaultValue: '1' }),
        ctx('sqlite'),
      ),
    ).toEqual([]);
    expect(
      definitionIssues(def({ kind: 'text', length: '5' }), ctx('mysql', 'change' as 'add')).map(
        (i) => i.field,
      ),
    ).toEqual(['replaceAck', 'collation']);
  });
});

describe('request building', () => {
  const connection = { driver: 'sqlite', database: 'x' };
  const request = (changes: unknown[]) => ({ connection, table: { name: 't' }, changes });
  it('builds requests that satisfy the contract for every action', () => {
    const pending: PendingChange[] = [
      change({
        definition: def({
          name: 'n',
          kind: 'decimal',
          precision: '9',
          scale: '2',
          nullable: false,
          defaultMode: 'value',
          defaultValue: '1.25',
        }),
        position: { mode: 'after', column: 'id' },
      }),
      change({ action: 'rename', column: 'a', newName: 'b' }),
      change({ action: 'drop', column: 'c' }),
      change({
        action: 'change',
        column: 'd',
        definition: def({ kind: 'text', length: '12', collation: 'utf8mb4_bin', comment: '' }),
      }),
      change({
        action: 'reorder',
        column: 'e',
        definition: def({ kind: 'enum', values: 'x\ny', commentSet: true, comment: 'k' }),
        position: { mode: 'first', column: '' },
      }),
    ];
    const changes = pending.map(buildChange);
    expect(validators.ColumnsPlanRequest(request(changes))).toBe(true);
    expect(changes[0]).toMatchObject({
      action: 'add',
      position: { mode: 'after', column: 'id' },
      definition: {
        type: { kind: 'decimal', precision: 9, scale: 2 },
        default: { mode: 'value', value: { kind: 'decimal', value: '1.25' } },
      },
    });
    expect(changes[3]).toMatchObject({
      definition: { comment: '', collation: 'utf8mb4_bin', type: { kind: 'text', length: 12 } },
    });
  });
  it('omits an empty comment on add and a comment that was not opted in', () => {
    const add = buildChange(change({ definition: def({ comment: '' }) }));
    expect('comment' in (add as { definition: object }).definition).toBe(false);
    const pg = buildChange(
      change({ action: 'change', column: 'x', definition: def({ commentSet: false }) }),
    );
    expect('comment' in (pg as { definition: object }).definition).toBe(false);
  });
});

describe('batch checks', () => {
  const ctx = { driver: 'mysql' as const, existing: ['id', 'Name'] };
  it('limits size and rejects duplicate targets and colliding names', () => {
    expect(batchIssues([], ctx).length).toBe(1);
    const many = Array.from({ length: 17 }, (_, i) =>
      change({ id: i, action: 'drop', column: `c${i}` }),
    );
    expect(batchIssues(many, ctx).length).toBe(1);
    expect(
      batchIssues(
        [
          change({ action: 'drop', column: 'id' }),
          change({ action: 'rename', column: 'id', newName: 'z' }),
        ],
        ctx,
      ).length,
    ).toBe(1);
    expect(batchIssues([change({ definition: def({ name: 'NAME' }) })], ctx).length).toBe(1);
    expect(
      batchIssues([change({ definition: def({ name: 'NAME' }) })], { ...ctx, driver: 'postgres' }),
    ).toEqual([]);
    expect(
      batchIssues(
        [
          change({ definition: def({ name: 'x' }) }),
          change({ id: 2, action: 'rename', column: 'id', newName: 'x' }),
        ],
        ctx,
      ).length,
    ).toBe(1);
    expect(
      batchIssues(
        [
          change({ action: 'drop', column: 'id' }),
          change({
            id: 2,
            definition: def({ name: 'n' }),
            position: { mode: 'after', column: 'id' },
          }),
        ],
        ctx,
      ).length,
    ).toBe(1);
  });
});

describe('type detection from the catalog', () => {
  it('maps common database types', () => {
    expect(parseDatabaseType('bigint(20)', 'mysql')).toEqual({ kind: 'int64' });
    expect(parseDatabaseType('varchar(80)', 'mysql')).toEqual({ kind: 'text', length: '80' });
    expect(parseDatabaseType('character varying(5)', 'postgres')).toEqual({
      kind: 'text',
      length: '5',
    });
    expect(parseDatabaseType('decimal(10,2)', 'mysql')).toEqual({
      kind: 'decimal',
      precision: '10',
      scale: '2',
    });
    expect(parseDatabaseType('timestamp without time zone', 'postgres')).toEqual({
      kind: 'timestamp',
    });
    expect(parseDatabaseType("enum('a','it''s')", 'mysql')).toEqual({
      kind: 'enum',
      values: "a\nit's",
    });
    expect(parseDatabaseType('geometry', 'mysql')).toEqual({});
  });
  it('claims only exact matches (no zone, unsigned or precision look-alikes)', () => {
    for (const [raw, driver] of [
      ['timestamp with time zone', 'postgres'],
      ['timestamp(6)', 'mysql'],
      ['bigint unsigned', 'mysql'],
      ['bigint(20) unsigned', 'mysql'],
      ['decimal(10,2) unsigned', 'mysql'],
      ['tinyint(1)', 'mysql'],
      ['datetime', 'mysql'],
      ['integer', 'postgres'],
      ['double precision', 'postgres'],
    ] as const)
      expect(parseDatabaseType(raw, driver), raw).toEqual({});
    expect(parseDatabaseType('timestamp without time zone', 'postgres')).toEqual({
      kind: 'timestamp',
    });
    expect(parseDatabaseType('bigint', 'postgres')).toEqual({ kind: 'int64' });
  });
  it('requires the replace acknowledgement for MySQL change and reorder only', () => {
    const base = { kind: 'int64' as const };
    const issues = (driver: 'mysql' | 'postgres', action: 'add' | 'change', ack: boolean) =>
      definitionIssues(def({ ...base, replaceAck: ack, name: 'c' }), {
        driver,
        action,
        types: myTypes,
      }).map((i) => i.field);
    expect(issues('mysql', 'change', false)).toEqual(['replaceAck']);
    expect(issues('mysql', 'change', true)).toEqual([]);
    expect(issues('mysql', 'add', false)).toEqual([]);
    expect(issues('postgres', 'change', false)).toEqual([]);
  });
  it('prefills only simple defaults', () => {
    const base = { name: 'c', database_type: 'integer', nullable: true };
    expect(draftFromColumn({ ...base, default_value: '5' }, 'mysql', 'change').defaultMode).toBe(
      'value',
    );
    expect(
      draftFromColumn({ ...base, default_value: "nextval('s'::regclass)" }, 'postgres', 'change')
        .defaultMode,
    ).toBe('none');
    const pg = draftFromColumn(
      { ...base, default_value: "'ab''c'::character varying" },
      'postgres',
      'change',
    );
    expect(pg.defaultValue).toBe("ab'c");
  });
});
