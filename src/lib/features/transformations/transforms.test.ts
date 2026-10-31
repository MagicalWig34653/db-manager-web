// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '$lib/i18n';
import type { DisplayCell } from '$lib/workbench';
import { decodeBase64, sniffImage } from './image';
import { formatIp, parseIp } from './ip';
import { checkJson, checkXml, prettyJson, prettySql, prettyXml } from './structured';
import {
  applyDisplay,
  defaultOptions,
  DISPLAY,
  previewInput,
  safeHttpUrl,
  sanitizeOptions,
  validateInput,
  type DisplayId,
  type Output,
} from './transforms';

afterEach(() => setLocale('de'));
const ctx = { driver: 'sqlite' as const };
const text = (value: string): DisplayCell => ({ kind: 'text', value });
const bin = (bytes: number[] | Uint8Array): DisplayCell => ({
  kind: 'binary',
  value: btoa(String.fromCharCode(...bytes)),
});
const run = (id: DisplayId, cell: DisplayCell, options: unknown = {}): Output =>
  applyDisplay(id, cell, options, ctx);
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const WEBP = 'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';
const jpeg = (w: number, h: number) =>
  new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0,
    11,
    8,
    h >> 8,
    h & 255,
    w >> 8,
    w & 255,
    1,
    1,
    0x11,
    0,
    0,
    0,
    0,
  ]);

describe('links', () => {
  const hostile = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'ftp://example.com/',
    '//evil.example/x',
    'http://user:pw@example.com/',
    'https://example.com\\@evil.example/',
    'http://exa mple.com',
    'https://example.com/ x',
    'blob:https://example.com/uuid',
    'http://',
    'https:',
    '',
    'https://' + 'a'.repeat(3000) + '.example',
  ];
  it.each(hostile)('never links %j', (value) => {
    const out = run('link', text(value));
    expect(out.kind).toBe('raw');
    expect(safeHttpUrl(value)).toBeNull();
  });
  it('links http and https with the normalized target shown, rel and scheme guaranteed', () => {
    expect(run('link', text('https://Example.com/a b'.replace(' ', '%20')))).toEqual({
      kind: 'link',
      href: 'https://example.com/a%20b',
    });
    expect(run('link', text('http://example.com:8080/x?y=1#z'))).toEqual({
      kind: 'link',
      href: 'http://example.com:8080/x?y=1#z',
    });
  });
  it('shows the punycode form of look-alike hosts', () => {
    const out = run('link', text('https://аpple.example/'));
    expect(out).toEqual({ kind: 'link', href: 'https://xn--pple-43d.example/' });
  });
  it('builds from prefix and suffix but still validates the result', () => {
    expect(run('link', text('x/1'), { prefix: 'https://example.com/', suffix: '?a=1' })).toEqual({
      kind: 'link',
      href: 'https://example.com/x/1?a=1',
    });
    expect(run('link', text('alert(1)'), { prefix: 'javascript:' }).kind).toBe('raw');
  });
  it('does not treat non-text cells as URLs', () => {
    expect(run('link', bin([1, 2])).kind).toBe('raw');
    expect(run('link', { kind: 'null' })).toEqual({ kind: 'raw', reason: 'null' });
  });
});

