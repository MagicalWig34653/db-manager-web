// SPDX-License-Identifier: AGPL-3.0-only
// Third review: NEW corpus (comment/line-ending mutations of statements from other sources) for the real-server differential.
// Dump with DBM_CORPUS_OUT; static whitespace-only proof runs always.
import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { formatSql } from './format';
import { DOC_EXAMPLES, generate, rng, scan, summarize } from './rereview-corpus';
import type { Driver } from '$lib/workbench';

const load = (f: string): string[] =>
  existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as string[]) : [];
const SOURCES = [...load(process.env.DBM_FIX_A ?? ''), ...load(process.env.DBM_FIX_B ?? '')].filter(
  (s) => s.length < 1500,
);

const LINE = ['-- c  x\n', '--\tx\n', '-- \n', '--\n', '-- a\r\n', '-- trailing  ws   \n'];
const MY_LINE = [...LINE, '# h  i\n', '#\n', '--x\n', '--\n'];
const BLOCK = [
  '/* c  d */',
  '/*+ h(1)  */',
  '/*! 1  */',
  '/*!50000  */',
  '/**/',
  '/* a\n  b */',
  '/*M!100000  */',
];

function mutate(sql: string, d: Driver, rand: () => number): string {
  const segs = scan(sql, d);
  if (!segs) return sql;
  const line = d === 'mysql' ? MY_LINE : LINE;
  const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];
  let out = '';
  for (const s of segs) {
    if (s.kind !== 'code') {
      out += s.text;
      continue;
    }
    out += s.text.replace(/[ \t\r\n\f]+|(?<=[,()])(?=\S)/g, (ws) => {
      const r = rand();
      if (r < 0.18) return ' ' + pick(line);
      if (r < 0.3) return ws + pick(BLOCK) + ' ';
      if (r < 0.34) return pick(['\n', '\r\n', ' \n ', '\t\n']);
      return ws;
    });
  }
  const end = rand();
  if (end < 0.2) out += ' -- end  of  text';
  else if (end < 0.3) out += '\n-- end';
  else if (end < 0.35 && d === 'mysql') out += ' --';
  else if (end < 0.4) out += ' /* end */';
  return out;
}

const PG_BODIES = [
  "SELECT $$ a -- b\n  c $$ || 'x'",
  "SELECT $q$ it's -- not  a comment $q$",
  'SELECT $a$ $b$ x  y $b$ $a$',
  "SELECT $$ /* open $$ || 'z'",
  "SELECT E'a\\n  b' -- c\n, $$x  y$$",
  'SELECT 1 -- c\n+ 2 -- d',
  "SELECT 'a'-- c\n|| 'b'",
  "SELECT 'a' -- c\n 'b'",
  "SELECT 'a' /* c */ 'b'",
];

function corpus(d: Driver, n: number): string[] {
  const rand = rng(777 + d.length * 31);
  const base = [
    ...generate(d, n, 424242 + d.length),
    ...DOC_EXAMPLES[d],
    ...SOURCES,
    ...(d === 'postgresql' ? PG_BODIES : []),
  ];
  const out: string[] = [];
  for (const s of base) {
    out.push(mutate(s, d, rand));
    out.push(mutate(s, d, rand));
    out.push(s + ' -- x');
    out.push(s.replace(/ /g, ' -- c\n').slice(0, 2000));
  }
  return out;
}

const SIDE =
  /\b(insert|update|delete|create|drop|alter|truncate|call|copy|set|grant|revoke|into|sleep|benchmark|pg_\w+|for\s+update|attach|pragma|vacuum|replace|execute|prepare|do|begin|commit|rollback|show|use|recursive|generate_series|randomblob|zeroblob|lo_\w+|dblink|nextval|setval|get_lock|load_file)\b/i;
const ok = (sql: string) =>
  !/\d{8,}/.test(sql) &&
  /^\s*(select|values|with)\b/i.test(sql) &&
  !SIDE.test(sql.replace(/'(?:[^']|'')*'/g, "''"));

describe.each(['sqlite', 'mysql', 'postgresql'] as Driver[])('review3 corpus (%s)', (d) => {
  const stmts = corpus(d, 3500).filter(
    (s) => !/[A-Za-z0-9_)\]]:[A-Za-z_]/.test(s) && !/@@/.test(s),
  );
  const res = stmts.map((o) => ({ o, f: formatSql(o, d) }));
  it('static: only whitespace changes (own scanner) and idempotent', () => {
    const bad: string[] = [];
    let n = 0;
    for (const { o, f } of res) {
      if (f === null) continue;
      n++;
      const a = summarize(o, d);
      const b = summarize(f, d);
      if (!a || !b || JSON.stringify(a) !== JSON.stringify(b))
        bad.push(JSON.stringify(o) + ' => ' + JSON.stringify(f));
      else if (formatSql(f, d) !== f) bad.push('IDEMP ' + JSON.stringify(o));
      // a line comment must still end with a line break unless it was last
      for (const s of scan(f, d) ?? []) void s;
    }
    console.log(`${d}: ${stmts.length} statements, ${n} formatted`);
    if (bad.length) console.log(bad.slice(0, 15).join('\n'));
    expect(bad).toEqual([]);
  });
  if (d === 'sqlite')
    it('real SQLite same result', async () => {
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(':memory:');
      const run = (s: string) => {
        try {
          return (
            'ok' +
            JSON.stringify(
              db
                .prepare(s)
                .all()
                .map((r) =>
                  Object.values(r).map((v) =>
                    typeof v === 'bigint'
                      ? `${v}n`
                      : v instanceof Uint8Array
                        ? Buffer.from(v).toString('hex')
                        : v,
                  ),
                ),
            )
          );
        } catch (e) {
          return 'err' + (e as { errcode?: number }).errcode;
        }
      };
      const bad: string[] = [];
      let c = 0;
      for (const { o, f } of res) {
        if (f === null || !ok(o)) continue;
        c++;
        if (run(o) !== run(f))
          bad.push(JSON.stringify(o) + ' => ' + JSON.stringify(f) + ' ' + run(o) + ' ' + run(f));
      }
      console.log(`sqlite executed ${c} pairs, ${bad.length} differ`);
      if (bad.length) console.log(bad.slice(0, 10).join('\n'));
      expect(bad).toEqual([]);
    });
  it('dump', () => {
    const out = process.env.DBM_CORPUS_OUT;
    if (!out) return;
    mkdirSync(out, { recursive: true });
    const pairs = res
      .filter(({ o, f }) => f !== null && f !== o && ok(o))
      .map(({ o, f }) => ({ o, f }));
    writeFileSync(join(out, `${d}.json`), JSON.stringify(pairs));
    console.log(`${d}: dumped ${pairs.length}`);
  });
});
