// SPDX-License-Identifier: AGPL-3.0-only
// Re-review (W-P16) confirmed formatter defects. it.fails = confirmed defect (assertion states correct behavior);
// it turns red as soon as the defect is fixed, then switch to it().
import { describe, expect, it } from 'vitest';
import { formatSql } from './format';

describe('formatter changes more than whitespace (confirmed on real servers)', () => {
  // Real PostgreSQL 18.6: SELECT 'x'<newline>'y' -> 'xy', but SELECT 'x' 'y' is a syntax error (42601).
  it('PG: newline between adjacent string literals is significant (continuation)', () => {
    for (const sql of [
      "SELECT 'x'\n'y'",
      "SELECT B'1'\n'0'",
      "SELECT X'41'\n'42'",
      "SELECT 'x'\r\n'y'",
      "SELECT 'x' /* c */\n'y'",
    ]) {
      const out = formatSql(sql, 'postgresql');
      expect(out === null || /'\s*(?:\/\*[^]*?\*\/)?\s*\n\s*'/.test(out), JSON.stringify(sql)).toBe(
        true,
      );
    }
  });
  // Real SQLite: ?1 is a numbered parameter, "? 1" is a syntax error.
  it('SQLite: ?NNN parameters stay one token', () => {
    expect(formatSql('SELECT ?1, ?23', 'sqlite')).toContain('?1');
    expect(formatSql('SELECT ?1, ?23', 'sqlite')).toContain('?23');
  });
  // SQLite and PostgreSQL do not treat U+000B as whitespace (syntax error); the formatter turns it into a space.
  // Real SQLite: @v(1=1) is ONE variable token with a TCL-style suffix; "(1 = 1)" makes it an illegal token.
  it('SQLite: whitespace inside @name(...) / $name(...) variable suffix is not changed', () => {
    const out = formatSql('SELECT @v(1=1)', 'sqlite');
    expect(out === null || out.includes('(1=1)')).toBe(true);
  });
  it('U+000B (vertical tab) is not turned into valid SQL on SQLite', () => {
    const out = formatSql('SELECT\u000b1', 'sqlite');
    expect(out === null || out.includes('\u000b')).toBe(true);
  });
  it('MySQL NO_BACKSLASH_ESCAPES: no silent respacing of literals when backslash-quote pairs mislead the lexer', () => {
    // Under NO_BACKSLASH_ESCAPES the statement is  'a\'  ,  'b  c'  ... the lexer reads \' as an escape.
    const sql = "select '\\','\\ '\nx\\''";
    const out = formatSql(sql, 'mysql');
    expect(out === null || out.replace(/[ \t\r\n]+/g, '') === sql.replace(/[ \t\r\n]+/g, '')).toBe(
      true,
    );
    // literals (server view: backslash is a plain character) must be byte identical
    const lits = (text: string) => text.match(/'[^']*'/g)?.join('|');
    expect(out === null || lits(out) === lits(sql)).toBe(true);
  });
});

describe('formatter limits hold', () => {
  it('refuses above 100000 characters and above nesting 40, quickly', () => {
    const t = performance.now();
    expect(formatSql('SELECT 1' + ' '.repeat(100_001), 'sqlite')).toBeNull();
    expect(formatSql('SELECT ' + '('.repeat(41) + '1' + ')'.repeat(41), 'sqlite')).toBeNull();
    expect(formatSql('SELECT ' + '('.repeat(40) + '1' + ')'.repeat(40), 'sqlite')).not.toBeNull();
    expect(performance.now() - t).toBeLessThan(500);
  });
  it('SQLite open bracket identifier is refused', () =>
    expect(formatSql('select [open', 'sqlite')).toBeNull());
  it('PG open dollar quote is refused', () =>
    expect(formatSql('select $a$ open', 'postgresql')).toBeNull());
  it('pathological inputs finish within a second', () => {
    const cases: [string, string][] = [
      ['SELECT 1 WHERE ' + ') AND '.repeat(15000), 'sqlite'],
      ['select 1 where x ' + 'or ) '.repeat(15000), 'sqlite'],
      ['select ' + 'a,'.repeat(40000) + 'b', 'sqlite'],
      ['select 1 where ' + 'a between 1 and 2 and '.repeat(4000) + '1', 'sqlite'],
      ['/*'.repeat(30000) + '*/'.repeat(30000) + 'select 1', 'postgresql'],
      ['select (1) '.repeat(9000), 'mysql'],
    ];
    for (const [sql, d] of cases) {
      const t = performance.now();
      formatSql(sql, d as 'sqlite');
      expect(performance.now() - t, sql.slice(0, 30)).toBeLessThan(1000);
    }
  });
  it('refuses DELIMITER, routine bodies and open literals', () => {
    for (const sql of [
      'DELIMITER //\nCREATE PROCEDURE p() BEGIN SELECT 1; END//',
      'CREATE FUNCTION f() RETURNS int BEGIN RETURN 1; END',
      'create trigger t before insert on x for each row set new.a = 1',
      "select 'open",
      'select /* open',
      'select "open',
      'DO $$ begin end $$',
    ])
      for (const d of ['sqlite', 'mysql', 'postgresql'] as const)
        expect(formatSql(sql, d), `${d}: ${sql}`).toBeNull();
  });
});
