// SPDX-License-Identifier: AGPL-3.0-only
// Client-side display transformations and input editors (W-P22). Pure functions: a cell value goes in, a description of
// what to show comes out. Nothing here touches the network or the DOM, nothing becomes markup (the output is plain text,
// a validated http/https link target, or image bytes that the component draws on a canvas), and the cell value itself is
// never modified. External programs (phpMyAdmin Text_Plain_External) are deliberately not part of the catalog.
import { formatDate, t } from '$lib/i18n';
import type { DisplayCell, Driver } from '$lib/workbench';
import { decodeBase64, IMAGE_LIMITS, sniffImage, type ImageMime } from './image';
import { formatIp, ipv4ToLong, longToIpv4, parseIp, toHex } from './ip';
import { compile, find, matchesFully, replaceAll, type RegexFailure } from './regex';
import {
  checkJson,
  checkSql,
  checkXml,
  prettyJson,
  prettySql,
  prettyXml,
  STRUCTURED_LIMITS,
  type Check,
  type Pretty,
} from './structured';

export type DisplayId =
  | 'link'
  | 'image'
  | 'truncate'
  | 'highlight'
  | 'affix'
  | 'datetime'
  | 'bool_text'
  | 'ip_binary_to_text'
  | 'ip_text_to_hex'
  | 'long_to_ipv4'
  | 'ipv4_to_long'
  | 'hex'
  | 'regex_replace'
  | 'json'
  | 'xml'
  | 'sql';
export type InputId = 'json_editor' | 'xml_editor' | 'sql_editor' | 'regex_validation';
export type OptionValue = string | number | boolean;
export type Options = Record<string, OptionValue>;

export interface OptionSpec {
  key: string;
  type: 'text' | 'int' | 'bool' | 'select';
  default: OptionValue;
  min?: number;
  max?: number;
  maxLength?: number;
  choices?: readonly string[];
}
export interface DisplaySpec {
  id: DisplayId;
  options: readonly OptionSpec[];
}
export interface InputSpec {
  id: InputId;
  options: readonly OptionSpec[];
}

const text = (key: string, def = '', maxLength = 100): OptionSpec => ({
  key,
  type: 'text',
  default: def,
  maxLength,
});
const int = (key: string, def: number, min: number, max: number): OptionSpec => ({
  key,
  type: 'int',
  default: def,
  min,
  max,
});
const bool = (key: string, def: boolean): OptionSpec => ({ key, type: 'bool', default: def });
const select = (key: string, def: string, choices: readonly string[]): OptionSpec => ({
  key,
  type: 'select',
  default: def,
  choices,
});

export const DISPLAY: readonly DisplaySpec[] = [
  { id: 'link', options: [text('prefix', '', 200), text('suffix', '', 200)] },
  { id: 'image', options: [int('maxKiB', 512, 1, 2048), int('width', 160, 32, 640)] },
  {
    id: 'truncate',
    options: [int('start', 0, 0, 10_000), int('length', 40, 1, 1_000), text('ellipsis', '…', 10)],
  },
  { id: 'highlight', options: [text('term', '', 100), bool('ignoreCase', true)] },
  { id: 'affix', options: [text('prefix', '', 100), text('suffix', '', 100)] },
  {
    id: 'datetime',
    options: [
      select('source', 'iso', ['iso', 'epoch_s', 'epoch_ms']),
      select('dateStyle', 'medium', ['none', 'short', 'medium', 'long']),
      select('timeStyle', 'medium', ['none', 'short', 'medium', 'long']),
      select('zone', 'utc', ['utc', 'local']),
    ],
  },
  { id: 'bool_text', options: [text('yes', '', 30), text('no', '', 30)] },
  { id: 'ip_binary_to_text', options: [] },
  { id: 'ip_text_to_hex', options: [] },
  { id: 'long_to_ipv4', options: [] },
  { id: 'ipv4_to_long', options: [] },
  { id: 'hex', options: [int('maxBytes', 1024, 16, 65_536)] },
  {
    id: 'regex_replace',
    options: [text('pattern', '', 200), text('replacement', '', 200), bool('ignoreCase', false)],
  },
  { id: 'json', options: [] },
  { id: 'xml', options: [] },
  { id: 'sql', options: [] },
];
export const INPUT: readonly InputSpec[] = [
  { id: 'json_editor', options: [] },
  { id: 'xml_editor', options: [] },
  { id: 'sql_editor', options: [] },
  { id: 'regex_validation', options: [text('pattern', '', 200)] },
];
const specs = new Map<string, readonly OptionSpec[]>([
  ...DISPLAY.map((d) => [d.id, d.options] as const),
  ...INPUT.map((d) => [d.id, d.options] as const),
]);
export const isDisplayId = (id: unknown): id is DisplayId => DISPLAY.some((d) => d.id === id);
export const isInputId = (id: unknown): id is InputId => INPUT.some((d) => d.id === id);
export const optionSpecs = (id: string): readonly OptionSpec[] => specs.get(id) ?? [];

