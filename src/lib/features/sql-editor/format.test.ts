// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { formatSql } from './format';
import { significantTexts, tokenize } from './lexer';
import type { Driver } from '$lib/workbench';

const drivers: Driver[] = ['sqlite', 'mysql', 'postgresql'];

describe('formatSql', () => {
  it('breaks clauses and select lists but keeps keyword case', () => {
    expect(formatSql('select a,b,c from t where x=1 and y=2 order by a limit 5', 'sqlite')).toBe(
      'select\n  a,\n  b,\n  c\nfrom t\nwhere x = 1\n  and y = 2\norder by a\nlimit 5',
    );
  });
  it('keeps a single column on the select line and keeps functions tight', () => {
    expect(formatSql('SELECT count(*) FROM t', 'sqlite')).toBe('SELECT count(*)\nFROM t');
    expect(formatSql('SELECT * FROM t WHERE a IN (1,2,3)', 'sqlite')).toBe(
      'SELECT *\nFROM t\nWHERE a IN (1, 2, 3)',
    );
  });
  it('does not split BETWEEN ... AND', () => {
    expect(formatSql('select 1 from t where a between 1 and 2 and b=3', 'sqlite')).toBe(
      'select 1\nfrom t\nwhere a between 1 and 2\n  and b = 3',
    );
  });
  it('indents joins and subqueries', () => {
    const out = formatSql(
      'select a from t left join u on t.id=u.id where a in (select id from v where z=1)',
      'postgresql',
    );
    expect(out).toBe(
      'select a\nfrom t\nleft join u\n  on t.id = u.id\nwhere a in (\n  select id\n  from v\n  where z = 1\n)',
    );
  });
  it('separates statements with a blank line and handles casts and negatives', () => {
    expect(formatSql('select 1;select x::int, -1 from t;', 'postgresql')).toBe(
      'select 1;\n\nselect\n  x::int,\n  -1\nfrom t;',
    );
  });
  it('never touches strings, comments, quoted identifiers or dollar quotes', () => {
    const sql = "select 'a  ,  b' , \"x  y\" -- keep   this\n from t /* a   b */ where c='it''s'  ";
    const out = formatSql(sql, 'sqlite')!;
    expect(out).toContain("'a  ,  b'");
    expect(out).toContain('"x  y"');
    expect(out).toContain('-- keep   this');
    expect(out).toContain('/* a   b */');
    expect(out).toContain("'it''s'");
    expect(formatSql('select $a$x   y$a$ from t', 'postgresql')).toContain('$a$x   y$a$');
  });
  it('refuses unterminated literals and procedural bodies', () => {
    expect(formatSql("select 'open", 'sqlite')).toBeNull();
    expect(formatSql('select /* open', 'sqlite')).toBeNull();
    expect(formatSql('create procedure p() begin select 1; end', 'mysql')).toBeNull();
    expect(formatSql('DELIMITER //\nselect 1//', 'mysql')).toBeNull();
  });
  it('returns whitespace-only input unchanged', () => {
    expect(formatSql('  \n ', 'sqlite')).toBe('  \n ');
  });
  it('preserves the token sequence and is idempotent', () => {
    const samples = [
      "select a,b from t where x in (1,2) and y between 1 and 2 or z like '%a b%'",
      'with c as (select 1) select * from c union all select 2',
      'insert into t(a,b) values (1,2),(3,4) returning a',
      'update t set a=1,b=a+ -1 where id=:id',
      'select a::text, b[1], t.* from t -- c\n where x = ?',
      'select count(*) over (partition by a order by b) from t group by a having count(*)>1',
    ];
    for (const driver of drivers)
      for (const sample of samples) {
        const out = formatSql(sample, driver)!;
        expect(out, sample).not.toBeNull();
        expect(significantTexts(tokenize(out, driver)!)).toEqual(
          significantTexts(tokenize(sample, driver)!),
        );
        expect(formatSql(out, driver)).toBe(out);
      }
  });
});
