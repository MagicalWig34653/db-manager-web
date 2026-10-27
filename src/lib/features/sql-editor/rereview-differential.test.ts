// SPDX-License-Identifier: AGPL-3.0-only
// Re-review differential test (independent of lexer.ts): static whitespace-only proof with a separate scanner,
// real SQLite execution of formatted vs unformatted statements, and a JSON dump consumed by
// tests/differential/run-differential.py (PostgreSQL, MySQL, MariaDB). Set DBM_CORPUS_OUT to a directory to dump.
import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { formatSql } from './format';
import { DOC_EXAMPLES, generate, respace, rng, summarize } from './rereview-corpus';
import type { Driver } from '$lib/workbench';

const DRIVERS: Driver[] = ['sqlite', 'mysql', 'postgresql'];
const FIXTURES =
  process.env.DBM_FIXTURE_JSON && existsSync(process.env.DBM_FIXTURE_JSON)
    ? (JSON.parse(readFileSync(process.env.DBM_FIXTURE_JSON, 'utf8')) as string[])
    : [];
const COUNT = Number(process.env.DBM_CORPUS_COUNT ?? 5000);

function corpus(d: Driver): string[] {
  const rand = rng(d === 'sqlite' ? 1 : d === 'mysql' ? 2 : 3);
  const base = [...generate(d, COUNT, d.length * 7919), ...DOC_EXAMPLES[d], ...FIXTURES];
  const out: string[] = [];
  for (const sql of base) {
    out.push(sql);
    if (sql.length < 3000) {
      for (let k = 0; k < (FIXTURES.includes(sql) ? 1 : 2); k++) out.push(respace(sql, d, rand));
      out.push(sql.replace(/\n/g, '\r\n'));
    }
  }
  return out;
}

const SIDE_EFFECT =
  /\b(insert|update|delete|create|drop|alter|truncate|call|copy|set|grant|revoke|into|sleep|benchmark|pg_sleep|nextval|setval|lock|load_file|get_lock|dblink|lo_\w+|pg_\w+|for\s+update|attach|detach|pragma|vacuum|recursive|randomblob|zeroblob|generate_series|replace|explain|analyze|execute|prepare|do|declare|begin|commit|rollback|savepoint|reset|show|use)\b/i;
const readOnlySelect = (sql: string) =>
  !/\d{8,}/.test(sql) &&
  /^\s*(select|values|with)\b/i.test(sql) &&
  !SIDE_EFFECT.test(sql.replace(/'(?:[^']|'')*'/g, "''"));

// Only a SQLite-specific artifact stays excluded: "@@x" and "a:b" are variable syntax the sqlite3 module rejects either way.
const known = (sql: string, d: Driver) =>
  d === 'sqlite' && /@@|[A-Za-z0-9_)\]]:[A-Za-z_]/.test(sql);

const norm = (v: unknown): unknown =>
  typeof v === 'bigint'
    ? `${v}n`
    : v instanceof Uint8Array
      ? `0x${Buffer.from(v).toString('hex')}`
      : v;
function runSqlite(db: import('node:sqlite').DatabaseSync, sql: string): string {
  try {
    const rows = db
      .prepare(sql)
      .all()
      .map((r) => Object.values(r).map(norm));
    return 'ok:' + JSON.stringify(rows);
  } catch (e) {
    const err = e as { errcode?: number; errstr?: string };
    return 'err:' + (err.errcode ?? '?') + ':' + (err.errstr ?? '');
  }
}

describe.each(DRIVERS)('re-review differential (%s)', (d) => {
  const statements = corpus(d);
  const results: { o: string; f: string | null }[] = statements.map((o) => ({
    o,
    f: formatSql(o, d),
  }));

  it('corpus is large and mostly formatted', () => {
    expect(statements.length).toBeGreaterThanOrEqual(5000);
    const formatted = results.filter((r) => r.f !== null).length;
    console.log(
      `${d}: ${statements.length} statements, ${formatted} formatted, ${statements.length - formatted} refused`,
    );
    expect(formatted).toBeGreaterThan(statements.length * 0.5);
  });

  it('static: code tokens, literals and comments identical (own scanner)', () => {
    const bad: string[] = [];
    let compared = 0;
    for (const { o, f } of results) {
      if (f === null || known(o, d)) continue;
      const a = summarize(o, d);
      const b = summarize(f, d);
      compared++;
      if (!a || !b) bad.push(`UNSCANNABLE ${JSON.stringify(o)} => ${JSON.stringify(f)}`);
      else if (JSON.stringify(a) !== JSON.stringify(b))
        bad.push(`DIFF ${JSON.stringify(o)} => ${JSON.stringify(f)}`);
    }
    console.log(`${d}: compared ${compared}, violations ${bad.length}`);
    if (bad.length) console.log(bad.slice(0, 25).join('\n'));
    expect(bad).toEqual([]);
  });

  it('idempotent and no whitespace-only entry is made non-whitespace', () => {
    const bad: string[] = [];
    for (const { o, f } of results) {
      if (f === null) continue;
      const again = formatSql(f, d);
      if (again !== f)
        bad.push(`IDEMP ${JSON.stringify(o)} => ${JSON.stringify(f)} => ${JSON.stringify(again)}`);
    }
    if (bad.length) console.log(bad.slice(0, 15).join('\n'));
    expect(bad).toEqual([]);
  });

  if (d === 'sqlite')
    it('real SQLite: formatted and unformatted give the same rows or the same error code', async () => {
      const sqlite = await import('node:sqlite');
      const db = new sqlite.DatabaseSync(':memory:');
      const bad: string[] = [];
      let ran = 0;
      let ok = 0;
      for (const { o, f } of results) {
        if (f === null || !readOnlySelect(o) || known(o, d)) continue;
        ran++;
        const x = runSqlite(db, o);
        const y = runSqlite(db, f);
        if (x.startsWith('ok')) ok++;
        if (
          x !== y &&
          !(x.startsWith('err') && y.startsWith('err') && x.split(':')[1] === y.split(':')[1])
        )
          bad.push(`${x}  VS  ${y}\n   ${JSON.stringify(o)}\n   ${JSON.stringify(f)}`);
      }
      console.log(`sqlite: executed ${ran} pairs, ${ok} succeeded, ${bad.length} differ`);
      if (bad.length) console.log(bad.slice(0, 25).join('\n'));
      expect(bad).toEqual([]);
    });

  it('dump corpus for the real-server differential', () => {
    const out = process.env.DBM_CORPUS_OUT;
    if (!out) return;
    mkdirSync(out, { recursive: true });
    const pairs = results
      .filter(({ o, f }) => f !== null && f !== o && readOnlySelect(o))
      .map(({ o, f }) => ({ o, f }));
    writeFileSync(join(out, `${d}.json`), JSON.stringify(pairs));
    console.log(`${d}: dumped ${pairs.length} pairs`);
  });
});