/** Defaults for a transformation. */
export const defaultOptions = (id: string): Options =>
  Object.fromEntries(optionSpecs(id).map((s) => [s.key, s.default]));

/**
 * Brings arbitrary data (a stored document, a form) to a valid option set: unknown keys are dropped, wrong types fall
 * back to the default, numbers are clamped, text is cut to its limit and stripped of control characters.
 */
export function sanitizeOptions(id: string, raw: unknown): Options {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const out: Options = {};
  for (const spec of optionSpecs(id)) {
    const value = Object.hasOwn(source, spec.key) ? source[spec.key] : undefined;
    if (spec.type === 'bool')
      out[spec.key] = typeof value === 'boolean' ? value : (spec.default as boolean);
    else if (spec.type === 'int') {
      const n =
        typeof value === 'number' && Number.isFinite(value)
          ? Math.trunc(value)
          : (spec.default as number);
      out[spec.key] = Math.min(spec.max as number, Math.max(spec.min as number, n));
    } else if (spec.type === 'select')
      out[spec.key] =
        typeof value === 'string' && spec.choices?.includes(value) ? value : spec.default;
    else {
      // eslint-disable-next-line no-control-regex
      const clean =
        typeof value === 'string'
          ? value.replace(/[\u0000-\u001F\u007F]/g, '')
          : (spec.default as string);
      out[spec.key] = Array.from(clean).slice(0, spec.maxLength).join('');
    }
  }
  return out;
}

// ----- results -----

export type RawReason =
  | 'null'
  | 'not_applicable'
  | 'too_large'
  | 'not_image'
  | 'image_too_large'
  | 'not_url'
  | 'unsafe_url'
  | 'invalid_ip'
  | 'invalid_date'
  | 'invalid_number'
  | 'invalid_json'
  | 'invalid_xml'
  | 'invalid_sql'
  | 'doctype'
  | 'too_deep'
  | 'bad_pattern'
  | 'regex_limit'
  | 'empty_option';

export type Output =
  | { kind: 'text'; text: string }
  | { kind: 'pre'; text: string; note?: string }
  | { kind: 'link'; href: string }
  | { kind: 'marked'; parts: { text: string; mark: boolean }[] }
  | { kind: 'image'; mime: ImageMime; bytes: Uint8Array; width: number; height: number }
  /** The transformation does not apply to this value: the raw value is shown, with the reason. */
  | { kind: 'raw'; reason: RawReason };

export interface Context {
  driver: Driver;
}

const raw = (reason: RawReason): Output => ({ kind: 'raw', reason });
const asText = (cell: DisplayCell): string | null =>
  cell.kind === 'null' || cell.kind === 'binary' || cell.value === undefined
    ? null
    : String(cell.value);
const MAX_TEXT = STRUCTURED_LIMITS.bytes;