describe('images', () => {
  it('recognizes PNG, GIF, WebP and JPEG by their bytes', () => {
    for (const [b64, mime] of [
      [PNG, 'image/png'],
      [GIF, 'image/gif'],
      [WEBP, 'image/webp'],
    ] as const) {
      const out = run('image', { kind: 'binary', value: b64 });
      expect(out.kind, mime).toBe('image');
      if (out.kind === 'image') expect(out.mime).toBe(mime);
    }
    const j = run('image', bin(jpeg(32, 16)));
    expect(j).toMatchObject({ kind: 'image', mime: 'image/jpeg', width: 32, height: 16 });
  });
  it('refuses SVG, HTML, scripts and text in a BLOB, whatever the content claims', () => {
    const enc = (s: string) => Array.from(new TextEncoder().encode(s));
    for (const s of [
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
      '<?xml version="1.0"?><svg/>',
      '<html><script>alert(1)</script>',
      'GIF89a<script>',
      '%PDF-1.7',
    ])
      expect(run('image', bin(enc(s))), s).toMatchObject({ kind: 'raw' });
  });
  it('refuses a text cell, even with a data URL inside (only BLOB bytes are images)', () => {
    expect(run('image', text('data:image/png;base64,' + PNG)).kind).toBe('raw');
  });
  it('refuses images that claim an excessive canvas before any decoder runs', () => {
    expect(sniffImage(jpeg(20000, 20000))).toBeNull();
    expect(sniffImage(jpeg(5000, 5000))).toBeNull(); // 25 MP
    expect(sniffImage(jpeg(0, 10))).toBeNull();
    const png = decodeBase64(PNG, 1000) as Uint8Array;
    const bomb = png.slice();
    bomb[18] = 0xff; // width 0xFFxx
    expect(sniffImage(bomb)).toBeNull();
    expect(sniffImage(png.slice(0, 20))).toBeNull(); // truncated header
  });
  it('enforces the size limit and strict base64', () => {
    const big = { kind: 'binary', value: btoa('A'.repeat(3000)) } as DisplayCell;
    expect(run('image', big, { maxKiB: 1 })).toEqual({ kind: 'raw', reason: 'too_large' });
    expect(decodeBase64('not base64!', 100)).toBeNull();
    expect(decodeBase64('QUJD', 2)).toBeNull();
    expect(decodeBase64('QUJ', 100)).toBeNull();
  });
});

describe('text transformations', () => {
  it('truncates by code points with ellipsis', () => {
    expect(run('truncate', text('abcdefghij'), { start: 0, length: 4 })).toEqual({
      kind: 'text',
      text: 'abcd…',
    });
    expect(run('truncate', text('abcdefghij'), { start: 3, length: 3, ellipsis: '..' })).toEqual({
      kind: 'text',
      text: '..def..',
    });
    expect(run('truncate', text('😀😀😀'), { length: 2 })).toEqual({ kind: 'text', text: '😀😀…' });
    expect(run('truncate', text('ab'), { length: 40 })).toEqual({ kind: 'text', text: 'ab' });
  });
  it('highlights without markup: hostile text stays text', () => {
    const out = run('highlight', text('<b>Bold</b> bold'), { term: 'bold' });
    expect(out).toEqual({
      kind: 'marked',
      parts: [
        { text: '<b>', mark: false },
        { text: 'Bold', mark: true },
        { text: '</b> ', mark: false },
        { text: 'bold', mark: true },
      ],
    });
    expect(run('highlight', text('x'), { term: '' })).toMatchObject({ kind: 'raw' });
  });
  it('adds prefix and suffix', () => {
    expect(run('affix', text('v'), { prefix: '<', suffix: '>' })).toEqual({
      kind: 'text',
      text: '<v>',
    });
  });
  it('shows booleans as text', () => {
    expect(run('bool_text', { kind: 'boolean', value: 'true' })).toEqual({
      kind: 'text',
      text: 'Ja',
    });
    expect(run('bool_text', { kind: 'integer', value: '0' }, { no: 'aus' })).toEqual({
      kind: 'text',
      text: 'aus',
    });
    expect(run('bool_text', text('maybe')).kind).toBe('raw');
  });
  it('replaces by pattern for display only and keeps the cell untouched', () => {
    const cell = text('a1b22');
    const copy = structuredClone(cell);
    expect(run('regex_replace', cell, { pattern: '\\d+', replacement: '#' })).toEqual({
      kind: 'text',
      text: 'a#b#',
    });
    expect(cell).toEqual(copy);
    expect(run('regex_replace', text('x'), { pattern: '(' })).toEqual({
      kind: 'raw',
      reason: 'bad_pattern',
    });
    expect(
      run('regex_replace', text('a'.repeat(5000) + '!'), { pattern: '(a+)+$', replacement: '' })
        .kind,
    ).toBe('text');
  });
});

