// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest';
import { encodeExport, snapshot, MAX_EXPORT_BYTES } from './export';
import type { DisplayResult } from './workbench';
const result = (): DisplayResult => ({
  columns: [
    { name: '=header', type: 'TEXT' },
    { name: '=header', type: 'NUMERIC' },
  ],
  rows: [
    [
      { kind: 'text', value: '=1+2,"\r\nä' },
      { kind: 'decimal', value: '12345678901234567890.12345678901234567890' },
    ],
    [{ kind: 'null' }, { kind: 'text', value: '\\N' }],
    [
      { kind: 'text', value: '' },
      { kind: 'binary', value: 'AP8=' },
    ],
  ],
  truncated: true,
});
const text = (output: ReturnType<typeof encodeExport>) => new TextDecoder().decode(output.bytes);
describe('explicit local result export', () => {
  it('preserves ordered duplicate columns and exact tagged strings with page bounds', () => {
    const output = encodeExport(
      result(),
      { kind: 'table_page', offset: 25, page_size: 25, has_more: true },
      'json',
    );
    const data = JSON.parse(text(output));
    expect(data).toEqual({
      schema_version: 1,
      scope: { kind: 'table_page', offset: 25, page_size: 25, has_more: true },
      truncated: true,
      columns: result().columns,
      rows: result().rows,
    });
    expect(output.filename).toBe('db-manager-result.json');
  });
  it('serializes only an explicit snapshot whitelist, never client or transport fields', () => {
    const input = {
      ...result(),
      sql: 'private-sql',
      token: 'private-token',
      connection: { password: 'private-password' },
      profile: 'private-profile',
    };
    const content = text(encodeExport(input, { kind: 'sql_result' }, 'json'));
    for (const value of [
      'private-sql',
      'private-token',
      'private-password',
      'private-profile',
      'connection',
    ])
      expect(content).not.toContain(value);
    const copy = snapshot(input, { kind: 'sql_result' });
    input.rows[0][0].value = 'changed';
    input.columns[0].name = 'changed';
    expect(copy.rows[0][0].value).toBe('=1+2,"\r\nä');
    expect(copy.columns[0].name).toBe('=header');
  });
  it('quotes CSV raw values without modifying formulas and separates NULL from quoted marker/empty', () => {
    const content = text(encodeExport(result(), { kind: 'sql_result' }, 'csv-raw'));
    expect(content).toBe(
      '"=header","=header"\r\n"=1+2,""\r\nä","12345678901234567890.12345678901234567890"\r\n\\N,"\\N"\r\n"","AP8="\r\n',
    );
    expect(content.charCodeAt(0)).not.toBe(0xfeff);
  });
  it('changes every spreadsheet header and non-NULL value with the disclosed apostrophe prefix', () => {
    const content = text(encodeExport(result(), { kind: 'sql_result' }, 'csv-spreadsheet'));
    expect(content.startsWith('"\'=header","\'=header"\r\n')).toBe(true);
    expect(content).toContain('\\N,"\'\\N"');
    expect(content).toContain('"\'","\'AP8="');
  });
  it('preserves every supported tag without JavaScript numeric conversion', () => {
    const input: DisplayResult = {
      columns: [{ name: 'value', type: '' }],
      rows: ['integer', 'decimal', 'float', 'boolean', 'binary', 'timestamp', 'text'].map(
        (kind) => [{ kind, value: kind === 'integer' ? '9223372036854775807' : 'raw-string' }],
      ),
      truncated: false,
    };
    expect(JSON.parse(text(encodeExport(input, { kind: 'sql_result' }, 'json'))).rows).toEqual(
      input.rows,
    );
  });
  it('enforces the inclusive byte limit on final encoded envelope, quotes, prefixes and CRLF', () => {
    for (const format of ['json', 'csv-raw', 'csv-spreadsheet'] as const) {
      const input: DisplayResult = {
        columns: [{ name: 'value', type: '' }],
        rows: [[{ kind: 'text', value: '' }]],
        truncated: false,
      };
      const overhead = encodeExport(input, { kind: 'sql_result' }, format).bytes.byteLength;
      input.rows[0][0].value = 'x'.repeat(MAX_EXPORT_BYTES - overhead);
      expect(encodeExport(input, { kind: 'sql_result' }, format).bytes.byteLength).toBe(
        MAX_EXPORT_BYTES,
      );
      input.rows[0][0].value += 'ä';
      expect(() => encodeExport(input, { kind: 'sql_result' }, format)).toThrow('8 MiB');
    }
  });
  it('rejects invalid rows or tags without silently repairing values', () => {
    expect(() => snapshot({ ...result(), rows: [[]] }, { kind: 'sql_result' })).toThrow('Spalten');
    expect(() =>
      snapshot(
        {
          columns: [{ name: 'x', type: '' }],
          rows: [[{ kind: 'unknown', value: 'x' }]],
          truncated: false,
        },
        { kind: 'sql_result' },
      ),
    ).toThrow('Zellwert');
  });
});

it('QA-F6-01: rejects C0 except CR/LF, DEL and C1 controls in both CSV variants and headers', () => {
  const codes = [
    ...Array.from({ length: 32 }, (_, index) => index).filter((code) => code !== 10 && code !== 13),
    ...Array.from({ length: 33 }, (_, index) => 127 + index),
  ];
  for (const format of ['csv-raw', 'csv-spreadsheet'] as const)
    for (const code of codes) {
      const input: DisplayResult = {
        columns: [{ name: 'header', type: '' }],
        rows: [[{ kind: 'text', value: String.fromCharCode(code) }]],
        truncated: false,
      };
      expect(() => encodeExport(input, { kind: 'sql_result' }, format)).toThrow('JSON');
      input.columns[0].name = String.fromCharCode(code);
      input.rows[0][0].value = 'ordinary';
      expect(() => encodeExport(input, { kind: 'sql_result' }, format)).toThrow('JSON');
    }
});
it('QA-F6-01: JSON preserves control characters and CSV still preserves CR LF quotes and literal marker', () => {
  const control = '\u0000\u0001\t\r\n"\\N\u007f\u0085';
  const input: DisplayResult = {
    columns: [{ name: control, type: '' }],
    rows: [[{ kind: 'text', value: control }]],
    truncated: false,
  };
  const data = JSON.parse(text(encodeExport(input, { kind: 'sql_result' }, 'json')));
  expect(data.columns[0].name).toBe(control);
  expect(data.rows[0][0].value).toBe(control);
  input.columns[0].name = 'header';
  input.rows[0][0].value = '\r\n"\\N';
  expect(text(encodeExport(input, { kind: 'sql_result' }, 'csv-raw'))).toBe(
    '"header"\r\n"\r\n""\\N"\r\n',
  );
});