const regexReason = (failure: RegexFailure): RawReason =>
  failure === 'input_too_long' || failure === 'budget_exceeded' || failure === 'output_too_long'
    ? 'regex_limit'
    : 'bad_pattern';
const structuredReason = (reason: string): RawReason =>
  reason === 'too_large'
    ? 'too_large'
    : ((['too_deep', 'doctype', 'invalid_json', 'invalid_xml', 'invalid_sql'] as const).find(
        (r) => r === reason,
      ) ?? 'not_applicable');

/** Only absolute http(s) targets without credentials; the returned href is the normalized, re-serialized URL. */
export function safeHttpUrl(candidate: string): string | null {
  if (candidate.length > 2048) return null;
  for (let i = 0; i < candidate.length; i++) {
    const c = candidate.charCodeAt(i);
    // control characters, space, DEL/C1, line and paragraph separators and backslashes are never part of a target
    if (c <= 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029 || c === 0x5c)
      return null;
  }
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password || !url.hostname) return null;
    return url.href;
  } catch {
    return null;
  }
}

function parseDateTime(
  value: string,
  source: string,
): { date: Date; wall: boolean; dateOnly: boolean } | null {
  if (source !== 'iso') {
    if (!/^-?\d{1,16}$/.test(value)) return null;
    const n = Number(value) * (source === 'epoch_s' ? 1000 : 1);
    const date = new Date(n);
    return Number.isFinite(date.getTime()) ? { date, wall: false, dateOnly: false } : null;
  }
  const m =
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(
      value.trim(),
    );
  if (!m) return null;
  const [y, mo, d, h = '0', mi = '0', s = '0'] = m.slice(1, 7);
  const ms = Number(((m[7] ?? '0') + '00').slice(0, 3));
  let time = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms);
  const check = new Date(time);
  if (
    check.getUTCMonth() !== Number(mo) - 1 ||
    check.getUTCDate() !== Number(d) ||
    Number(h) > 23 ||
    Number(mi) > 59 ||
    Number(s) > 59
  )
    return null;
  if (m[8] && m[8] !== 'Z') {
    const sign = m[8][0] === '-' ? -1 : 1;
    const digits = m[8].slice(1).replace(':', '');
    const offset = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2) || '0');
    time -= sign * offset * 60_000;
  }
  return { date: new Date(time), wall: !m[8], dateOnly: m[4] === undefined };
}

function formatDateTime(cell: DisplayCell, options: Options): Output {
  const value = asText(cell);
  if (value === null) return raw('not_applicable');
  const source = String(options.source);
  const parsed = parseDateTime(
    value,
    cell.kind === 'integer' && source === 'iso' ? 'epoch_s' : source,
  );
  if (!parsed) return raw('invalid_date');
  const dateStyle = options.dateStyle === 'none' ? undefined : (options.dateStyle as 'short');
  const timeStyle =
    options.timeStyle === 'none' || parsed.dateOnly ? undefined : (options.timeStyle as 'short');
  if (!dateStyle && !timeStyle) return raw('empty_option');
  // A value without a zone is a wall-clock time: it is formatted as written, never shifted by the viewer's zone.
  const timeZone = parsed.wall ? 'UTC' : options.zone === 'local' ? undefined : 'UTC';
  try {
    return {
      kind: 'text',
      text: formatDate(parsed.date, { dateStyle, timeStyle, timeZone }),
    };
  } catch {
    return raw('invalid_date');
  }
}

const base64Of = (cell: DisplayCell, maxBytes: number): Uint8Array | null | 'big' => {
  if (cell.kind !== 'binary' || cell.value === undefined) return null;
  const bytes = decodeBase64(cell.value, maxBytes);
  return bytes ?? 'big';
};

