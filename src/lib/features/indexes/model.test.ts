// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { buildChange, draftIssues, emptyDraft, emptyTerm, validNewName } from './model';
import { capabilities } from './testing';
const caps = capabilities();
it('preserves ordered names and explicit options without SQL interpolation', () => {
  const draft = emptyDraft();
  draft.newName = 'idx " ;DROP';
  draft.kind = 'unique';
  draft.terms = [
    { ...emptyTerm(), column: 'note', direction: 'desc', prefix: '7' },
    { ...emptyTerm(), column: 'id' },
  ];
  expect(draftIssues(draft, ['id', 'note'], 'mysql', caps)).toEqual([]);
  expect(buildChange(draft)).toEqual({
    action: 'index_create',
    index: {
      name: draft.newName,
      kind: 'unique',
      terms: [{ column: 'note', direction: 'desc', prefix_length: 7 }, { column: 'id' }],
    },
  });
});
it('rejects unsupported SQLite actions and unsupported options', () => {
  for (const action of ['primary_set', 'foreign_key_create', 'index_alter'] as const)
    expect(draftIssues(emptyDraft(action), ['id'], 'sqlite', caps).length).toBeGreaterThan(0);
  const d = emptyDraft();
  d.newName = 'idx';
  d.terms[0].column = 'id';
  d.terms[0].prefix = '1';
  expect(draftIssues(d, ['id'], 'sqlite', caps)).not.toEqual([]);
});
it('validates Unicode bytes, control characters and existing names independently', () => {
  expect(validNewName('é'.repeat(32))).toBe(false);
  for (const name of ['', ' a', 'a\u0085', 'a\n']) expect(validNewName(name)).toBe(false);
  expect(validNewName('a <b> "')).toBe(true);
});
it('builds paired FK columns with exact reference names and schema', () => {
  const d = emptyDraft('foreign_key_alter');
  d.name = 'old';
  d.newName = 'new';
  d.table = 'parent, x';
  d.schema = 'other';
  d.terms = [{ ...emptyTerm(), column: 'id', referenced: 'parent id' }];
  d.onDelete = 'cascade';
  expect(draftIssues(d, ['id'], 'postgres', caps)).toEqual([]);
  expect(buildChange(d)).toMatchObject({
    name: 'old',
    foreign_key: {
      columns: ['id'],
      referenced_columns: ['parent id'],
      referenced_table: { schema: 'other', name: 'parent, x' },
      on_delete: 'cascade',
    },
  });
});
it('rejects duplicate, missing and over-limit terms, primary options and fulltext prefixes', () => {
  const d = emptyDraft();
  d.newName = 'idx';
  d.terms[0].column = 'id';
  expect(draftIssues(d, ['id'], 'sqlite', caps)).toEqual([]);
  d.terms.push({ ...emptyTerm(), column: 'id' });
  expect(draftIssues(d, ['id'], 'sqlite', caps)).not.toEqual([]);
  d.terms = [{ ...emptyTerm(), column: 'missing' }];
  expect(draftIssues(d, ['id'], 'sqlite', caps)).not.toEqual([]);
  d.terms = Array.from({ length: 17 }, (_, i) => ({ ...emptyTerm(), column: String(i) }));
  expect(
    draftIssues(
      d,
      d.terms.map((t) => t.column),
      'mysql',
      caps,
    ),
  ).not.toEqual([]);
  d.terms = [{ ...emptyTerm(), column: 'id', direction: 'desc' }];
  d.action = 'primary_set';
  expect(draftIssues(d, ['id'], 'postgres', caps)).not.toEqual([]);
  d.action = 'index_create';
  d.kind = 'fulltext';
  expect(draftIssues(d, ['id'], 'mysql', caps)).not.toEqual([]);
});
