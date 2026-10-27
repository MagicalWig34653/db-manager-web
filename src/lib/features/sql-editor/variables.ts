// SPDX-License-Identifier: AGPL-3.0-only
// Bookmark variables: ":name" placeholders are replaced by plain text in the browser, right before the
// SQL leaves for the backend. The backend never sees or interprets placeholders; this is text replacement only.
import type { Driver } from '$lib/workbench';
import { tokenize } from './lexer';

export type VariableMode = 'text' | 'number' | 'null' | 'raw';
export interface VariableInput {
  mode: VariableMode;
  value: string;
}

export const MAX_VARIABLES = 32;
export const MAX_VALUE_LENGTH = 10000;

/** Distinct placeholder names in order of first use. Strings, comments and quoted identifiers are skipped. */
export function placeholderNames(sql: string, driver: Driver): string[] {
  const tokens = tokenize(sql, driver);
  if (!tokens) return [];
  const names: string[] = [];
  for (const token of tokens)
    if (token.kind === 'param' && !names.includes(token.text.slice(1)))
      names.push(token.text.slice(1));
  return names.slice(0, MAX_VARIABLES);
}

export class VariableError extends Error {
  constructor(
    readonly name: string,
    readonly reason: 'missing' | 'number' | 'control' | 'length',
  ) {
    super(`${reason}:${name}`);
  }
}

function literal(input: VariableInput, name: string, driver: Driver): string {
  if (input.mode === 'null') return 'NULL';
  const value = input.value;
  if (value.length > MAX_VALUE_LENGTH) throw new VariableError(name, 'length');
  if (input.mode === 'number') {
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()))
      throw new VariableError(name, 'number');
    return value.trim();
  }
  if (input.mode === 'raw') return value;
  // eslint-disable-next-line no-control-regex
  if (/\u0000/.test(value)) throw new VariableError(name, 'control');
  const escaped = value.replaceAll("'", "''");
  return `'${driver === 'mysql' ? escaped.replaceAll('\\', '\\\\') : escaped}'`;
}

/**
 * Returns the SQL with every placeholder replaced. Values are never re-scanned, so a value that itself looks
 * like a placeholder is inserted as is. Throws VariableError for missing or invalid values.
 */
export function substitute(
  sql: string,
  driver: Driver,
  values: Record<string, VariableInput>,
): string {
  const tokens = tokenize(sql, driver);
  if (!tokens) return sql;
  let out = '';
  let last = 0;
  for (const token of tokens) {
    if (token.kind !== 'param') continue;
    const name = token.text.slice(1);
    const input = values[name];
    if (!input) throw new VariableError(name, 'missing');
    out += sql.slice(last, token.start) + literal(input, name, driver);
    last = token.end;
  }
  return out + sql.slice(last);
}
