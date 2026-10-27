// SPDX-License-Identifier: AGPL-3.0-only
// Conservative SQL formatter. It only changes whitespace between tokens: keyword case, strings, comments,
// quoted identifiers and the order of tokens are never touched. Statements it cannot format safely
// (unterminated literals, procedural bodies, DELIMITER scripts) make it return null instead of guessing.
import type { Driver } from '$lib/workbench';
import { tokenize, type Token } from './lexer';

const INDENT = '  ';
const CLAUSES = new Set([
  'select',
  'from',
  'where',
  'having',
  'limit',
  'offset',
  'values',
  'set',
  'returning',
  'union',
  'intersect',
  'except',
  'window',
]);
const JOIN_PREFIX = new Set(['left', 'right', 'inner', 'full', 'cross', 'natural', 'join']);
const PROCEDURAL = new Set([
  'begin',
  'delimiter',
  'declare',
  'function',
  'procedure',
  'trigger',
  'do',
  'event',
  'loop',
]);
// Words after which "(" is not a function call (so a space is kept before it).
const SPACE_BEFORE_PAREN = new Set([
  'in',
  'not',
  'and',
  'or',
  'as',
  'on',
  'using',
  'values',
  'from',
  'join',
  'where',
  'select',
  'exists',
  'any',
  'all',
  'some',
  'when',
  'then',
  'else',
  'case',
  'union',
  'intersect',
  'except',
  'by',
  'like',
  'between',
  'is',
  'set',
  'into',
  'having',
  'distinct',
  'with',
  'table',
  'over',
  'returning',
]);
// Words after which "+"/"-" are unary (no space after the sign).
const UNARY_AFTER = new Set([
  'select',
  'where',
  'and',
  'or',
  'not',
  'in',
  'when',
  'then',
  'else',
  'by',
  'on',
  'values',
  'set',
  'limit',
  'offset',
  'between',
]);

const lower = (token: Token | undefined) => token?.text.toLowerCase() ?? '';

interface Frame {
  subquery: boolean;
  indent: number;
}

export const MAX_FORMAT_LENGTH = 100_000;
const MAX_FORMAT_DEPTH = 40;
const OPERATOR_GLYPHS = new Set('+-*/<>=~!@#%^&|?:'.split(''));
const WORDISH = /[A-Za-z0-9_$\u0080-\uffff]/;
const WHITESPACE_ONLY = /^[ \t\r\n\f\v]*$/;
const strip = (text: string) => text.replace(/[ \t\r\n\f\v]+/g, '');

/**
 * Returns the formatted statement text, or null when the input cannot be formatted safely.
 * Only whitespace between tokens is changed; the result is verified (whitespace-free text equal, token sequence
 * equal after lexing again) and discarded in case of any doubt.
 */
export function formatSql(sql: string, driver: Driver): string | null {
  if (sql.length > MAX_FORMAT_LENGTH) return null;
  const all = tokenize(sql, driver);
  if (!all) return null;
  const tokens = all.filter((token) => token.kind !== 'space');
  if (tokens.length === 0) return sql;
  if (tokens.some((token) => token.kind === 'word' && PROCEDURAL.has(lower(token)))) return null;

  const parts: string[] = [];
  let lineStart = true;
  let lastText = '';
  let clause = '';
  let breakAfterSelect = false;
  const stack: Frame[] = [];
  const dropWhitespace = () => {
    while (parts.length > 0 && WHITESPACE_ONLY.test(parts[parts.length - 1])) parts.pop();
  };
  const newline = (level: number, blank = false) => {
    dropWhitespace();
    parts.push((blank ? '\n\n' : '\n') + INDENT.repeat(Math.max(level, 0)));
    lineStart = true;
  };
  const append = (text: string, wantSpace: boolean) => {
    let space = wantSpace;
    if (!lineStart && !space && lastText) {
      const left = lastText[lastText.length - 1];
      const right = text[0];
      // Never let two separate tokens run together into another token ("- -" into "--", "<" "@", words).
      if (
        (OPERATOR_GLYPHS.has(left) && OPERATOR_GLYPHS.has(right)) ||
        (WORDISH.test(left) && WORDISH.test(right))
      )
        space = true;
    }
    if (!lineStart && space) parts.push(' ');
    parts.push(text);
    lastText = text;
    lineStart = false;
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const previous = tokens[i - 1];
    const word = token.kind === 'word' ? lower(token) : '';
    const nextWord = tokens[i + 1]?.kind === 'word' ? lower(tokens[i + 1]) : '';
    const top = stack[stack.length - 1];
    const base = top ? top.indent : 0;
    const clauseLevel = !top || top.subquery;

    if (token.kind === 'line-comment' || token.kind === 'block-comment') {
      // Own-line comments stay on their own line; trailing comments stay behind their code.
      const ownLine = !previous || sql.slice(previous.end, token.start).includes('\n');
      if (ownLine && !lineStart) newline(base + (clause === 'select' ? 1 : 0));
      append(token.text, true);
      if (token.kind === 'line-comment') newline(base + (clause === 'select' ? 1 : 0));
      continue;
    }

    if (breakAfterSelect && word !== 'distinct' && word !== 'all') {
      breakAfterSelect = false;
      newline(base + 1);
    }

    if (clauseLevel && token.kind === 'word') {
      const startsBlock = !previous || previous.text === ';' || previous.text === '(';
      if (CLAUSES.has(word)) {
        if (!startsBlock) newline(base);
        clause = word;
        if (word === 'select' && hasTopLevelComma(tokens, i)) breakAfterSelect = true;
      } else if ((word === 'order' || word === 'group') && nextWord === 'by') {
        if (!lineStart) newline(base);
        clause = word;
      } else if (JOIN_PREFIX.has(word) && !JOIN_PREFIX.has(lower(previous))) {
        if (!lineStart) newline(base);
        clause = 'join';
      } else if (word === 'on' && clause === 'join') {
        newline(base + 1);
        clause = 'on';
      } else if (
        (word === 'and' || word === 'or') &&
        (clause === 'where' || clause === 'on' || clause === 'having') &&
        !isBetweenAnd(tokens, i)
      ) {
        newline(base + 1);
      }
    }

    if (token.text === ',' && clauseLevel && (clause === 'select' || clause === 'set')) {
      append(',', false);
      newline(base + 1);
      continue;
    }
    if (token.text === ';') {
      append(';', false);
      stack.length = 0;
      clause = '';
      if (i < tokens.length - 1) newline(0, true);
      continue;
    }
    if (token.text === '(') {
      const subquery = nextWord === 'select' || nextWord === 'with';
      append('(', !lineStart && spaceBeforeParen(tokens, i));
      stack.push({ subquery, indent: base + (subquery ? 1 : 0) });
      if (stack.length > MAX_FORMAT_DEPTH) return null;
      if (subquery) newline(base + 1);
      continue;
    }
    if (token.text === ')') {
      const frame = stack.pop();
      if (frame?.subquery) newline(stack[stack.length - 1]?.indent ?? 0);
      append(')', false);
      continue;
    }
    append(token.text, spaceBetween(tokens, i, sql));
  }
  dropWhitespace();
  const out = parts.join('').replace(/^[ \t\r\n\f\v]+/, '');
  // Independent safety net: only whitespace may differ, and the token sequence must survive a new lexing pass.
  if (strip(out) !== strip(sql)) return null;
  const again = tokenize(out, driver);
  if (!again) return null;
  const kept = again.filter((token) => token.kind !== 'space');
  if (kept.length !== tokens.length) return null;
  for (let k = 0; k < kept.length; k++)
    if (kept[k].kind !== tokens[k].kind || kept[k].text !== tokens[k].text) return null;
  return out;
}

