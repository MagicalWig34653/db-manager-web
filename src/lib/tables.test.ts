// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ApiClient } from './api';
import { TableClient, validateTable, prepareFilters, emptyFilter, tableResult } from './tables';
import provenance from './contract/v2/provenance.json';
const connection = { driver: 'sqlite' as const, database: 'synthetic' };
const description = {
  table: { name: 'values' },
  kind: 'table',
  columns: [
    {
      name: 'id',
      database_type: 'BIGINT',
      nullable: false,
      pk_position: 1,
      generated: 'none',
      read_only: true,
    },
  ],
  primary_key: ['id'],
  read_only: true,
  stable_order: true,
  storage_engine: 'sqlite',
  transactional: 'yes',
};
const reply = {
  description,
  result: {
    columns: [{ name: 'id', database_type: 'BIGINT' }],
    rows: [[{ kind: 'integer', value: '9223372036854775807' }]],
    truncated: false,
  },
  offset: 0,
  page_size: 100,
  has_more: false,
  stable_order: true,
  duration_ms: 1,
};
describe('independently frozen table transport', () => {
  it('pins the exact public reviewed schema bytes', () => {
    expect(
      createHash('sha256')
        .update(readFileSync('src/lib/contract/v2/api-v0.2.0.json'))
        .digest('hex'),
    ).toBe(provenance.sha256);
    expect(provenance.sha256).toBe(
      'c15a848f01bb779429fd68a2b6eb6bba1575d3e07a4c68e6796cf7840a661838',
    );
    expect(provenance.source_commit).toBe('427444d7bcb8e30c9563ded2000ec3d5e19646c4');
  });
  it('uses structured names and tagged strings without building SQL', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(reply), { headers: { 'Content-Type': 'application/json' } }),
      );
    const client = new TableClient(new ApiClient(fetcher));
    await client.browse(
      {
        connection,
        table: { name: 'values' },
        filters: [
          {
            column: 'id',
            operator: 'eq',
            value: { kind: 'integer', value: '9223372036854775807' },
          },
        ],
      },
      'synthetic-token',
      new AbortController().signal,
    );
    const [path, request] = fetcher.mock.calls[0];
    expect(path).toBe('/api/v2/tables/browse');
    expect(JSON.parse(request.body).sql).toBeUndefined();
    expect(JSON.parse(request.body).filters[0].value.value).toBe('9223372036854775807');
  });
  it('keeps null operators distinct from tagged empty text and numeric precision', () => {
    expect(
      prepareFilters([{ ...emptyFilter('id'), operator: 'is_null', value: 'ignored' }], ['id']),
    ).toEqual([{ column: 'id', operator: 'is_null' }]);
    expect(prepareFilters([emptyFilter('id')], ['id'])[0].value).toEqual({
      kind: 'text',
      value: '',
    });
    expect(
      prepareFilters(
        [
          {
            ...emptyFilter('id'),
            kind: 'decimal',
            value: '12345678901234567890.12345678901234567890',
          },
        ],
        ['id'],
      )[0].value?.value,
    ).toBe('12345678901234567890.12345678901234567890');
    expect(() =>
      prepareFilters([{ ...emptyFilter('id'), kind: 'integer', value: '1.2' }], ['id']),
    ).toThrow();
    expect(() => prepareFilters([emptyFilter('missing')], ['id'])).toThrow();
  });
  it('rejects null options, invalid condition values and wrong row widths', () => {
    expect(() =>
      validateTable('BrowseRequest', { connection, table: { name: 'values' }, page_size: null }),
    ).toThrow();
    expect(() =>
      validateTable('TableFilter', {
        column: 'id',
        operator: 'is_null',
        value: { kind: 'text', value: '' },
      }),
    ).toThrow();
    const validated = validateTable('BrowseResult', reply);
    expect(tableResult(validated).rows[0][0].value).toBe('9223372036854775807');
    expect(() =>
      tableResult({ ...validated, result: { ...validated.result, rows: [[]] } }),
    ).toThrow();
  });
});
