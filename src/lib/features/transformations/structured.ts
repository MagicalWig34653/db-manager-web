// SPDX-License-Identifier: AGPL-3.0-only
// Validation and pretty-printing of JSON, XML and SQL text for display and for the input editors (W-P22). Everything
// returns plain text; nothing is parsed into a DOM, no entity or DTD is ever resolved, and numbers keep the exact
// literal of the source (a JSON number is never converted to a double and back).
import { formatSql } from '../sql-editor/format';
import { tokenize } from '../sql-editor/lexer';
import type { Driver } from '$lib/workbench';

export const STRUCTURED_LIMITS = { bytes: 1_048_576, depth: 200 } as const;

export type Check = { ok: true } | { ok: false; reason: StructuredFailure };
export type StructuredFailure =
  'too_large' | 'too_deep' | 'invalid_json' | 'invalid_xml' | 'doctype' | 'invalid_sql';
export type Pretty = { ok: true; text: string } | { ok: false; reason: StructuredFailure };

// ----- JSON -----

function jsonDepthOk(text: string): boolean {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '[' || c === '{') {
      if (++depth > STRUCTURED_LIMITS.depth) return false;
    } else if (c === ']' || c === '}') depth--;
  }
  return true;
}

export function checkJson(text: string): Check {
  if (text.length > STRUCTURED_LIMITS.bytes) return { ok: false, reason: 'too_large' };
  if (!jsonDepthOk(text)) return { ok: false, reason: 'too_deep' };
  try {
    JSON.parse(text);
    return { ok: true };
  } catch {
    // The engine's message may quote a part of the value: it is never shown.
    return { ok: false, reason: 'invalid_json' };
  }
}

/** Re-indents valid JSON without touching any token (strings, numbers and key order stay byte-identical). */
export function prettyJson(text: string): Pretty {
  const checked = checkJson(text);
  if (!checked.ok) return checked;
  let out = '';
  let indent = 0;
  const pad = () => '\n' + '  '.repeat(indent);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']';
      let j = i + 1;
      while (/[ \t\r\n]/.test(text[j] ?? '')) j++;
      if (text[j] === close) {
        out += c + close;
        i = j;
      } else {
        indent++;
        out += c + pad();
      }
    } else if (c === '}' || c === ']') {
      indent--;
      out += pad() + c;
    } else if (c === ',') out += ',' + pad();
    else if (c === ':') out += ': ';
    else if (/[ \t\r\n]/.test(c)) continue;
    else out += c;
  }
  return { ok: true, text: out };
}

// ----- XML -----

type XmlEvent =
  | { t: 'open'; text: string }
  | { t: 'close'; text: string }
  | { t: 'empty'; text: string }
  | { t: 'text'; text: string }
  | { t: 'other'; text: string };

