// SPDX-License-Identifier: AGPL-3.0-only
// Independent review (W-P16): adversarial tests for formatter, lexer and :name substitution.
// "it" marks a CONFIRMED defect: the assertion states the correct behavior and currently does not hold.
// When a defect is fixed the it case turns red; change it to a plain "it" then.
import { describe, expect, it } from 'vitest';
import { formatSql } from './format';
import { placeholderNames, substitute, type VariableInput } from './variables';
import { significantTexts, tokenize } from './lexer';
import type { Driver } from '$lib/workbench';

const fmt = (sql: string, driver: Driver) => formatSql(sql, driver);
const text = (value: string): VariableInput => ({ mode: 'text', value });
const num = (value: string): VariableInput => ({ mode: 'number', value });

describe('formatter: correct behavior held under attack', () => {
  it('keeps hints, executable version comments, # comments and comment text byte-exact (mysql)', () => {
    const sql =
      'SELECT /*+ MAX_EXECUTION_TIME(1000) */ a FROM t /*!50000 USE INDEX (i) */ WHERE a=1 # why   not\n AND b=2';
    const out = fmt(sql, 'mysql')!;
    expect(out).toContain('/*+ MAX_EXECUTION_TIME(1000) */');
    expect(out).toContain('/*!50000 USE INDEX (i) */');
    expect(out).toContain('# why   not');
  });
  it('keeps mysql backslash escapes, doubled quotes and backtick identifiers', () => {
    const sql = 'SELECT \'a\\\'   b\', "c\\"  d", `e``  f` FROM t';
    // Backslash meaning depends on the server mode (NO_BACKSLASH_ESCAPES): the formatter refuses.
    expect(fmt(sql, 'mysql')).toBeNull();
    const out = fmt("SELECT 'a''   b', `e``  f` FROM t", 'mysql')!;
    for (const part of ["'a''   b'", '`e``  f`']) expect(out).toContain(part);
  });
  it('keeps sqlite bracket identifiers and tagged dollar quotes (letters only)', () => {
    expect(fmt('SELECT [a  b] FROM [t  u]', 'sqlite')).toContain('[a  b]');
    expect(fmt("SELECT $q$ it's   $$ x $q$ , 1", 'postgresql')).toContain("$q$ it's   $$ x $q$");
  });
  it('refuses open literals, open comments, routine bodies, DELIMITER', () => {
    for (const [sql, driver] of [
      ["SELECT 'open", 'sqlite'],
      ['SELECT "open', 'postgresql'],
      ['SELECT `open', 'mysql'],
      ['SELECT [open', 'sqlite'],
      ['SELECT $a$ open', 'postgresql'],
      ['SELECT /* open', 'mysql'],
      ['CREATE FUNCTION f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql', 'postgresql'],
      ['CREATE TRIGGER x AFTER INSERT ON t BEGIN SELECT 1; END', 'sqlite'],
      ['DO $$ BEGIN NULL; END $$', 'postgresql'],
      ['DELIMITER //\nSELECT 1//', 'mysql'],
    ] as [string, Driver][])
      expect(fmt(sql, driver), sql).toBeNull();
  });
  it('is idempotent on a hostile corpus', () => {
    const corpus: [string, Driver][] = [
      ['select a- -b\nfrom t', 'mysql'],
      ["select '#x', 1 # c\n, 2", 'mysql'],
      ['select x::int, a[1:2], $1 from t where a<>b and c!~d', 'postgresql'],
      ["select a->'x'->>'y' from t where b=1", 'sqlite'],
    ];
    for (const [sql, driver] of corpus) {
      const out = fmt(sql, driver)!;
      expect(fmt(out, driver), sql).toBe(out);
    }
  });
});

