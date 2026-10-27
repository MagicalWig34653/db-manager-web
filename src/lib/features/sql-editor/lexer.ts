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

const WORD_START = /[A-Za-z_\u0080-￿@$#]/;
const WORD_PART = /[A-Za-z0-9_\u0080-￿@$#]/;
const OPERATOR_CHARS = '+-*/%<>=!|&^~:?';

/** Returns null if a string, quoted identifier or block comment is not terminated (not safe to touch). */
export function tokenize(sql: string, driver: Driver): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  const push = (kind: TokenKind, start: number, end: number) =>
    tokens.push({ kind, text: sql.slice(start, end), start, end });
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    const start = i;
    if (/\s/.test(c)) {
      while (i < sql.length && /\s/.test(sql[i])) i++;
      push('space', start, i);
    } else if ((c === '-' && next === '-') || (c === '#' && driver === 'mysql')) {
      while (i < sql.length && sql[i] !== '\n') i++;
      push('line-comment', start, i);
    } else if (c === '/' && next === '*') {
      const close = sql.indexOf('*/', i + 2);
      if (close < 0) return null;
      i = close + 2;
      push('block-comment', start, i);
    } else if (c === "'" || c === '"' || c === '`') {
      const backslash = driver === 'mysql';
      i++;
      let closed = false;
      while (i < sql.length) {
        if (backslash && sql[i] === '\\' && c !== '`') i += 2;
        else if (sql[i] === c && sql[i + 1] === c) i += 2;
        else if (sql[i] === c) {
          i++;
          closed = true;
          break;
        } else i++;
      }
      if (!closed) return null;
      push(c === "'" ? 'string' : 'quoted-identifier', start, i);
    } else if (c === '[' && driver === 'sqlite') {
      const close = sql.indexOf(']', i + 1);
      if (close < 0) return null;
      i = close + 1;
      push('quoted-identifier', start, i);
    } else if (c === '$' && driver === 'postgresql') {
      const tag = /^\$[A-Za-z_\u0080-￿]*\$/.exec(sql.slice(i));
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
      const match = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(sql.slice(i));
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
    } else if (WORD_START.test(c)) {
      i++;
      while (i < sql.length && WORD_PART.test(sql[i])) i++;
      push('word', start, i);
    } else if (OPERATOR_CHARS.includes(c)) {
      i++;
      if (c === ':') {
        // "::" (cast) and ":=" (assignment) are two-character operators; a lone colon is a single token.
        if (next === ':' || next === '=') i++;
      } else {
        while (i < sql.length && OPERATOR_CHARS.includes(sql[i]) && sql[i] !== ':') {
          // Operator runs stay together unless a comment starts.
          if (sql[i] === '-' && sql[i + 1] === '-') break;
          if (sql[i] === '/' && sql[i + 1] === '*') break;
          i++;
        }
      }
      push('operator', start, i);
    } else {
      i++;
      push('punct', start, i);
    }
  }
  return tokens;
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