describe('date and time', () => {
  it('formats wall-clock values as written (no zone shift) with Intl', () => {
    expect(
      run(
        'datetime',
        { kind: 'timestamp', value: '2026-03-04 05:06:07' },
        { dateStyle: 'short', timeStyle: 'short' },
      ),
    ).toEqual({
      kind: 'text',
      text: '04.03.26, 05:06',
    });
    setLocale('en');
    const en = run(
      'datetime',
      { kind: 'timestamp', value: '2026-03-04T05:06:07' },
      { dateStyle: 'medium', timeStyle: 'none' },
    );
    expect(en).toEqual({ kind: 'text', text: 'Mar 4, 2026' });
  });
  it('honors an explicit offset and the zone option', () => {
    const out = run('datetime', text('2026-01-01T00:30:00+02:00'), {
      dateStyle: 'short',
      timeStyle: 'short',
      zone: 'utc',
    });
    expect(out).toEqual({ kind: 'text', text: '31.12.25, 22:30' });
  });
  it('converts epoch seconds and milliseconds', () => {
    expect(
      run('datetime', { kind: 'integer', value: '0' }, { dateStyle: 'short', timeStyle: 'none' }),
    ).toEqual({
      kind: 'text',
      text: '01.01.70',
    });
    expect(
      run('datetime', text('1700000000000'), {
        source: 'epoch_ms',
        dateStyle: 'short',
        timeStyle: 'none',
      }),
    ).toEqual({
      kind: 'text',
      text: '14.11.23',
    });
  });
  it('refuses impossible dates and out-of-range epochs', () => {
    for (const v of [
      '2026-02-30',
      '2026-13-01',
      '2026-01-01 25:00:00',
      'yesterday',
      '99999999999999999',
    ])
      expect(run('datetime', text(v)).kind, v).toBe('raw');
    expect(
      run('datetime', { kind: 'integer', value: '99999999999999999' }, { source: 'epoch_ms' }).kind,
    ).toBe('raw');
  });
});