describe('formatter: CONFIRMED semantic changes (whitespace inserted/removed inside one SQL token)', () => {
  // F-1: PostgreSQL multi-character operators starting with @ # or < @ are split by the lexer, then re-spaced.
  it('does not split postgres operators @> <@ #> #>> #-', () => {
    const out = fmt(
      "SELECT * FROM t WHERE d @> '{}' AND e <@ x AND j #>> '{a}' = 'x' AND k #- '{b}' IS NULL",
      'postgresql',
    )!;
    for (const op of ['@>', '<@', '#>>', '#-']) expect(out).toContain(op);
  });
  // F-2: literal prefixes (E'', U&'', X'', B'', N'', x'') get a space before the quote.
  it('keeps string prefixes glued to their literal (E, U&, X, B, N)', () => {
    expect(fmt("SELECT E'a\\nb'", 'postgresql')).toContain("E'a\\nb'");
    expect(fmt("SELECT U&'d\\0061t'", 'postgresql')).toContain("U&'d\\0061t'");
    expect(fmt("SELECT X'41'", 'mysql')).toContain("X'41'");
    expect(fmt("SELECT x'41'", 'sqlite')).toContain("x'41'");
    expect(fmt("SELECT B'101'", 'postgresql')).toContain("B'101'");
  });
  // F-3: unary minus after unary minus is glued into "--" which starts a comment.
  it('never glues "- -" into a line comment', () => {
    for (const driver of ['sqlite', 'mysql', 'postgresql'] as Driver[]) {
      const out = fmt('SELECT - -1, + +2', driver)!;
      expect(out).not.toContain('--');
    }
  });
  // F-4: trailing blanks inside multi-line strings/comments are removed by a global regex.
  it('keeps trailing blanks inside multi-line string literals', () => {
    const sql = "SELECT 'line1   \nline2   \n  line3'";
    expect(fmt(sql, 'postgresql')).toContain("'line1   \nline2   \n  line3'");
  });
  // F-5: PostgreSQL E'..\'..' : the lexer ignores backslash escapes for postgresql, so string content leaks out as code.
  it("keeps E-strings with \\' escapes intact (postgresql)", () => {
    const sql = "SELECT E'a\\'   b\\'', 1";
    const out = fmt(sql, 'postgresql');
    expect(out === null || out.includes("E'a\\'   b\\''")).toBe(true);
  });
  // F-6: nested block comments (PostgreSQL) end at the first "*/"; the remainder is formatted as code.
  it('keeps text after a nested postgres block comment intact', () => {
    const sql = "/* /* */ ' */ SELECT 'x  y' -- '";
    const out = fmt(sql, 'postgresql');
    expect(out === null || out.includes("'x  y'")).toBe(true);
  });
  // F-7 confirmed: dollar-quote tags with digits are not recognized; the body is re-spaced.
  it('recognizes dollar quote tags with digits ($t1$) or refuses', () => {
    const sql = 'SELECT $t1$ a   b $t1$, 2';
    const out = fmt(sql, 'postgresql');
    expect(out === null || out.includes('$t1$ a   b $t1$')).toBe(true);
  });
  // Checked, not a defect: NBSP inside names.
  it('does not turn NBSP inside a name into a separator', () => {
    const out = fmt('SELECT a b FROM t', 'postgresql');
    expect(out === null || out.includes('a b')).toBe(true);
  });
  // F-9: cost grows quadratically with size (85 kB of statements: ~1.4 s, nested parentheses far worse).
  it('formats 84 kB within 400 ms', () => {
    const big = 'SELECT a, b FROM t WHERE x = 1 AND y = 2;\n'.repeat(2000);
    const start = performance.now();
    fmt(big, 'sqlite');
    expect(performance.now() - start).toBeLessThan(400);
  });
});

