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

/** Returns the formatted statement text, or null when the input cannot be formatted safely. */
export function formatSql(sql: string, driver: Driver): string | null {
  const all = tokenize(sql, driver);
  if (!all) return null;
  const tokens = all.filter((token) => token.kind !== 'space');
  if (tokens.length === 0) return sql;
  if (tokens.some((token) => token.kind === 'word' && PROCEDURAL.has(lower(token)))) return null;

  let out = '';
  let lineStart = true;
  let clause = '';
  let breakAfterSelect = false;
  const stack: Frame[] = [];
  const newline = (level: number) => {
    out = out.replace(/[ \t]+$/, '') + '\n' + INDENT.repeat(Math.max(level, 0));
    lineStart = true;
  };
  const append = (text: string, space: boolean) => {
    if (!lineStart && space) out += ' ';
    out += text;
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
      const ownLine = !previous || /\n/.test(sql.slice(previous.end, token.start));
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
      if (i < tokens.length - 1) {
        newline(0);
        newline(0);
      }
      continue;
    }
    if (token.text === '(') {
      const subquery = nextWord === 'select' || nextWord === 'with';
      append('(', !lineStart && spaceBeforeParen(tokens, i));
      stack.push({ subquery, indent: base + (subquery ? 1 : 0) });
      if (subquery) newline(base + 1);
      continue;
    }
    if (token.text === ')') {
      const frame = stack.pop();
      if (frame?.subquery) newline(stack[stack.length - 1]?.indent ?? 0);
      append(')', false);
      continue;
    }
    append(token.text, spaceBetween(tokens, i));
  }
  return out
    .replace(/[ \t]+$/gm, '')
    .replace(/^\n+/, '')
    .trimEnd();
}

function spaceBetween(tokens: Token[], i: number): boolean {
  const token = tokens[i];
  const previous = tokens[i - 1];
  if (!previous) return false;
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