function hexDump(bytes: Uint8Array, limit: number): Output {
  const shown = bytes.subarray(0, limit);
  const lines: string[] = [];
  for (let i = 0; i < shown.length; i += 16) {
    const row = shown.subarray(i, i + 16);
    const hex = Array.from(row, (b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(row, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join(
      '',
    );
    lines.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(47, ' ')}  |${ascii}|`);
  }
  return {
    kind: 'pre',
    text: lines.join('\n'),
    note:
      bytes.length > shown.length
        ? t('transform.hexCut', { shown: shown.length, total: bytes.length })
        : undefined,
  };
}

const pretty = (result: Pretty): Output =>
  result.ok ? { kind: 'pre', text: result.text } : raw(structuredReason(result.reason));

/** Applies one display transformation. Total: any hostile or unsuitable value yields `raw`, never an exception. */
export function applyDisplay(
  id: DisplayId,
  cell: DisplayCell,
  rawOptions: unknown,
  context: Context,
): Output {
  if (cell.kind === 'null') return raw('null');
  const options = sanitizeOptions(id, rawOptions);
  const value = asText(cell);
  if (value !== null && value.length > MAX_TEXT) return raw('too_large');
  switch (id) {
    case 'link': {
      if (value === null) return raw('not_applicable');
      const href = safeHttpUrl(`${options.prefix}${value}${options.suffix}`);
      return href
        ? { kind: 'link', href }
        : raw(/^[a-z][a-z0-9+.-]*:/i.test(value) ? 'unsafe_url' : 'not_url');
    }
    case 'image': {
      const limit = Math.min(Number(options.maxKiB) * 1024, IMAGE_LIMITS.maxBytes);
      const bytes = base64Of(cell, limit);
      if (bytes === null) return raw('not_applicable');
      if (bytes === 'big') return raw('too_large');
      const info = sniffImage(bytes);
      if (!info) return raw('not_image');
      return { kind: 'image', mime: info.mime, bytes, width: info.width, height: info.height };
    }
    case 'truncate': {
      if (value === null) return raw('not_applicable');
      const chars = Array.from(value);
      const start = Number(options.start);
      const length = Number(options.length);
      const part = chars.slice(start, start + length).join('');
      const cutBefore = start > 0 && chars.length > 0;
      const cutAfter = start + length < chars.length;
      return {
        kind: 'text',
        text:
          (cutBefore ? String(options.ellipsis) : '') +
          part +
          (cutAfter ? String(options.ellipsis) : ''),
      };
    }
    case 'highlight': {
      if (value === null) return raw('not_applicable');
      const term = String(options.term);
      if (!term) return raw('empty_option');
      const hay = options.ignoreCase ? value.toLowerCase() : value;
      const needle = options.ignoreCase ? term.toLowerCase() : term;
      // Lower-casing can change the length for a few characters; then offsets are not trustworthy.
      if (hay.length !== value.length) return { kind: 'text', text: value };
      const parts: { text: string; mark: boolean }[] = [];
      let from = 0;
      for (let hits = 0; hits < 1000; hits++) {
        const at = hay.indexOf(needle, from);
        if (at === -1) break;
        if (at > from) parts.push({ text: value.slice(from, at), mark: false });
        parts.push({ text: value.slice(at, at + needle.length), mark: true });
        from = at + needle.length;
      }
      if (from < value.length) parts.push({ text: value.slice(from), mark: false });
      return { kind: 'marked', parts };
    }
    case 'affix':
      return value === null
        ? raw('not_applicable')
        : { kind: 'text', text: `${options.prefix}${value}${options.suffix}` };
    case 'datetime':
      return formatDateTime(cell, options);
    case 'bool_text': {
      if (value === null) return raw('not_applicable');
      const v = value.trim().toLowerCase();
      const yes = ['1', 'true', 't', 'y', 'yes'].includes(v);
      const no = ['0', 'false', 'f', 'n', 'no'].includes(v);
      if (!yes && !no) return raw('not_applicable');
      return {
        kind: 'text',
        text: String(yes ? options.yes || t('transform.yes') : options.no || t('transform.no')),
      };
    }
    case 'ip_binary_to_text': {
      if (cell.kind === 'binary') {
        const bytes = base64Of(cell, 16);
        const formatted = bytes && bytes !== 'big' ? formatIp(bytes) : null;
        return formatted ? { kind: 'text', text: formatted } : raw('invalid_ip');
      }
      const bytes = value === null ? null : parseIp(value.trim());
      return bytes ? { kind: 'text', text: formatIp(bytes) as string } : raw('invalid_ip');
    }
    case 'ip_text_to_hex': {
      const bytes = value === null ? null : parseIp(value.trim());
      return bytes ? { kind: 'text', text: toHex(bytes).toUpperCase() } : raw('invalid_ip');
    }
    case 'long_to_ipv4': {
      const n = value !== null && /^\d{1,10}$/.test(value.trim()) ? Number(value) : NaN;
      const ip = longToIpv4(n);
      return ip ? { kind: 'text', text: ip } : raw('invalid_number');
    }
    case 'ipv4_to_long': {
      const n = value === null ? null : ipv4ToLong(value.trim());
      return n === null ? raw('invalid_ip') : { kind: 'text', text: String(n) };
    }
    case 'hex': {
      const limit = Number(options.maxBytes);
      if (cell.kind === 'binary') {
        const bytes = base64Of(cell, 8 * 1024 * 1024);
        if (bytes === null) return raw('not_applicable');
        return bytes === 'big' ? raw('too_large') : hexDump(bytes, limit);
      }
      return value === null
        ? raw('not_applicable')
        : hexDump(new TextEncoder().encode(value), limit);
    }
    case 'regex_replace': {
      if (value === null) return raw('not_applicable');
      const result = replaceAll(
        String(options.pattern),
        options.ignoreCase ? 'i' : '',
        String(options.replacement),
        value,
      );
      return result.ok ? { kind: 'text', text: result.value } : raw(regexReason(result.failure));
    }
    case 'json':
      return value === null ? raw('not_applicable') : pretty(prettyJson(value));
    case 'xml':
      return value === null ? raw('not_applicable') : pretty(prettyXml(value));
    case 'sql':
      return value === null ? raw('not_applicable') : pretty(prettySql(value, context.driver));
  }
}

// ----- input editors -----

export type InputProblem =
  | 'invalid_json'
  | 'invalid_xml'
  | 'invalid_sql'
  | 'doctype'
  | 'too_deep'
  | 'too_large'
  | 'no_match'
  | 'bad_pattern'
  | 'regex_limit';

const problemOf = (check: Check): InputProblem | null => {
  if (check.ok) return null;
  return check.reason as InputProblem;
};

/** Validates the text of an input editor. Never changes it; null means "acceptable". */
export function validateInput(
  id: InputId,
  valueText: string,
  rawOptions: unknown,
  context: Context,
): InputProblem | null {
  const options = sanitizeOptions(id, rawOptions);
  switch (id) {
    case 'json_editor':
      return problemOf(checkJson(valueText));
    case 'xml_editor':
      return problemOf(checkXml(valueText));
    case 'sql_editor':
      return problemOf(checkSql(valueText, context.driver));
    case 'regex_validation': {
      const result = matchesFully(String(options.pattern), valueText);
      if (!result.ok)
        return regexReason(result.failure) === 'regex_limit' ? 'regex_limit' : 'bad_pattern';
      return result.value ? null : 'no_match';
    }
  }
}

/** Read-only preview of an editor's text (pretty-printed); null when there is nothing to show. */
export function previewInput(id: InputId, valueText: string, context: Context): string | null {
  const result =
    id === 'json_editor'
      ? prettyJson(valueText)
      : id === 'xml_editor'
        ? prettyXml(valueText)
        : id === 'sql_editor'
          ? prettySql(valueText, context.driver)
          : null;
  return result?.ok ? result.text : null;
}

/** Checks a regex option without any input (for the mapping dialog). */
export function patternProblem(pattern: string, flags = ''): boolean {
  if (pattern === '') return false;
  const compiled = compile(pattern, flags);
  if (!compiled.ok) return true;
  return !find(compiled.program, '').ok;
}
