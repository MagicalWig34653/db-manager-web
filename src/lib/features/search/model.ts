// SPDX-License-Identifier: AGPL-3.0-only
import type { components } from '$lib/contract/v14/api-types';
import { t } from '$lib/i18n';
import type { TableDescription } from '$lib/tables';
export type Schemas = components['schemas'];
export type Mode = Schemas['SearchRequest']['mode'];
export type Target = Schemas['SearchTarget'];
export type Plan = Schemas['ReplacePlan'];
export type Result = Schemas['ReplaceResult'];
export const modes: Mode[] = ['substring', 'all_words', 'exact', 'regex'];
export const validText = (value: string, empty = false) =>
  (empty || value.length > 0) &&
  !value.includes('\0') &&
  new TextEncoder().encode(value).length <= 4096;
export const textColumns = (description: TableDescription, replace = false) =>
  description.columns.filter(
    (column) =>
      /^(?:(?:tiny|medium|long)?text|(?:character varying|character|varchar|char|nchar|nvarchar|clob))(?:\s*\(.*\))?$/i.test(
        column.database_type.trim(),
      ) &&
      (!replace || (!column.pk_position && column.generated === 'none')),
  );
/** Literal visual aid only. DB collation/regex semantics are never emulated in JS. */
export function highlight(value: string, term: string, mode: Mode) {
  if (mode === 'regex' || !term) return [{ text: value, hit: false }];
  const needles = mode === 'all_words' ? term.split(/\s+/).filter(Boolean) : [term];
  const ranges: [number, number][] = [];
  for (const needle of needles) {
    let start = 0;
    while (start < value.length) {
      const at = value.indexOf(needle, start);
      if (at < 0) break;
      ranges.push([at, at + needle.length]);
      start = at + needle.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  const parts: { text: string; hit: boolean }[] = [];
  let end = 0;
  for (const [from, to] of merged) {
    if (from > end) parts.push({ text: value.slice(end, from), hit: false });
    parts.push({ text: value.slice(from, to), hit: true });
    end = to;
  }
  if (end < value.length) parts.push({ text: value.slice(end), hit: false });
  return parts;
}

export function modeLabel(mode: Mode): string {
  switch (mode) {
    case 'substring':
      return t('search.mode_substring');
    case 'all_words':
      return t('search.mode_all_words');
    case 'exact':
      return t('search.mode_exact');
    case 'regex':
      return t('search.mode_regex');
  }
}
export function outcomeLabel(outcome: Result['outcome']): string {
  switch (outcome) {
    case 'completed':
      return t('search.outcome_completed');
    case 'rejected':
      return t('search.outcome_rejected');
    case 'outcome_unknown':
      return t('search.unknown');
  }
}
export function reasonLabel(reason: NonNullable<Result['reason']>): string {
  switch (reason) {
    case 'commit_unknown':
      return t('search.reason_commit_unknown');
    case 'database_error':
      return t('search.reason_database_error');
    case 'row_conflict':
      return t('search.reason_row_conflict');
    case 'invalid_value':
      return t('search.reason_invalid_value');
  }
}
