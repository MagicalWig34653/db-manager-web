// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { mentionedTables } from './cm';
import {
  buildColumnIndex,
  buildSchema,
  clearColumnHints,
  rememberColumns,
} from './catalog-hints.svelte';
import { emptyConnection } from '$lib/workbench';

describe('completion hints', () => {
  it('finds tables named after FROM/JOIN/UPDATE/INTO, with schemas, aliases and lists', () => {
    expect(mentionedTables('select * from items where owner_i', 'sqlite')).toEqual(['items']);
    expect(
      mentionedTables('select 1 from main.a x, "b" as y join `c` on 1=1 left join d', 'mysql'),
    ).toEqual(['a', 'b', 'c', 'd']);
    expect(mentionedTables('update t set a=1; insert into u (a) values (1)', 'postgresql')).toEqual(
      ['t', 'u'],
    );
    expect(mentionedTables("select 'from x'", 'sqlite')).toEqual([]);
  });

  it('exposes catalog tables immediately and columns only for tables already opened', () => {
    clearColumnHints();
    const connection = { ...emptyConnection(), database: 'one' };
    const objects = [
      { name: 'items', schema: 'main', type: 'table' },
      { name: 'other', schema: 'main', type: 'table' },
    ];
    expect(buildSchema(objects, connection)).toMatchObject({ items: [], other: [] });
    rememberColumns(connection, objects[0], ['id', 'owner_id']);
    expect(buildColumnIndex(objects, connection)).toEqual({ items: ['id', 'owner_id'] });
    expect(buildSchema(objects, connection).items).toEqual(['id', 'owner_id']);
    // Another connection never sees these hints, and the password is not part of the identity.
    const other = { ...connection, database: 'two' };
    expect(buildColumnIndex(objects, other)).toEqual({});
    expect(buildColumnIndex(objects, { ...connection, password: 'changed' })).toEqual({
      items: ['id', 'owner_id'],
    });
    clearColumnHints();
  });
});
