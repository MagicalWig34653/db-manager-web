// SPDX-License-Identifier: AGPL-3.0-only
// Reviewer corpus for the formatter differential test. Independent of lexer.ts/format.ts: it has its own mini scanner
// (segments of code / literal / comment per dialect) used for respacing and for the static whitespace-only proof.
import type { Driver } from '$lib/workbench';

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type SegKind = 'code' | 'lit' | 'comment';
export interface Seg {
  kind: SegKind;
  text: string;
}
const WORDISH = /[A-Za-z0-9_$\u0080-￿]/;

/** Independent scanner. Returns null for unterminated constructs. */
export function scan(sql: string, d: Driver, noBackslash = false): Seg[] | null {
  const out: Seg[] = [];
  let code = '';
  const flush = () => {
    if (code) out.push({ kind: 'code', text: code });
    code = '';
  };
  let i = 0;
  const n = sql.length;
  const quoted = (from: number, backslash: boolean): number => {
    const q = sql[from];
    let j = from + 1;
    while (j < n) {
      if (backslash && sql[j] === '\\') j += 2;
      else if (sql[j] === q) {
        if (sql[j + 1] === q) j += 2;
        else return j + 1;
      } else j++;
    }
    return -1;
  };
  while (i < n) {
    const c = sql[i];
    const prev = i > 0 ? sql[i - 1] : '';
    const prevWord = prev !== '' && WORDISH.test(prev);
    const lit = (end: number) => {
      flush();
      out.push({ kind: 'lit', text: sql.slice(i, end) });
      i = end;
    };
    if (
      c === '-' &&
      sql[i + 1] === '-' &&
      (d !== 'mysql' || /[\s\x00-\x1f]|^$/.test(sql[i + 2] ?? ''))
    ) {
      let e = sql.indexOf('\n', i);
      if (e < 0) e = n;
      flush();
      out.push({ kind: 'comment', text: sql.slice(i, e) });
      i = e;
    } else if (c === '#' && d === 'mysql') {
      let e = sql.indexOf('\n', i);
      if (e < 0) e = n;
      flush();
      out.push({ kind: 'comment', text: sql.slice(i, e) });
      i = e;
    } else if (c === '/' && sql[i + 1] === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (sql[j] === '*' && sql[j + 1] === '/') {
          depth--;
          j += 2;
        } else if (d === 'postgresql' && sql[j] === '/' && sql[j + 1] === '*') {
          depth++;
          j += 2;
        } else j++;
      }
      if (depth > 0) return null;
      flush();
      out.push({ kind: 'comment', text: sql.slice(i, j) });
      i = j;
    } else if (c === "'" || c === '"' || c === '`') {
      const e = quoted(i, d === 'mysql' && c !== '`' && !noBackslash);
      if (e < 0) return null;
      lit(e);
    } else if (c === '[' && d === 'sqlite') {
      const e = sql.indexOf(']', i);
      if (e < 0) return null;
      lit(e + 1);
    } else if (d === 'postgresql' && c === '$' && !prevWord) {
      const m = /^\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/.exec(sql.slice(i, i + 200));
      if (m) {
        const e = sql.indexOf(m[0], i + m[0].length);
        if (e < 0) return null;
        lit(e + m[0].length);
      } else {
        code += c;
        i++;
      }
    } else if (
      !prevWord &&
      /[EeUuXxBbNn]/.test(c) &&
      ((sql[i + 1] === "'" && d !== 'sqlite') ||
        (sql[i + 1] === "'" && /[Xx]/.test(c)) ||
        (/[Uu]/.test(c) && sql[i + 1] === '&' && sql[i + 2] === "'" && d === 'postgresql'))
    ) {
      // prefixed literal: prefix + quote
      const qa = sql[i + 1] === '&' ? i + 2 : i + 1;
      const bs = (d === 'postgresql' && /[Ee]/.test(c)) || (d === 'mysql' && !noBackslash);
      const e = quoted(qa, bs);
      if (e < 0) return null;
      lit(e);
    } else {
      code += c;
      i++;
    }
  }
  flush();
  return out;
}

/** Splits code into tokens: word runs, operator runs, numbers, single punctuation. Whitespace dropped. */
export function codeTokens(code: string, d: Driver): string[] {
  const out: string[] = [];
  const ops =
    d === 'postgresql'
      ? '+\\-*/<>=~!@#%^&|?'
      : d === 'mysql'
        ? '+\\-*/<>=~!%^&|'
        : '+\\-*/<>=~!%&|';
  const re = new RegExp(
    '[ \\t\\r\\n\\f\\v]+|\\d+(?:\\.\\d*)?(?:[eE][+-]?\\d+)?[A-Za-z0-9_$]*|\\.\\d+[A-Za-z0-9_$]*|' +
      (d === 'postgresql' ? '' : '@{1,2}(?=[A-Za-z_$`\'"])[A-Za-z0-9_$]*|') +
      (d === 'sqlite' ? '\\?\\d+|:[A-Za-z_]\\w*|' : '') +
      '::|:=|[A-Za-z_$\\u0080-\\uffff][A-Za-z0-9_$\\u0080-\\uffff]*|[' +
      ops +
      ']+|[\\s\\S]',
    'g',
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) if (!/^[ \t\r\n\f\v]+$/.test(m[0])) out.push(m[0]);
  return out;
}

