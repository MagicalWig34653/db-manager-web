// SPDX-License-Identifier: AGPL-3.0-only
// Small, lossless SQL lexer shared by the formatter and the :name placeholder finder.
// It never validates SQL; it only separates strings, comments and quoted identifiers from code
// so that neither formatting nor placeholder substitution can touch them.
import type { Driver } from '$lib/workbench';

export type TokenKind =
  | 'space'
  | 'line-comment'
  | 'block-comment'
  | 'string'
  | 'quoted-identifier'
  | 'dollar-string'
  | 'word'
  | 'number'
  | 'param'
  | 'operator'
  | 'punct';

export interface Token {
  kind: TokenKind;
  text: string;
  start: number;
  end: number;
}

// Only these are separators; U+000B and every other character stay ordinary (non-space) characters.
const SPACE = /[ \t\r\n\f]/;
const WORD_START_BASE = /[A-Za-z_\u0080-\uffff$]/;
const WORD_PART = /[A-Za-z0-9_\u0080-\uffff$]/;
// Characters of multi-character operators. A run of them is ONE token (@>, #>>, <@, ->>, ||, <=>, !=).
// '#' is a comment in MySQL and '@' starts a variable/parameter in MySQL and SQLite, so they are not operator characters there.
function operatorChars(driver: Driver): string {
  return driver === 'postgresql'
    ? '+-*/<>=~!@#%^&|?'
    : '+-*/<>=~!%^&|' + (driver === 'sqlite' ? '?' : '');
}
const startsWord = (c: string, driver: Driver) =>
  WORD_START_BASE.test(c) || (c === '@' && driver !== 'postgresql');

/** Returns null if a string, quoted identifier or block comment is not terminated (not safe to touch). */
export function tokenize(sql: string, driver: Driver): Token[] | null {
  const tokens: Token[] = [];
  const operators = operatorChars(driver);
  let i = 0;
  const push = (kind: TokenKind, start: number, end: number) =>
    tokens.push({ kind, text: sql.slice(start, end), start, end });
  // Reads a quoted run starting at the opening quote at index `from`; returns the end or -1 when unterminated.
  const quoted = (from: number, backslash: boolean): number => {
    const quote = sql[from];
    let j = from + 1;
    while (j < sql.length) {
      if (backslash && sql[j] === '\\') j += 2;
      else if (sql[j] === quote && sql[j + 1] === quote) j += 2;
      else if (sql[j] === quote) return j + 1;
      else j++;
    }
    return -1;
  };
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    const start = i;
    if (SPACE.test(c)) {
      while (i < sql.length && SPACE.test(sql[i])) i++;
      push('space', start, i);
    } else if (isLineComment(sql, i, driver)) {
      while (i < sql.length && sql[i] !== '\n') i++;
      push('line-comment', start, i);
    } else if (c === '/' && next === '*') {
      // PostgreSQL block comments nest; MySQL and SQLite end at the first "*/".
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--;
          i += 2;
        } else if (driver === 'postgresql' && sql[i] === '/' && sql[i + 1] === '*') {
          depth++;
          i += 2;
        } else i++;
      }
      if (depth > 0) return null;
      push('block-comment', start, i);
    } else if (c === "'" || c === '"' || c === '`') {
      const end = quoted(i, driver === 'mysql' && c !== '`');
      if (end < 0) return null;
      i = end;
      push(c === "'" ? 'string' : 'quoted-identifier', start, i);
    } else if (c === '[' && driver === 'sqlite') {
      const close = sql.indexOf(']', i + 1);
      if (close < 0) return null;
      i = close + 1;
      push('quoted-identifier', start, i);
    } else if (c === '$' && driver === 'postgresql') {
      const tag = /^\$(?:[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$/.exec(
        sql.slice(i, i + 200),
      );
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        if (close < 0) return null;
        i = close + tag[0].length;
        push('dollar-string', start, i);
      } else {
        i++;
        while (i < sql.length && WORD_PART.test(sql[i])) i++;
        push('word', start, i);
      }
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(next ?? ''))) {
      const match = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(sql.slice(i, i + 400));
      i += match ? match[0].length : 1;
      // Letters directly after digits (1abc, 0xFF) belong to one token.
      while (i < sql.length && WORD_PART.test(sql[i])) i++;
      push('number', start, i);
    } else if (
      c === ':' &&
      next !== undefined &&
      /[A-Za-z_]/.test(next) &&
      !isAttached(sql, start)
    ) {
      i++;
      while (i < sql.length && /[A-Za-z0-9_]/.test(sql[i])) i++;
      push('param', start, i);
    } else if (startsWord(c, driver)) {
      i++;
      while (i < sql.length && (WORD_PART.test(sql[i]) || (sql[i] === '@' && driver === 'mysql')))
        i++;
      const word = sql.slice(start, i);
      // Literal prefixes are part of the literal: E'..' B'..' X'..' N'..' U&'..' (and U&"..").
      const unicode =
        /^[Uu]$/.test(word) && sql[i] === '&' && (sql[i + 1] === "'" || sql[i + 1] === '"');
      const prefixed = unicode || (/^[EeBbXxNn]$/.test(word) && sql[i] === "'");
      if (prefixed) {
        const quoteAt = unicode ? i + 1 : i;
        const q = sql[quoteAt];
        const end = quoted(
          quoteAt,
          (driver === 'postgresql' && /^[Ee]$/.test(word)) || (driver === 'mysql' && q !== '`'),
        );
        if (end < 0) return null;
        i = end;
        push(q === "'" ? 'string' : 'quoted-identifier', start, i);
      } else push('word', start, i);
    } else if (c === '?' && driver !== 'postgresql' && /[0-9]/.test(next ?? '')) {
      // SQLite ?NNN / MySQL-style numbered parameter: one token.
      i++;
      while (i < sql.length && /[0-9]/.test(sql[i])) i++;
      push('param', start, i);
    } else if (c === ':') {
      // "::" (cast) and ":=" (assignment) are two-character operators; a lone colon is a single token.
      i += next === ':' || next === '=' ? 2 : 1;
      push('operator', start, i);
    } else if (operators.includes(c)) {
      i++;
      // Operator runs stay together unless a comment starts.
      while (i < sql.length && operators.includes(sql[i])) {
        if (sql[i] === '-' && isLineComment(sql, i, driver)) break;
        if (sql[i] === '/' && sql[i + 1] === '*') break;
        i++;
      }
      push('operator', start, i);
    } else {
      i++;
      push('punct', start, i);
    }
  }
  return tokens;
}

// MySQL and MariaDB start a "--" comment only when whitespace or a control character follows (or the text ends).
function isLineComment(sql: string, i: number, driver: Driver): boolean {
  if (sql[i] === '#') return driver === 'mysql';
  if (sql[i] !== '-' || sql[i + 1] !== '-') return false;
  if (driver !== 'mysql') return true;
  const after = sql[i + 2];
  return after === undefined || /[\u0000-\u0020\u007f]/.test(after);
}

// "a:b", "x[1:n]" and "f(1):x" are not placeholders: a colon glued to the previous code character is left alone.
function isAttached(sql: string, index: number): boolean {
  return index > 0 && /[A-Za-z0-9_\])"'`:]/.test(sql[index - 1]);
}

/** Non-space, non-comment token texts; used to prove the formatter changed whitespace only. */
export function significantTexts(tokens: Token[]): string[] {
  return tokens
    .filter((token) => token.kind !== 'space' && token.kind !== 'line-comment')
    .map((token) => token.text);
}