const LITERALS = new Set(['string', 'quoted-identifier', 'dollar-string']);
function spaceBetween(tokens: Token[], i: number, sql: string): boolean {
  const token = tokens[i];
  const previous = tokens[i - 1];
  if (!previous) return false;
  // A word glued to a literal in the input (_utf8'x') stays glued: a prefix must not become an alias.
  if (
    previous.end === token.start &&
    ((previous.kind === 'word' && LITERALS.has(token.kind)) ||
      (LITERALS.has(previous.kind) && token.kind === 'word'))
  )
    return false;
  void sql;
  if ([',', '.', '[', ']'].includes(token.text) && token.kind !== 'string') return false;
  if (token.text === '::' || previous.text === '::' || previous.text === '.') return false;
  if (previous.text === '(' || previous.text === '[') return false;
  if (
    previous.kind === 'operator' &&
    (previous.text === '-' || previous.text === '+') &&
    isUnary(tokens, i - 1)
  )
    return false;
  return true;
}

function spaceBeforeParen(tokens: Token[], i: number): boolean {
  const previous = tokens[i - 1];
  if (!previous || previous.text === '(' || previous.text === '[') return false;
  if (previous.text === ',' || previous.kind !== 'word') return previous.kind !== 'param';
  if (SPACE_BEFORE_PAREN.has(lower(previous))) return true;
  // "INSERT INTO t (a)" / "CREATE TABLE t (a)": a name after these words is not a function call.
  return ['into', 'table', 'view', 'index', 'update'].includes(lower(tokens[i - 2]));
}

function isUnary(tokens: Token[], signIndex: number): boolean {
  const before = tokens[signIndex - 1];
  if (!before) return true;
  if (before.kind === 'operator' || before.text === '(' || before.text === ',') return true;
  return before.kind === 'word' && UNARY_AFTER.has(lower(before));
}

// A SELECT list with a comma outside any parentheses gets one column per line.
function hasTopLevelComma(tokens: Token[], from: number): boolean {
  let depth = 0;
  for (let j = from + 1; j < tokens.length; j++) {
    const text = tokens[j].text;
    if (text === '(') depth++;
    else if (text === ')') {
      if (depth === 0) return false;
      depth--;
    } else if (depth === 0) {
      if (text === ',') return true;
      if (text === ';') return false;
      if (tokens[j].kind === 'word' && CLAUSES.has(lower(tokens[j]))) return false;
    }
  }
  return false;
}

// "x BETWEEN a AND b": that AND belongs to BETWEEN and must not start a new line.
function isBetweenAnd(tokens: Token[], index: number): boolean {
  if (lower(tokens[index]) !== 'and') return false;
  let depth = 0;
  for (let j = index - 1; j >= 0; j--) {
    const text = tokens[j].text;
    if (text === ')') depth++;
    else if (text === '(') {
      if (depth === 0) return false;
      depth--;
    } else if (depth === 0 && tokens[j].kind === 'word') {
      const word = lower(tokens[j]);
      if (word === 'between') return true;
      if (word === 'and' || word === 'or' || word === 'on' || CLAUSES.has(word)) return false;
    }
  }
  return false;
}