const NAME = /^[A-Za-z_:À-￿][A-Za-z0-9_.:·À-￿-]*/;
const ENTITY = /&(?:(?:amp|lt|gt|quot|apos)|#[0-9]{1,7}|#x[0-9a-fA-F]{1,6});/y;
const hasBadChars = (text: string) =>
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/.test(text);

function checkText(text: string): boolean {
  if (hasBadChars(text)) return false;
  for (let i = text.indexOf('&'); i !== -1; i = text.indexOf('&', i + 1)) {
    ENTITY.lastIndex = i;
    if (!ENTITY.test(text)) return false;
  }
  return !text.includes(']]>');
}

/** Tokenizes with full well-formedness checks; unknown entities and DOCTYPE declarations are refused. */
function xmlEvents(
  text: string,
): { ok: true; events: XmlEvent[] } | { ok: false; reason: StructuredFailure } {
  if (text.length > STRUCTURED_LIMITS.bytes) return { ok: false, reason: 'too_large' };
  const fail = (reason: StructuredFailure = 'invalid_xml') => ({ ok: false as const, reason });
  const events: XmlEvent[] = [];
  const stack: string[] = [];
  let roots = 0;
  let i = 0;
  const body = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  i = body;
  while (i < text.length) {
    if (text[i] !== '<') {
      const end = text.indexOf('<', i);
      const chunk = text.slice(i, end === -1 ? text.length : end);
      if (!checkText(chunk)) return fail();
      if (stack.length === 0 && chunk.trim() !== '') return fail();
      if (chunk !== '') events.push({ t: 'text', text: chunk });
      i = end === -1 ? text.length : end;
      continue;
    }
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      if (end === -1) return fail();
      const inner = text.slice(i + 4, end);
      if (inner.includes('--') || inner.endsWith('-') || hasBadChars(inner)) return fail();
      events.push({ t: 'other', text: text.slice(i, end + 3) });
      i = end + 3;
    } else if (text.startsWith('<![CDATA[', i)) {
      const end = text.indexOf(']]>', i + 9);
      if (end === -1 || stack.length === 0 || hasBadChars(text.slice(i, end))) return fail();
      events.push({ t: 'other', text: text.slice(i, end + 3) });
      i = end + 3;
    } else if (text.startsWith('<?', i)) {
      const end = text.indexOf('?>', i + 2);
      if (end === -1 || !NAME.test(text.slice(i + 2, end)) || hasBadChars(text.slice(i, end)))
        return fail();
      events.push({ t: 'other', text: text.slice(i, end + 2) });
      i = end + 2;
    } else if (text.startsWith('<!', i)) {
      return fail(/^<!DOCTYPE/i.test(text.slice(i, i + 9)) ? 'doctype' : 'invalid_xml');
    } else if (text[i + 1] === '/') {
      const end = text.indexOf('>', i);
      if (end === -1) return fail();
      const name = text.slice(i + 2, end).trimEnd();
      const match = NAME.exec(name);
      if (!match || match[0] !== name || stack.pop() !== name) return fail();
      events.push({ t: 'close', text: name });
      i = end + 1;
    } else {
      // start tag or empty-element tag
      const name = NAME.exec(text.slice(i + 1, i + 257));
      if (!name) return fail();
      let j = i + 1 + name[0].length;
      const seen = new Set<string>();
      let selfClose = false;
      for (;;) {
        const spaceStart = j;
        while (/[ \t\r\n]/.test(text[j] ?? '')) j++;
        if (text[j] === '>') {
          j++;
          break;
        }
        if (text[j] === '/' && text[j + 1] === '>') {
          selfClose = true;
          j += 2;
          break;
        }
        if (j === spaceStart || j >= text.length) return fail();
        const attr = NAME.exec(text.slice(j, j + 257));
        if (!attr || seen.has(attr[0])) return fail();
        seen.add(attr[0]);
        j += attr[0].length;
        while (/[ \t\r\n]/.test(text[j] ?? '')) j++;
        if (text[j++] !== '=') return fail();
        while (/[ \t\r\n]/.test(text[j] ?? '')) j++;
        const quote = text[j];
        if (quote !== '"' && quote !== "'") return fail();
        const close = text.indexOf(quote, j + 1);
        if (close === -1) return fail();
        const value = text.slice(j + 1, close);
        if (value.includes('<') || !checkText(value)) return fail();
        j = close + 1;
      }
      if (stack.length === 0 && ++roots > 1) return fail();
      const raw = text.slice(i, j);
      if (selfClose) events.push({ t: 'empty', text: raw });
      else {
        if (stack.length >= STRUCTURED_LIMITS.depth) return fail('too_deep');
        stack.push(name[0]);
        events.push({ t: 'open', text: raw });
      }
      i = j;
    }
  }
  if (stack.length !== 0 || roots !== 1) return fail();
  return { ok: true, events };
}

export function checkXml(text: string): Check {
  const result = xmlEvents(text);
  return result.ok ? { ok: true } : result;
}

/** Indents elements, one per line; text-only elements stay on one line, whitespace-only text is dropped. */
export function prettyXml(text: string): Pretty {
  const result = xmlEvents(text);
  if (!result.ok) return result;
  const { events } = result;
  const lines: string[] = [];
  let depth = 0;
  const line = (value: string) => lines.push('  '.repeat(depth) + value);
  for (let k = 0; k < events.length; k++) {
    const e = events[k];
    if (e.t === 'open') {
      const next = events[k + 1];
      const after = events[k + 2];
      if (next?.t === 'text' && after?.t === 'close') {
        line(e.text + next.text + `</${after.text}>`);
        k += 2;
      } else if (next?.t === 'close') {
        line(e.text + `</${next.text}>`);
        k += 1;
      } else {
        line(e.text);
        depth++;
      }
    } else if (e.t === 'close') {
      depth--;
      line(`</${e.text}>`);
    } else if (e.t === 'text') {
      const trimmed = e.text.trim();
      if (trimmed) line(trimmed);
    } else line(e.text);
  }
  return { ok: true, text: lines.join('\n') };
}

// ----- SQL -----

export function checkSql(sql: string, driver: Driver): Check {
  if (sql.length > STRUCTURED_LIMITS.bytes) return { ok: false, reason: 'too_large' };
  return tokenize(sql, driver) ? { ok: true } : { ok: false, reason: 'invalid_sql' };
}

export function prettySql(sql: string, driver: Driver): Pretty {
  const checked = checkSql(sql, driver);
  if (!checked.ok) return checked;
  const formatted = formatSql(sql, driver);
  // Not safely formattable (procedural code, ambiguity): the unchanged text is the honest display.
  return { ok: true, text: formatted ?? sql };
}