export interface Summary {
  /** Sequence of items: code tokens (code:..), literals (lit:..) and comments (com:..), byte exact. */
  items: string[];
}
/** Independent decomposition of a statement into code tokens, literals and comments (bytes exact). */
export function summarize(sql: string, d: Driver): string[] | null {
  const segs = scan(sql, d);
  if (!segs) return null;
  const items: string[] = [];
  for (const s of segs) {
    if (s.kind === 'code') for (const t of codeTokens(s.text, d)) items.push('c:' + t);
    else items.push((s.kind === 'lit' ? 'l:' : 'k:') + s.text);
  }
  return items;
}

const SEPS = [' ', ' ', ' ', '  ', '\t', '\n', '\r\n', '\n  ', ' \t '];
const SAFE_EMPTY_BLOCK = (l: string, r: string) =>
  !(WORDISH.test(l) && WORDISH.test(r)) &&
  !(/[+\-*/<>=~!@#%^&|?:.]/.test(l) && /[+\-*/<>=~!@#%^&|?:.]/.test(r)) &&
  !(l === '.' && /[0-9]/.test(r)) &&
  !(/[0-9]/.test(l) && r === '.');

/** Randomly changes the whitespace in code segments (never inside literals/comments). */
export function respace(sql: string, d: Driver, rand: () => number): string {
  const segs = scan(sql, d);
  if (!segs) return sql;
  let out = '';
  for (let k = 0; k < segs.length; k++) {
    const s = segs[k];
    if (s.kind !== 'code') {
      out += s.text;
      continue;
    }
    const afterLine = k > 0 && segs[k - 1].kind === 'comment' && /^(--|#)/.test(segs[k - 1].text);
    const parts = s.text.split(/([ \t\r\n\f\v]+)/);
    let acc = '';
    for (let p = 0; p < parts.length; p++) {
      const part = parts[p];
      if (p % 2 === 0) {
        acc += part;
        continue;
      }
      const left = acc.length > 0 ? acc[acc.length - 1] : (out[out.length - 1] ?? '');
      const right = parts[p + 1]?.[0] ?? segs[k + 1]?.text[0] ?? '';
      const needNl =
        (p === 1 && parts[0] === '' && afterLine) ||
        (p === parts.length - 2 &&
          parts[p + 1] === '' &&
          /^(--|#)/.test(segs[k + 1]?.text ?? '') &&
          false);
      if (needNl) acc += rand() < 0.5 ? '\n' : '\r\n';
      else if (
        rand() < 0.25 &&
        left &&
        right &&
        SAFE_EMPTY_BLOCK(left, right) &&
        !(p === 1 && parts[0] === '' && k > 0)
      )
        acc += '';
      else acc += SEPS[Math.floor(rand() * SEPS.length)];
    }
    out += acc;
  }
  return out;
}

type T = string;
interface Spec {
  atoms: Record<T, string[]>;
  binary: [T, T, string, T][]; // result, lhs, op, rhs
  unary: [T, string, T][];
  misc: ((a: (t: T) => string, rand: () => number) => string)[];
  tail: string;
}

const pgAtoms: Record<T, string[]> = {
  int: ['1', '2', '3', '42', '0', '7', '(5)', "length('ab  c')", '1000000', '9'],
  txt: [
    "'a  b'",
    "'it''s   x'",
    "E'a\\'  b'",
    "E'x\\ny'",
    "U&'d\\0061t  a'",
    '$$ p   q $$',
    '$t1$ a   b $t1$',
    "'m\n  n   \nx'",
    "'tab\there'",
    "'ünï  çode'",
    "'日本  語'",
    "'x'",
    "'abc'",
    "'--not a comment'",
    "'/* nor this */'",
    "'a''b'",
    "'\\'",
    "E'\\\\'",
    '$a$ x $b$ y $a$',
    "'  lead and trail  '",
    "'trail   \nz'",
  ],
  json: [
    '\'{"a":1,"b":[1,2,{"c":"x  y"}]}\'::jsonb',
    "'[1,2,3]'::jsonb",
    '\'{"a":"b"}\'::jsonb',
    "'{}'::jsonb",
  ],
  arr: ['ARRAY[1,2,3]', "'{1,2,3}'::int[]", 'ARRAY[1,2]', 'ARRAY[3]'],
  tarr: ["ARRAY['a','b']", "'{a,b}'::text[]", "ARRAY['a']", "'{a}'::text[]"],
  bit: ["B'101'", "X'4A'", "B'1'", "B'110'::bit(3)"],
  bool: ['true', 'false', '(1=1)'],
};
const pgSpec: Spec = {
  atoms: pgAtoms,
  binary: [
    ['int', 'int', '+', 'int'],
    ['int', 'int', '-', 'int'],
    ['int', 'int', '*', 'int'],
    ['int', 'int', '/', 'int'],
    ['int', 'int', '%', 'int'],
    ['int', 'int', '^', 'int'],
    ['int', 'int', '<<', 'int'],
    ['int', 'int', '>>', 'int'],
    ['int', 'int', '&', 'int'],
    ['int', 'int', '|', 'int'],
    ['int', 'int', '#', 'int'],
    ['bool', 'int', '<>', 'int'],
    ['bool', 'int', '!=', 'int'],
    ['bool', 'int', '<=', 'int'],
    ['bool', 'int', '>=', 'int'],
    ['bool', 'int', '<', 'int'],
    ['bool', 'int', '>', 'int'],
    ['bool', 'int', '=', 'int'],
    ['txt', 'txt', '||', 'txt'],
    ['bool', 'txt', '~', 'txt'],
    ['bool', 'txt', '!~', 'txt'],
    ['bool', 'txt', '~*', 'txt'],
    ['bool', 'txt', '!~*', 'txt'],
    ['bool', 'txt', '~~', 'txt'],
    ['bool', 'txt', '!~~', 'txt'],
    ['bool', 'txt', '~~*', 'txt'],
    ['bool', 'txt', '!~~*', 'txt'],
    ['bool', 'txt', '^@', 'txt'],
    ['bool', 'txt', 'LIKE', 'txt'],
    ['bool', 'txt', 'ILIKE', 'txt'],
    ['bool', 'txt', 'SIMILAR TO', 'txt'],
    ['bool', 'txt', '=', 'txt'],
    ['bool', 'txt', '<', 'txt'],
    ['json', 'json', '->', 'txt'],
    ['txt', 'json', '->>', 'txt'],
    ['json', 'json', '#>', 'tarr'],
    ['txt', 'json', '#>>', 'tarr'],
    ['bool', 'json', '@>', 'json'],
    ['bool', 'json', '<@', 'json'],
    ['bool', 'json', '?', 'txt'],
    ['bool', 'json', '?|', 'tarr'],
    ['bool', 'json', '?&', 'tarr'],
    ['json', 'json', '||', 'json'],
    ['json', 'json', '#-', 'tarr'],
    ['json', 'json', '-', 'txt'],
    ['json', 'json', '->', 'int'],
    ['txt', 'json', '->>', 'int'],
    ['bool', 'json', '@?', 'txt'],
    ['bool', 'json', '@@', 'txt'],
    ['bool', 'arr', '@>', 'arr'],
    ['bool', 'arr', '<@', 'arr'],
    ['bool', 'arr', '&&', 'arr'],
    ['arr', 'arr', '||', 'arr'],
    ['bit', 'bit', '&', 'bit'],
    ['bit', 'bit', '|', 'bit'],
    ['bit', 'bit', '#', 'bit'],
    ['bool', 'bit', '=', 'bit'],
    ['bool', 'bool', 'AND', 'bool'],
    ['bool', 'bool', 'OR', 'bool'],
    ['bool', 'bool', 'IS DISTINCT FROM', 'bool'],
  ],
  unary: [
    ['int', '-', 'int'],
    ['int', '+', 'int'],
    ['int', '~', 'int'],
    ['int', '@', 'int'],
    ['int', '|/', 'int'],
    ['int', '||/', 'int'],
    ['bool', 'NOT', 'bool'],
    ['bit', '~', 'bit'],
  ],
  misc: [
    (a) => `${a('arr')}[1]`,
    (a) => `${a('arr')}[1:2]`,
    (a) => `(${a('arr')})[ 1 ]`,
    (a) => `${a('int')}::text`,
    (a) => `${a('txt')}::varchar(10)`,
    (a) => `CAST(${a('int')} AS text)`,
    (a) => `CASE WHEN ${a('bool')} THEN ${a('int')} ELSE ${a('int')} END`,
    (a) => `${a('int')} BETWEEN ${a('int')} AND ${a('int')}`,
    (a) => `${a('int')} IN (${a('int')}, ${a('int')})`,
    (a) => `${a('txt')} IS NULL`,
    (a) => `coalesce(${a('txt')}, ${a('txt')})`,
    (a) => `count (*)`,
    (a) => `array_length(${a('arr')}, 1)`,
    (a) => `${a('int')} - -${a('int')}`,
    (a) => `${a('int')} + +${a('int')}`,
    (a) => `${a('int')} - - -${a('int')}`,
    (a) => `${a('int')} -${a('int')}`,
    (a) => `${a('int')}- ${a('int')}`,
    (a) => `${a('json')} -> 'a' ->> 0`,
    (a) => `${a('json')}#>'{b,2,c}'`,
    (a) => `${a('json')}#>>'{b,2,c}'`,
    (a) => `${a('arr')}@>${a('arr')}`,
    (a) => `${a('arr')}<@${a('arr')}`,
    (a) => `${a('json')}->'a'`,
    (a) => `${a('json')}?|ARRAY['a']`,
    (a) => `${a('json')}?&ARRAY['a']`,
    (a) => `${a('txt')}!~*${a('txt')}`,
    (a) => `${a('int')}<<${a('int')}`,
    (a) => `${a('int')}>>${a('int')}`,
    (a) => `${a('txt')}||${a('txt')}`,
    (a) => `@${a('int')}`,
    (a) => `|/${a('int')}`,
    (a) => `${a('int')}<-${a('int')}`,
    (a) => `${a('int')}>-${a('int')}`,
    (a) => `${a('int')}=-${a('int')}`,
    (a) => `${a('int')}*-${a('int')}`,
    (a) => `${a('int')}/-${a('int')}`,
    (a) => `${a('int')}+-${a('int')}`,
    (a) => `${a('int')}<@${a('int')}`,
    (a) => `${a('int')}@${a('int')}`,
    (a) => `${a('int')} . 5`,
    (a) => `U&'d\\0061t'`,
    (a) => `U & 'x'`,
    (a) => `E 'x'`,
    (a) => `${a('txt')} COLLATE "C"`,
    (a) => `${a('txt')} COLLATE "C" < 'b'`,
    (a) => `ROW(1,2) = ROW(1,2)`,
    (a) => `ARRAY[ARRAY[1,2],ARRAY[3,4]][1][2]`,
    (a) => `(SELECT ${a('int')})`,
    (a) => `${a('int')} IN (SELECT ${a('int')})`,
    (a) => `extract(year from now()) > 2000`,
    (a) => `1.e2`,
    (a) => `1 .e2`,
    (a) => `0xff`,
    (a) => `1_000`,
    (a) => `${a('int')}::int4`,
    (a) => `${a('int')} :: int`,
    (a) => `${a('arr')}[ 1 : 2 ]`,
    (a) => `${a('int')} OPERATOR(pg_catalog.+) ${a('int')}`,
    (a) => `$1`,
    (a) => `$1::int`,
  ],
  tail: '',
};

const myAtoms: Record<T, string[]> = {
  int: ['1', '2', '3', '42', '0', '7', '(5)', 'a', 't.a', '0x1F', '0b101', "length('ab  c')", '9'],
  txt: [
    "'a  b'",
    "'it''s   x'",
    "'x\\'   y'",
    '"d\\"  e"',
    '"dq  s"',
    "_utf8'ab  c'",
    "_binary'ab'",
    "N'z  z'",
    "_utf8mb4 'sp  ace'",
    "'m\n  n   \nx'",
    "'ünï  çode'",
    "'日本  語'",
    "'x'",
    "'abc'",
    "'--not a comment'",
    "'/* nor this */'",
    "'# nor this'",
    "'\\\\'",
    "'  lead and trail  '",
    "'trail   \nz'",
    's',
    't.s',
  ],
  bin: ["X'41'", "x'41'", "b'101'", '0x41', "B'1'"],
  json: ['j', 't.j', "JSON_OBJECT('a',1)", 'CAST(\'{"a":[1,2]}\' AS JSON)'],
  bool: ['true', 'false', '(1=1)', 'NULL'],
};
const mySpec: Spec = {
  atoms: myAtoms,
  binary: [
    ['int', 'int', '+', 'int'],
    ['int', 'int', '-', 'int'],
    ['int', 'int', '*', 'int'],
    ['int', 'int', '/', 'int'],
    ['int', 'int', 'DIV', 'int'],
    ['int', 'int', 'MOD', 'int'],
    ['int', 'int', '%', 'int'],
    ['int', 'int', '<<', 'int'],
    ['int', 'int', '>>', 'int'],
    ['int', 'int', '&', 'int'],
    ['int', 'int', '|', 'int'],
    ['int', 'int', '^', 'int'],
    ['bool', 'int', '<=>', 'int'],
    ['bool', 'int', '<>', 'int'],
    ['bool', 'int', '!=', 'int'],
    ['bool', 'int', '<=', 'int'],
    ['bool', 'int', '>=', 'int'],
    ['bool', 'int', '<', 'int'],
    ['bool', 'int', '>', 'int'],
    ['bool', 'int', '=', 'int'],
    ['bool', 'bool', '&&', 'bool'],
    ['bool', 'bool', '||', 'bool'],
    ['bool', 'bool', 'AND', 'bool'],
    ['bool', 'bool', 'OR', 'bool'],
    ['bool', 'bool', 'XOR', 'bool'],
    ['bool', 'txt', 'LIKE', 'txt'],
    ['bool', 'txt', 'NOT LIKE', 'txt'],
    ['bool', 'txt', 'REGEXP', 'txt'],
    ['bool', 'txt', 'RLIKE', 'txt'],
    ['bool', 'txt', '=', 'txt'],
    ['bool', 'txt', '<=>', 'txt'],
    ['bool', 'txt', 'SOUNDS LIKE', 'txt'],
    ['bin', 'bin', '&', 'bin'],
    ['bin', 'bin', '|', 'bin'],
    ['bin', 'bin', '^', 'bin'],
    ['bool', 'bin', '=', 'bin'],
    ['json', 'json', '->', "'$.a'"],
    ['txt', 'json', '->>', "'$.a'"],
    ['json', 'json', '->', "'$.a[0]'"],
    ['bool', 'txt', 'MEMBER OF', 'json'],
  ],
  unary: [
    ['int', '-', 'int'],
    ['int', '+', 'int'],
    ['int', '~', 'int'],
    ['int', '!', 'int'],
    ['bool', 'NOT', 'bool'],
    ['bool', '!', 'bool'],
    ['int', 'BINARY', 'txt'],
  ],
  misc: [
    (a) => `${a('int')} - -${a('int')}`,
    (a) => `${a('int')} + +${a('int')}`,
    (a) => `${a('int')} - - -${a('int')}`,
    (a) => `${a('int')} -${a('int')}`,
    (a) => `${a('int')}--${a('int')}`,
    (a) => `${a('int')}-- ${a('int')}\n+ 1`,
    (a) => `${a('int')} --${a('int')}\n`,
    (a) => `${a('int')}--\t${a('int')}\n`,
    (a) => `${a('int')}<-${a('int')}`,
    (a) => `${a('int')}>-${a('int')}`,
    (a) => `${a('int')}=-${a('int')}`,
    (a) => `${a('int')}*-${a('int')}`,
    (a) => `${a('int')}/-${a('int')}`,
    (a) => `${a('int')}+-${a('int')}`,
    (a) => `${a('int')}&&${a('int')}`,
    (a) => `${a('int')}<=>${a('int')}`,
    (a) => `${a('int')}<>${a('int')}`,
    (a) => `${a('int')}!=${a('int')}`,
    (a) => `${a('int')}<<${a('int')}`,
    (a) => `${a('int')}>>${a('int')}`,
    (a) => `@v := ${a('int')}`,
    (a) => `@v`,
    (a) => `@@sql_mode`,
    (a) => `@@global.max_connections > 0`,
    (a) => `@@session.sql_mode`,
    (a) => `@\`v w\``,
    (a) => `count (*)`,
    (a) => `count(*)`,
    (a) => `max (${a('int')})`,
    (a) => `abs (${a('int')})`,
    (a) => `concat (${a('txt')}, ${a('txt')})`,
    (a) => `IF (${a('bool')}, 1, 2)`,
    (a) => `IFNULL (${a('int')}, 2)`,
    (a) => `left (${a('txt')}, 1)`,
    (a) => `${a('int')} BETWEEN ${a('int')} AND ${a('int')}`,
    (a) => `${a('int')} IN (${a('int')}, ${a('int')})`,
    (a) => `${a('int')} IN(${a('int')},${a('int')})`,
    (a) => `CASE WHEN ${a('bool')} THEN ${a('int')} ELSE ${a('int')} END`,
    (a) => `CAST(${a('int')} AS CHAR)`,
    (a) => `CONVERT(${a('txt')} USING utf8mb4)`,
    (a) => `${a('txt')} COLLATE utf8mb4_bin`,
    (a) => `${a('txt')} COLLATE utf8mb4_bin = 'a'`,
    (a) => `/*! 1 */ ${a('int')}`,
    (a) => `/*!50000 ${a('int')} */ + 1`,
    (a) => `/*+ SET_VAR(sort_buffer_size=16M) */ ${a('int')}`,
    (a) => `/*M!100000 ${a('int')} */`,
    (a) => `${a('int')} # c  d\n + 1`,
    (a) => `${a('txt')}"x"`,
    (a) => `${a('txt')} 'x'`,
    (a) => `${a('txt')}'x'`,
    (a) => `'a' 'b'`,
    (a) => `_utf8 'x'`,
    (a) => `_utf8'x'`,
    (a) => `N 'x'`,
    (a) => `X '41'`,
    (a) => `x'41'`,
    (a) => `0x41`,
    (a) => `1e5`,
    (a) => `1.e5`,
    (a) => `1 .5`,
    (a) => `${a('int')} . 5`,
    (a) => `t . a`,
    (a) => `t. \`a\``,
    (a) => `\`t\`.\`a\``,
    (a) => `t.*`,
    (a) => `JSON_EXTRACT(${a('json')}, '$.a')`,
    (a) => `${a('json')}->'$.a'`,
    (a) => `${a('json')}->>'$.a'`,
    (a) => `${a('json')} -> '$.a'`,
    (a) => `(SELECT ${a('int')})`,
    (a) => `${a('int')} IN (SELECT ${a('int')})`,
    (a) => `date '2020-01-01'`,
    (a) => `INTERVAL ${a('int')} DAY`,
    (a) => `DATE_ADD('2020-01-01', INTERVAL 1 DAY)`,
    (a) => `?`,
    (a) => `:n`,
    (a) => `${a('int')}:=${a('int')}`,
  ],
  tail: " FROM (SELECT 1 AS a, 'x  y' AS s, CAST('{\"a\":[1,2]}' AS JSON) AS j) AS t",
};

const sqAtoms: Record<T, string[]> = {
  int: ['1', '2', '3', '42', '0', '7', '(5)', "length('ab  c')", '9', 'a', 't.a', '0x1F', '1_0'],
  txt: [
    "'a  b'",
    "'it''s   x'",
    '"dq  s"',
    "'m\n  n   \nx'",
    "'ünï  çode'",
    "'日本  語'",
    "'x'",
    "'abc'",
    "'--not a comment'",
    "'/* nor this */'",
    "'\\'",
    "'  lead and trail  '",
    "'trail   \nz'",
    's',
    '[s]',
    '`s`',
  ],
  blob: ["X'41'", "x'41'", "X'4142'"],
  json: ['\'{"a":[1,2,{"b":"x  y"}]}\'', "'[1,2,3]'", '\'{"a":1}\''],
  bool: ['1', '0', '(1=1)', 'NULL'],
};
const sqSpec: Spec = {
  atoms: sqAtoms,
  binary: [
    ['int', 'int', '+', 'int'],
    ['int', 'int', '-', 'int'],
    ['int', 'int', '*', 'int'],
    ['int', 'int', '/', 'int'],
    ['int', 'int', '%', 'int'],
    ['int', 'int', '<<', 'int'],
    ['int', 'int', '>>', 'int'],
    ['int', 'int', '&', 'int'],
    ['int', 'int', '|', 'int'],
    ['bool', 'int', '<>', 'int'],
    ['bool', 'int', '!=', 'int'],
    ['bool', 'int', '<=', 'int'],
    ['bool', 'int', '>=', 'int'],
    ['bool', 'int', '<', 'int'],
    ['bool', 'int', '>', 'int'],
    ['bool', 'int', '=', 'int'],
    ['bool', 'int', '==', 'int'],
    ['bool', 'int', 'IS', 'int'],
    ['bool', 'int', 'IS NOT', 'int'],
    ['txt', 'txt', '||', 'txt'],
    ['bool', 'txt', 'LIKE', 'txt'],
    ['bool', 'txt', 'GLOB', 'txt'],
    ['bool', 'txt', 'NOT LIKE', 'txt'],
    ['bool', 'txt', '=', 'txt'],
    ['bool', 'bool', 'AND', 'bool'],
    ['bool', 'bool', 'OR', 'bool'],
    ['json', 'json', '->', "'$.a'"],
    ['txt', 'json', '->>', "'$.a'"],
    ['json', 'json', '->', "'$[0]'"],
    ['txt', 'json', '->>', "'$[1]'"],
    ['bool', 'blob', '=', 'blob'],
    ['txt', 'txt', '||', 'blob'],
  ],
  unary: [
    ['int', '-', 'int'],
    ['int', '+', 'int'],
    ['int', '~', 'int'],
    ['bool', 'NOT', 'bool'],
  ],
  misc: [
    (a) => `${a('int')} - -${a('int')}`,
    (a) => `${a('int')} + +${a('int')}`,
    (a) => `${a('int')} - - -${a('int')}`,
    (a) => `${a('int')} -${a('int')}`,
    (a) => `${a('int')}--${a('int')}\n+ 1`,
    (a) => `${a('int')} --${a('int')}\n`,
    (a) => `${a('int')}<-${a('int')}`,
    (a) => `${a('int')}>-${a('int')}`,
    (a) => `${a('int')}=-${a('int')}`,
    (a) => `${a('int')}*-${a('int')}`,
    (a) => `${a('int')}/-${a('int')}`,
    (a) => `${a('int')}+-${a('int')}`,
    (a) => `${a('int')}||${a('int')}`,
    (a) => `${a('int')}<<${a('int')}`,
    (a) => `${a('int')}>>${a('int')}`,
    (a) => `count (*)`,
    (a) => `count(*)`,
    (a) => `max (${a('int')})`,
    (a) => `abs (${a('int')})`,
    (a) => `${a('int')} BETWEEN ${a('int')} AND ${a('int')}`,
    (a) => `${a('int')} IN (${a('int')}, ${a('int')})`,
    (a) => `${a('int')} IN(${a('int')},${a('int')})`,
    (a) => `CASE WHEN ${a('bool')} THEN ${a('int')} ELSE ${a('int')} END`,
    (a) => `CAST(${a('int')} AS TEXT)`,
    (a) => `${a('txt')} COLLATE NOCASE`,
    (a) => `${a('txt')} COLLATE NOCASE = 'A'`,
    (a) => `${a('int')} # 1`,
    (a) => `x'41'`,
    (a) => `X 'x'`,
    (a) => `1e5`,
    (a) => `1.e5`,
    (a) => `1 .5`,
    (a) => `t . a`,
    (a) => `t. [a]`,
    (a) => `t.*`,
    (a) => `?`,
    (a) => `?1`,
    (a) => `:n`,
    (a) => `@v`,
    (a) => `$v`,
    (a) => `${a('int')}:n`,
    (a) => `json_extract(${a('json')}, '$.a')`,
    (a) => `(SELECT ${a('int')})`,
    (a) => `${a('int')} IN (SELECT ${a('int')})`,
    (a) => `${a('int')} NOTNULL`,
    (a) => `${a('int')} ISNULL`,
    (a) => `${a('int')} ISNULL`,
    (a) => `/*+ x */ ${a('int')}`,
    (a) => `${a('int')} /* c */ + 1`,
    (a) => `${a('txt')} AS [s  t]`,
    (a) => `${a('txt')} AS "q  r"`,
    (a) => `${a('txt')} AS \`b  c\``,
  ],
  tail: " FROM (SELECT 1 AS a, 'x  y' AS s) AS t",
};

const SPECS: Record<Driver, Spec> = { postgresql: pgSpec, mysql: mySpec, sqlite: sqSpec };

function gen(d: Driver, rand: () => number): string {
  const spec = SPECS[d];
  const pick = <U>(arr: U[]): U => arr[Math.floor(rand() * arr.length)];
  const types = Object.keys(spec.atoms);
  const atom = (t: T): string => (spec.atoms[t] ? pick(spec.atoms[t]) : t);
  const expr = (t: T, depth: number): string => {
    if (!spec.atoms[t]) return t; // literal operand text such as a JSON path
    if (depth <= 0 || rand() < 0.35) return atom(t);
    const r = rand();
    if (r < 0.6) {
      const forms = spec.binary.filter((b) => b[0] === t);
      if (forms.length) {
        const [, l, op, rr] = pick(forms);
        return wrap(`${expr(l, depth - 1)}${sep()}${op}${sep()}${expr(rr, depth - 1)}`);
      }
    } else if (r < 0.75) {
      const forms = spec.unary.filter((u) => u[0] === t);
      if (forms.length) {
        const [, op, x] = pick(forms);
        return wrap(`${op}${rand() < 0.5 ? '' : ' '}${expr(x, depth - 1)}`);
      }
    }
    return atom(t);
  };
  const wrap = (s: string) => (rand() < 0.4 ? `(${s})` : s);
  const sep = () =>
    pick([
      '',
      ' ',
      ' ',
      ' ',
      '  ',
      '\t',
      '\n',
      '\r\n',
      ' /* c  d */ ',
      '\n-- c  d\n',
      ' /* /* n */ */ ',
    ]);
  const bad = () => (rand() < 0.0 ? '' : '');
  void bad;
  const one = (): string => {
    if (rand() < 0.35) return pick(spec.misc)((t) => expr(t, 1), rand);
    const t = pick(types);
    return expr(t, 2 + Math.floor(rand() * 2));
  };
  // Operators are never separated by the safe separators above where a '' would merge words: keywords need a separator.
  const fixKeywords = (s: string) =>
    s.replace(
      /([A-Za-z0-9_'")\]])(AND|OR|XOR|DIV|MOD|IS|LIKE|REGEXP|RLIKE|GLOB|ILIKE|NOT|SIMILAR|SOUNDS|MEMBER)(?=[A-Za-z0-9_'"(\[])/g,
      '$1 $2 ',
    );
  const cols = 1 + Math.floor(rand() * 2);
  const list: string[] = [];
  for (let c = 0; c < cols; c++) list.push(fixKeywords(one()));
  let sql =
    'SELECT' + pick([' ', ' ', '  ', '\n', '\t']) + list.join(pick([', ', ',', ' ,\n', ' , ']));
  const form = rand();
  if (form < 0.15) sql += pick(['', ' ']) + 'WHERE ' + fixKeywords(expr('bool', 2));
  else if (form < 0.22) sql = `SELECT (${sql.slice(7)})`;
  sql += spec.tail && !/FROM/.test(sql) && d !== 'sqlite' && d !== 'mysql' ? '' : '';
  if (spec.tail && /\b(a|s|j|t\.)/.test('')) sql += '';
  return sql;
}

/** Statements for a dialect. Column references (a, s, j, t.*) need the FROM tail; added when the statement mentions them. */
export function generate(d: Driver, count: number, seed: number): string[] {
  const rand = rng(seed);
  const spec = SPECS[d];
  const out: string[] = [];
  const ends = [
    '',
    '',
    '',
    ' ',
    ';',
    '\n',
    '\r\n',
    ' -- tail  x',
    '\n-- tail  x',
    '  -- no newline',
  ];
  for (let n = 0; n < count; n++) {
    let sql = gen(d, rand);
    if (
      spec.tail &&
      /(?:^|[^A-Za-z0-9_'"$:@])(?:a|s|j|t)(?![A-Za-z0-9_'"(])/.test(stripLits(sql, d))
    ) {
      // insert the FROM tail before WHERE or at the end (before any trailing comment piece below)
      const wi = sql.search(/\sWHERE /);
      sql = wi >= 0 ? sql.slice(0, wi) + spec.tail + sql.slice(wi) : sql + spec.tail;
    }
    // Balanced guard: a "--" inside generated code may swallow the tail; that is fine (still a valid test).
    sql += ends[Math.floor(rand() * ends.length)];
    out.push(sql);
  }
  return out;
}
function stripLits(sql: string, d: Driver): string {
  const segs = scan(sql, d);
  if (!segs) return sql;
  return segs.map((s) => (s.kind === 'code' ? s.text : ' ')).join('');
}

export const DOC_EXAMPLES: Record<Driver, string[]> = {
  sqlite: [
    "SELECT 'abc' || 'def'",
    "SELECT length('hello  world')",
    "SELECT substr('hello', 2, 3)",
    "SELECT typeof(1), typeof(1.0), typeof('a'), typeof(NULL), typeof(x'00')",
    "SELECT json_extract('{\"a\":[1,2]}', '$.a[1]')",
    "SELECT '{\"a\":[1,2]}' -> '$.a' ->> 1",
    "SELECT CASE 1 WHEN 1 THEN 'one' ELSE 'other' END",
    "SELECT 1 WHERE 'a' IN ('a','b')",
    'SELECT abs(-5), max(1,2,3), min(1,2,3)',
    'SELECT * FROM (VALUES (1),(2),(3))',
    'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<5) SELECT x FROM c',
    "SELECT 'a' GLOB 'a*', 'abc' LIKE 'A%'",
    'SELECT 1 /* inline */ + 2 -- trailing',
    "SELECT hex(x'DEADBEEF'), quote('it''s')",
    "SELECT replace('abc  def', '  ', ' ')",
    'SELECT 5 - -3, 5 - +3, 5-3',
    'SELECT 1 FROM (SELECT 1) AS "x  y" WHERE "x  y"."1" = 1',
    "SELECT group_concat(x, ', ') FROM (VALUES (1),(2)) AS t(x)",
    "SELECT date('2020-01-01', '+1 day')",
    'SELECT 7 % 4, 7 << 1, 7 >> 1, 7 & 3, 7 | 8, ~7',
  ],
  mysql: [
    "SELECT CONCAT('a', 'b'), LENGTH('hello  world')",
    'SELECT 1 + 1, 2 * 3, 7 DIV 2, 7 MOD 3',
    'SELECT /*! 1 */ 2',
    'SELECT /*!50000 1 */ + 2',
    'SELECT /*+ MAX_EXECUTION_TIME(1000) */ 1',
    "SELECT 'a\\'b', \"c\\\"d\", 'e''f', 'g\\\\'",
    "SELECT _utf8mb4'abc', _binary'abc', N'abc', X'41', 0x41, b'101', 0b101",
    'SELECT @a := 1, @a + 1',
    "SELECT @@version > '1'",
    "SELECT JSON_OBJECT('a', 1), JSON_ARRAY(1, 2)",
    "SELECT CAST('{\"a\":1}' AS JSON) -> '$.a'",
    'SELECT 1 # comment  here\n+ 2',
    'SELECT 1 -- comment  here\n+ 2',
    'SELECT 1 /* c */ + /* d */ 2',
    "SELECT IF(1 > 0, 'yes', 'no'), IFNULL(NULL, 'x'), COALESCE(NULL, 1)",
    "SELECT 'abc' REGEXP '^a', 'abc' LIKE 'a%', 'abc' RLIKE 'b'",
    'SELECT 1 <=> NULL, NULL <=> NULL, 1 != 2, 1 <> 2',
    'SELECT 5 - -3, 5 - +3, 5-3, 5 --3',
    "SELECT DATE_ADD('2020-01-01', INTERVAL 1 DAY), DATE '2020-01-01'",
    'SELECT `a b` FROM (SELECT 1 AS `a b`) AS `t  u`',
    'SELECT 1 FROM DUAL WHERE 1 BETWEEN 0 AND 2',
    'SELECT 2 ^ 3, 2 << 3, 16 >> 2, 5 & 3, 5 | 2, ~5, !1',
    "SELECT 'a' 'b'",
    'SELECT * FROM (SELECT 1 AS x UNION ALL SELECT 2) t ORDER BY x DESC LIMIT 1 OFFSET 0',
    'SELECT COUNT (*) FROM (SELECT 1) t',
    'SELECT COUNT(*) FROM (SELECT 1) t',
    'SELECT 1 IN (1,2), 1 NOT IN (3,4)',
    "SELECT 'a' COLLATE utf8mb4_bin",
    "SELECT 'x'\n'y'",
    "SELECT 0x41 + 0, x'41' + 0",
  ],
  postgresql: [
    "SELECT 'a'||'b', length('hello  world')",
    "SELECT E'a\\nb', E'tab\\there', E'q\\'q'",
    "SELECT U&'d\\0061t\\+000061', U&'!0061' UESCAPE '!'",
    "SELECT B'101', X'4A', B'1' || B'0'",
    "SELECT $$it's  a  string$$, $tag$ a $$ b $tag$, $a1$ x $a1$",
    'SELECT \'{"a":1}\'::jsonb @> \'{"a":1}\', \'{"a":1}\'::jsonb <@ \'{"a":1,"b":2}\'',
    'SELECT \'{"a":{"b":[1,2]}}\'::jsonb #> \'{a,b}\', \'{"a":{"b":[1,2]}}\'::jsonb #>> \'{a,b,0}\'',
    "SELECT '{\"a\":1}'::jsonb ? 'a', '{\"a\":1}'::jsonb ?| ARRAY['a','b'], '{\"a\":1}'::jsonb ?& ARRAY['a']",
    "SELECT '{\"a\":1}'::jsonb -> 'a', '{\"a\":1}'::jsonb ->> 'a', '[1,2]'::jsonb -> 0",
    "SELECT '{\"a\":1}'::jsonb || '{\"b\":2}'::jsonb, '{\"a\":1}'::jsonb #- '{a}'",
    "SELECT 'abc' ~ 'b', 'abc' !~ 'b', 'ABC' ~* 'b', 'ABC' !~* 'b'",
    "SELECT 'abc' ~~ 'a%', 'abc' !~~ 'a%', 'abc' ~~* 'A%', 'abc' ^@ 'a'",
    'SELECT 1 << 2, 8 >> 1, 5 & 3, 5 | 2, 5 # 1, ~5, @ -5, |/ 4, ||/ 8',
    'SELECT ARRAY[1,2,3] @> ARRAY[1], ARRAY[1] <@ ARRAY[1,2], ARRAY[1,2] && ARRAY[2,3]',
    'SELECT (ARRAY[1,2,3])[2], (ARRAY[1,2,3])[2:3], (ARRAY[1,2,3])[ 2 : 3 ]',
    "SELECT 1::int, '1'::text, CAST(1 AS bigint), 1 :: int",
    'SELECT /* nested /* comment */ still */ 1',
    "SELECT /* a ' b */ 'x  y' /* c */",
    'SELECT 1 -- trailing  comment',
    'SELECT 5 - -3, 5 - +3, 5-3, 5 - - 3',
    'SELECT $1',
    'SELECT \'a\' COLLATE "C"',
    "SELECT 'x'\n'y'",
    'SELECT 1 FROM (VALUES (1)) AS "t  u"("c  d")',
    "SELECT CASE WHEN 1=1 THEN 'a' ELSE 'b' END",
    'SELECT * FROM generate_series(1, 3) AS g(x) WHERE x > 1 ORDER BY x DESC',
    'SELECT count (*) FROM generate_series(1,3)',
    "SELECT extract(year FROM timestamp '2020-01-01')",
    'SELECT 1 OPERATOR(pg_catalog.+) 2',
    "SELECT '1'::int4, '2020-01-01'::date, interval '1 day'",
    'SELECT 10 -:n',
    'SELECT 1.5e3, .5, 5., 1_000, 0xff, 0b11, 0o17',
  ],
};