describe('IP addresses', () => {
  it('normalizes IPv6 like RFC 5952 and converts both ways', () => {
    for (const [input, canonical] of [
      ['2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
      ['::', '::'],
      ['::1', '::1'],
      ['1:0:0:2:0:0:0:3', '1:0:0:2::3'],
      ['1:2:3:4:5:6:7:8', '1:2:3:4:5:6:7:8'],
      ['::ffff:1.2.3.4', '::ffff:1.2.3.4'],
      ['1:0:2:3:4:5:6:7', '1:0:2:3:4:5:6:7'],
    ])
      expect(formatIp(parseIp(input) as Uint8Array), input).toBe(canonical);
    for (const bad of [
      '1.2.3',
      '256.1.1.1',
      '01.2.3.4',
      ':::',
      '1::2::3',
      '12345::',
      'fe80::1%eth0',
      '1.2.3.4.5',
      'g::1',
      '::1.2.3',
    ])
      expect(parseIp(bad), bad).toBeNull();
  });
  it('displays binary, INET text, hex and integer forms', () => {
    expect(run('ip_binary_to_text', bin([192, 168, 0, 1]))).toEqual({
      kind: 'text',
      text: '192.168.0.1',
    });
    expect(run('ip_binary_to_text', bin(Array(15).fill(0).concat([1])))).toEqual({
      kind: 'text',
      text: '::1',
    });
    expect(run('ip_binary_to_text', bin([1, 2, 3])).kind).toBe('raw');
    expect(run('ip_binary_to_text', text('2001:DB8::0001'))).toEqual({
      kind: 'text',
      text: '2001:db8::1',
    });
    expect(run('ip_text_to_hex', text('192.168.0.1'))).toEqual({ kind: 'text', text: 'C0A80001' });
    expect(run('long_to_ipv4', { kind: 'integer', value: '3232235521' })).toEqual({
      kind: 'text',
      text: '192.168.0.1',
    });
    expect(run('long_to_ipv4', { kind: 'integer', value: '4294967296' }).kind).toBe('raw');
    expect(run('ipv4_to_long', text('192.168.0.1'))).toEqual({ kind: 'text', text: '3232235521' });
  });
});

describe('hex view', () => {
  it('dumps bytes and notes the cut', () => {
    const out = run('hex', bin(Array.from({ length: 40 }, (_, i) => 60 + i)), { maxBytes: 16 });
    expect(out.kind).toBe('pre');
    if (out.kind === 'pre') {
      expect(out.text).toBe(
        '00000000  3c 3d 3e 3f 40 41 42 43 44 45 46 47 48 49 4a 4b  |<=>?@ABCDEFGHIJK|',
      );
      expect(out.note).toContain('16 von 40');
    }
  });
  it('encodes text as UTF-8 bytes', () => {
    const out = run('hex', text('é'));
    expect(out).toMatchObject({ kind: 'pre' });
    expect((out as { text: string }).text).toContain('c3 a9');
  });
});

describe('JSON, XML and SQL', () => {
  it('pretty-prints JSON without touching numbers, strings or key order', () => {
    const src =
      '{"b":12345678901234567890.0e0,"a":[1,2,{"x":"\\u00e9 \\"q\\" , : {}"}],"e":{},"f":[]}';
    const out = prettyJson(src);
    expect(out.ok && out.text).toBe(
      '{\n  "b": 12345678901234567890.0e0,\n  "a": [\n    1,\n    2,\n    {\n      "x": "\\u00e9 \\"q\\" , : {}"\n    }\n  ],\n  "e": {},\n  "f": []\n}',
    );
    if (out.ok) expect(JSON.parse(out.text)).toEqual(JSON.parse(src));
  });
  it('rejects invalid, deep and huge JSON without echoing it', () => {
    expect(checkJson('{"a":')).toEqual({ ok: false, reason: 'invalid_json' });
    expect(checkJson('['.repeat(300) + ']'.repeat(300))).toEqual({ ok: false, reason: 'too_deep' });
    expect(checkJson('"' + 'x'.repeat(1_100_000) + '"')).toEqual({
      ok: false,
      reason: 'too_large',
    });
    expect(checkJson('{"a":1}{')).toEqual({ ok: false, reason: 'invalid_json' });
    expect(run('json', text('{"a":')).kind).toBe('raw');
  });
  it('indents well-formed XML and treats markup in values as text', () => {
    const out = prettyXml(
      '<?xml version="1.0"?><a x="1"><b>t &lt;script&gt;</b><c/><d><e>1</e></d><!-- n --></a>',
    );
    expect(out.ok && out.text).toBe(
      '<?xml version="1.0"?>\n<a x="1">\n  <b>t &lt;script&gt;</b>\n  <c/>\n  <d>\n    <e>1</e>\n  </d>\n  <!-- n -->\n</a>',
    );
  });
  it('refuses DOCTYPE, entity tricks, bad nesting, duplicates, several roots and depth bombs', () => {
    const bad = [
      '<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>',
      '<a>&undefined;</a>',
      '<a><b></a></b>',
      '<a x="1" x="2"/>',
      '<a/><b/>',
      '<a>',
      'text',
      '<a x=1/>',
      '<a x="<"/>',
      '<a>]]></a>',
      '<1a/>',
      '<a><![CDATA[x</a>',
    ];
    for (const x of bad) expect(checkXml(x).ok, x).toBe(false);
    expect(checkXml('<!DOCTYPE a><a/>')).toEqual({ ok: false, reason: 'doctype' });
    expect(checkXml('<a>'.repeat(300) + '</a>'.repeat(300))).toEqual({
      ok: false,
      reason: 'too_deep',
    });
    expect(checkXml('<a><![CDATA[<b>]]></a>').ok).toBe(true);
  });
  it('formats SQL when safe and shows the original otherwise; open strings are invalid', () => {
    const out = prettySql('select a,b from t where x=1', 'sqlite');
    expect(out.ok && out.text).toContain('\n');
    expect(prettySql("select 'oops", 'sqlite')).toEqual({ ok: false, reason: 'invalid_sql' });
    expect(run('sql', text("select 'oops")).kind).toBe('raw');
  });
});

describe('input editors', () => {
  it('validate without changing the text', () => {
    expect(validateInput('json_editor', '{"a":1}', {}, ctx)).toBeNull();
    expect(validateInput('json_editor', '{a:1}', {}, ctx)).toBe('invalid_json');
    expect(validateInput('xml_editor', '<a/>', {}, ctx)).toBeNull();
    expect(validateInput('xml_editor', '<!DOCTYPE a><a/>', {}, ctx)).toBe('doctype');
    expect(validateInput('sql_editor', 'select 1', {}, ctx)).toBeNull();
    expect(validateInput('sql_editor', '/* open', {}, ctx)).toBe('invalid_sql');
    expect(validateInput('regex_validation', 'ab12', { pattern: '[a-z]+\\d+' }, ctx)).toBeNull();
    expect(validateInput('regex_validation', 'ab12x', { pattern: '[a-z]+\\d+' }, ctx)).toBe(
      'no_match',
    );
    expect(validateInput('regex_validation', 'x', { pattern: '(' }, ctx)).toBe('bad_pattern');
    expect(
      validateInput('regex_validation', 'a'.repeat(5000) + '!', { pattern: '(a+)+$' }, ctx),
    ).toBe('no_match');
  });
  it('previews pretty text and nothing for invalid input', () => {
    expect(previewInput('json_editor', '[1,2]', ctx)).toBe('[\n  1,\n  2\n]');
    expect(previewInput('json_editor', '[1,', ctx)).toBeNull();
    expect(previewInput('regex_validation', 'x', ctx)).toBeNull();
  });
});

describe('options and totality', () => {
  it('sanitizes options from storage: types, bounds, unknown keys, control characters, prototypes', () => {
    const o = sanitizeOptions('truncate', {
      start: -5,
      length: 1e9,
      ellipsis: 'x\u0000y\u0007'.repeat(10),
      extra: 'no',
      __proto__: { polluted: true },
    });
    expect(o).toEqual({ start: 0, length: 1000, ellipsis: 'xyxyxyxyxy' });
    expect(sanitizeOptions('datetime', { dateStyle: 'weird', zone: 3 })).toMatchObject({
      dateStyle: 'medium',
      zone: 'utc',
    });
    expect(sanitizeOptions('link', 'not an object')).toEqual({ prefix: '', suffix: '' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('never throws and never returns markup for hostile values in any transformation', () => {
    const values: DisplayCell[] = [
      text('<img src=x onerror=alert(1)>'),
      text('"><svg/onload=alert(1)>'),
      text('\u0000‮\ud800'),
      text('a'.repeat(2_000_000)),
      bin([0, 255, 128]),
      { kind: 'binary', value: '!!!notbase64' },
      { kind: 'integer', value: '-0' },
      { kind: 'float', value: 'NaN' },
      { kind: 'null' },
      { kind: 'text' },
    ];
    for (const spec of DISPLAY)
      for (const cell of values) {
        const out = applyDisplay(
          spec.id,
          cell,
          { ...defaultOptions(spec.id), pattern: 'a', term: 'a' },
          ctx,
        );
        expect(['text', 'pre', 'link', 'marked', 'image', 'raw']).toContain(out.kind);
        if (out.kind === 'link') expect(out.href).toMatch(/^https?:\/\//);
      }
  });
  it('leaves the cell value untouched', () => {
    const cell = text(' {"a": 1} ');
    const before = JSON.stringify(cell);
    for (const spec of DISPLAY) applyDisplay(spec.id, cell, defaultOptions(spec.id), ctx);
    expect(JSON.stringify(cell)).toBe(before);
  });
});
