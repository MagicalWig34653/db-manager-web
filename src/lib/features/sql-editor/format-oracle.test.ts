// SPDX-License-Identifier: AGPL-3.0-only
// Independent proof that the formatter changes whitespace only. None of these checks uses the formatter's lexer:
// (a) whitespace-free text of input and output is identical, (b) every literal/comment piece of a known pool occurs
// byte-exact the same number of times, (c) idempotence, (d) results of really executing the unformatted and the
// formatted statement on SQLite are identical.
import { describe, expect, it } from 'vitest';
import { formatSql } from './format';
import type { Driver } from '$lib/workbench';

const strip = (text: string) => text.replace(/[ \t\r\n\f\v]+/g, '');
let seed = 12345;
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];

const literals: Record<Driver, string[]> = {
  sqlite: [
    "'a  b'",
    "'it''s   x'",
    "'line1   \nline2   '",
    '"q  r"',
    '[s  t]',
    "x'41'",
    '-- c   d',
    '/* e   f */',
  ],
  mysql: [
    "'a  b'",
    "'x\\'   y'",
    '"d\\"  e"',
    '`b  c`',
    "x'41'",
    "N'z  z'",
    '# note   here',
    '/*! 1  */',
    '/* e   f */',
  ],
  postgresql: [
    "'a  b'",
    "E'x\\'   y'",
    "U&'d\\0061t  a'",
    "B'101'",
    "X'4a'",
    '$t1$ a   b $t1$',
    '$$ p   q $$',
    '"q  r"',
    "/* /* n   n */ ' */",
    "'m\n  n   \nx'",
    '-- k   l',
  ],
};
const codes: Record<Driver, string[]> = {
  sqlite: [
    'select',
    'from',
    'where',
    'and',
    '1',
    '2',
    'x',
    '-',
    '+',
    '*',
    '/',
    '||',
    '<>',
    '<=',
    '=',
    '(',
    ')',
    ',',
    'a.b',
    '->',
    '->>',
  ],
  mysql: [
    'select',
    'from',
    'where',
    'or',
    '1',
    '0x1F',
    'x',
    '-',
    '+',
    '*',
    '<=>',
    '!=',
    '=',
    '(',
    ')',
    ',',
    '@v',
    ':=',
    '||',
    '&&',
  ],
  postgresql: [
    'select',
    'from',
    'where',
    'and',
    '1',
    'x',
    '-',
    '+',
    '*',
    '@>',
    '<@',
    '#>>',
    '#-',
    '||',
    '::int',
    '<>',
    '(',
    ')',
    ',',
    '[',
    ']',
    '&',
    '@',
    '~*',
    '!~',
    '$1',
  ],
};
const spaces = [' ', '  ', '\n', ' \t'];

function sample(driver: Driver): string {
  const parts: string[] = [];
  const count = 4 + Math.floor(random() * 10);
  for (let i = 0; i < count; i++) {
    const piece = random() < 0.3 ? pick(literals[driver]) : pick(codes[driver]);
    parts.push(piece);
    // A line comment runs to the end of the line, so it always gets one.
    parts.push(/^(--|#)/.test(piece) ? '\n' : pick(spaces));
  }
  return parts.join('');
}
const countOf = (text: string, piece: string) => text.split(piece).length - 1;

describe('formatter oracle (generated corpus)', () => {
  for (const driver of ['sqlite', 'mysql', 'postgresql'] as Driver[])
    it(`${driver}: whitespace-only, literals byte-exact, idempotent`, () => {
      let formatted = 0;
      for (let n = 0; n < 4000; n++) {
        const input = sample(driver);
        const out = formatSql(input, driver);
        if (out === null) continue;
        formatted++;
        expect(strip(out), JSON.stringify(input)).toBe(strip(input));
        for (const piece of literals[driver])
          expect(countOf(out, piece), `${piece} in ${JSON.stringify(input)}`).toBe(
            countOf(input, piece),
          );
        expect(formatSql(out, driver), JSON.stringify(input)).toBe(out);
      }
      // The corpus must not be refused wholesale, otherwise the properties above prove nothing.
      expect(formatted).toBeGreaterThan(300);
    });
});

describe('formatter oracle (real SQLite execution)', () => {
  it('gives the same results for the unformatted and the formatted statement', async () => {
    const sqlite = await import('node:sqlite').catch(() => null);
    if (!sqlite) return;
    const db = new sqlite.DatabaseSync(':memory:');
    db.exec("create table t (id integer, name text); insert into t values (1,'a  b'),(2,'c');");
    const corpus = [
      "select id,name,'x   y' from t where id>0 and name<>'z' order by id",
      'select - -1, + +2, 3 - -4, 5- - 6',
      'select 10 -(-5), 1 /* c */ + 2, 7 -- k\n+ 1',
      "select name||'  ' ||id, id*-1, id<=2 from t",
      "select '{\"a\":1}'->>'$.a', '{\"a\":[1,2]}'->'$.a'",
      "select 'line1   \nline2   ', x'41', [id] from t",
      'select count(*), max(id), min(id) from t where id in (1,2) and id between 1 and 2',
      "select case when id=1 then 'one' else 'other' end, id from t",
      'select a.id from t a join t b on a.id=b.id where a.id>=1 and b.id<=2',
    ];
    for (const sql of corpus) {
      const out = formatSql(sql, 'sqlite');
      expect(out, sql).not.toBeNull();
      const run = (text: string) =>
        JSON.stringify(
          db
            .prepare(text)
            .all()
            .map((row) => Object.values(row)),
        );
      expect(run(out!), sql).toBe(run(sql));
    }
  });
});