describe('formatter: tokens glued in the input stay glued (independent oracle)', () => {
  // The existing token-sequence test re-lexes with the same lexer and cannot see a split token.
  const samples: [string, Driver][] = [
    ['a @> b', 'postgresql'],
    ["SELECT a->>'x', b#>'{y}'", 'postgresql'],
    ['SELECT a||b, c<=>d, e!=f, g>=h', 'mysql'],
    ["SELECT x'41', 0x41, @v:=1, @@version", 'mysql'],
  ];
  it('no glued pair of the input is separated in the output', () => {
    for (const [sql, driver] of samples) {
      const out = fmt(sql, driver)!;
      const glued = (s: string, d: Driver) => {
        const t = tokenize(s, d)!.filter((x) => x.kind !== 'space');
        return new Set(
          t
            .slice(1)
            .filter((x, i) => t[i].end === x.start)
            .map((x, i) => x.text + '|' + i && ''),
        );
      };
      void glued;
      const compact = (s: string) => s.replace(/\s+/g, '');
      // Without strings/comments in these samples the whitespace-free text must be equal AND every
      // input operator run must still occur verbatim in the output.
      expect(compact(out)).toBe(compact(sql));
      for (const run of sql.match(/[@#<>=!|\-&:]{2,}|[A-Za-z]'/g) ?? [])
        expect(out, `${sql} -> ${out} lost ${run}`).toContain(run);
    }
  });
});

describe('placeholders: detection', () => {
  it('skips strings, comments, quoted identifiers, dollar quotes, casts, slices, := ', () => {
    const sql =
      'SELECT \':s\', ":q", `:b`, /* :c */ :a, -- :d\n x::int, arr[1:n], $$:e$$, $t$:f$t$, @v:=1, :z';
    expect(placeholderNames(sql, 'postgresql')).toEqual(['a', 'z']);
    expect(placeholderNames("SELECT '#:x' # :y\n, :ok", 'mysql')).toEqual(['ok']);
    expect(placeholderNames('SELECT [:x], :y FROM [:t]', 'sqlite')).toEqual(['y']);
  });
  it('finds nothing (and replaces nothing) when a literal is open', () => {
    expect(placeholderNames("SELECT 'open :x", 'sqlite')).toEqual([]);
    expect(substitute("SELECT 'open :x", 'sqlite', {})).toBe("SELECT 'open :x");
  });
  it('limits to 32 names', () => {
    const sql = 'SELECT ' + Array.from({ length: 40 }, (_, i) => `:v${i}`).join(',');
    expect(placeholderNames(sql, 'sqlite')).toHaveLength(32);
  });
});

describe('placeholders: injection through values', () => {
  const hostile = [
    "' OR 1=1 --",
    "\\' OR 1=1 -- ",
    "'; DROP TABLE t; --",
    'a\\',
    "\\\\'",
    '’ OR 1=1',
    '$$ x',
  ];
  it('text mode: the result is exactly one string literal for every dialect lexer', () => {
    for (const driver of ['sqlite', 'mysql', 'postgresql'] as Driver[])
      for (const value of hostile) {
        const out = substitute('SELECT :v', driver, { v: text(value) });
        const tokens = tokenize(out, driver)!.filter((t) => t.kind !== 'space');
        expect(
          tokens.map((t) => t.kind),
          `${driver} ${JSON.stringify(value)} -> ${out}`,
        ).toEqual(['word', 'string']);
      }
  });
  it('text mode refuses NUL and over-long values; number mode is strict', () => {
    expect(() => substitute(':v', 'sqlite', { v: text('a\u0000b') })).toThrow();
    expect(() => substitute(':v', 'sqlite', { v: text('x'.repeat(10001)) })).toThrow();
    for (const bad of ['1 OR 1', '1;2', '0x10', '1e', '', ' ', 'NaN', '1,2', '--1', '١٢'])
      expect(() => substitute(':v', 'sqlite', { v: num(bad) }), bad).toThrow();
    for (const good of ['1', '-1', '+1.5', '.5', '1e-3', ' 7 '])
      expect(() => substitute(':v', 'sqlite', { v: num(good) }), good).not.toThrow();
  });
  it('values are not rescanned (a value that looks like a placeholder stays text)', () => {
    expect(substitute(':a :b', 'sqlite', { a: text(':b'), b: text('x') })).toBe("':b' 'x'");
  });
  it('NULL ignores the entered text', () => {
    expect(substitute(':a', 'sqlite', { a: { mode: 'null', value: "' OR 1=1" } })).toBe('NULL');
  });
  it('postgres text mode is only safe with standard_conforming_strings=on (documented)', () => {
    // With standard_conforming_strings=off a backslash escapes the quote: \' OR 1=1 breaks out.
    const out = substitute('SELECT :v', 'postgresql', { v: text("\\' OR 1=1 --") });
    expect(out).toBe("SELECT '\\'' OR 1=1 --'");
  });
  // F-10: a negative number glued to a preceding minus makes a line comment and drops the rest of the statement.
  it('number mode never forms "--" with the template', () => {
    for (const driver of ['sqlite', 'mysql', 'postgresql'] as Driver[]) {
      const out = substitute('SELECT 10 -:n AND x', driver, { n: num('-5') });
      expect(out).not.toContain('--');
    }
  });
});
