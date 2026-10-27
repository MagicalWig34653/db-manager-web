// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { placeholderNames, substitute, VariableError } from './variables';

describe('placeholders', () => {
  it('finds names once and skips strings, comments, casts and quoted identifiers', () => {
    const sql =
      'select \':no\', ":no2", `:no3`, a::int, b:=1 -- :no4\n /* :no5 */ from t where x = :id and y = :id or z = :name';
    expect(placeholderNames(sql, 'mysql')).toEqual(['id', 'name']);
    expect(placeholderNames('select $q$:no$q$, :yes', 'postgresql')).toEqual(['yes']);
    expect(placeholderNames('select x[1:n] from t', 'postgresql')).toEqual([]);
  });
  it('ignores SQL it cannot tokenize safely', () => {
    expect(placeholderNames("select ':a", 'sqlite')).toEqual([]);
  });
});

describe('substitute', () => {
  it('quotes text, validates numbers and supports NULL and raw text', () => {
    const sql = 'select * from t where a = :a and b = :b and c = :c and d in (:d)';
    expect(
      substitute(sql, 'sqlite', {
        a: { mode: 'text', value: "o'neil" },
        b: { mode: 'number', value: ' 42 ' },
        c: { mode: 'null', value: 'ignored' },
        d: { mode: 'raw', value: '1, 2' },
      }),
    ).toBe("select * from t where a = 'o''neil' and b = 42 and c = NULL and d in (1, 2)");
  });
  it('escapes backslashes only for mysql', () => {
    const values = { a: { mode: 'text' as const, value: "x\\' or 1=1 -- " } };
    expect(substitute('select :a', 'mysql', values)).toBe("select 'x\\\\'' or 1=1 -- '");
    expect(substitute('select :a', 'postgresql', values)).toBe("select 'x\\'' or 1=1 -- '");
  });
  it('does not re-scan inserted values and leaves strings alone', () => {
    expect(
      substitute("select ':a', :a, :b", 'sqlite', {
        a: { mode: 'text', value: ':b' },
        b: { mode: 'text', value: 'z' },
      }),
    ).toBe("select ':a', ':b', 'z'");
  });
  it('rejects missing values, bad numbers and NUL', () => {
    expect(() => substitute('select :a', 'sqlite', {})).toThrow(VariableError);
    expect(() =>
      substitute('select :a', 'sqlite', { a: { mode: 'number', value: '1; drop' } }),
    ).toThrow(VariableError);
    expect(() =>
      substitute('select :a', 'sqlite', { a: { mode: 'text', value: 'a\u0000b' } }),
    ).toThrow(VariableError);
  });
});
