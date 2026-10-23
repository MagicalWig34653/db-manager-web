// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ApiClient } from './api';
import { StructureClient, validateStructure, stateLabel, coverageLabel } from './structure';
import { syntheticStructure } from '../../tests/fixtures/structure';

const cap = {
  contract_version: '0.5.0',
  features: ['table_structure'],
  mutations: false,
  max_objects_per_section: 1024,
  max_terms: 8192,
  timeout_ms: 10000,
};
const input = { driver: 'sqlite' as const, database: 'synthetic' };
describe('read-only structure contract and compatibility', () => {
  it('pins exact released contract bytes and namespace-fix backend', () => {
    const provenance = JSON.parse(readFileSync('src/lib/contract/v5/provenance.json', 'utf8'));
    expect(provenance.source_commit).toBe('ac9542d81e6f096626c24bc1e0cb9bccb3a62a7c');
    expect(
      createHash('sha256')
        .update(readFileSync('src/lib/contract/v5/api-v0.5.0.json'))
        .digest('hex'),
    ).toBe('b5225339511d80fe4f52f09118fdad2060d8a92f31d44b73dd89fe9f76178c95');
  });
  it('keeps same-name constraint kinds distinct and orders explicit term positions without mutating source', async () => {
    const requests: { path: string; body: unknown }[] = [];
    const client = new StructureClient(
      new ApiClient(async (path, init) => {
        requests.push({
          path: String(path),
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return new Response(JSON.stringify(requests.length === 1 ? cap : syntheticStructure), {
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    const result = await client.read(
      input,
      syntheticStructure.table,
      'synthetic-token',
      new AbortController().signal,
    );
    expect(result.constraints.map((item) => item.kind)).toEqual(['unique', 'foreign_key', 'check']);
    expect(result.indexes[0].terms.map((term) => term.position)).toEqual([1, 2, 3, 4]);
    expect(syntheticStructure.indexes[0].terms[0].position).toBe(2);
    expect(requests.map((item) => item.path)).toEqual([
      '/api/v5/capabilities',
      '/api/v5/tables/structure',
    ]);
    expect(requests[1].body).toEqual({ connection: input, table: syntheticStructure.table });
    expect(requests[1].body).not.toHaveProperty('sql');
  });
  it('missing v5 routes produce a local compatibility message without a structure POST', async () => {
    let count = 0;
    const client = new StructureClient(
      new ApiClient(async () => {
        count++;
        return new Response('Not Found', { status: 404 });
      }),
    );
    await expect(
      client.read(input, syntheticStructure.table, 'token', new AbortController().signal),
    ).rejects.toMatchObject({ code: 'unsupported_feature' });
    expect(count).toBe(1);
  });
  it('rejects fabricated SQL, contradictory unknown flags and incomplete known metadata', () => {
    expect(() =>
      validateStructure('TableStructure', { ...syntheticStructure, ddl: 'private-definition' }),
    ).toThrow();
    expect(() =>
      validateStructure('TableStructure', { ...syntheticStructure, coverage: null }),
    ).toThrow();
    expect(() =>
      validateStructure('TableStructure', { ...syntheticStructure, indexes: null }),
    ).toThrow();
    const term = syntheticStructure.indexes[0].terms[1];
    expect(() => validateStructure('IndexTerm', { ...term, collation_state: 'unknown' })).toThrow();
    expect(() => validateStructure('IndexTerm', { ...term, collation: null })).toThrow();
    expect(() => validateStructure('IndexTerm', { ...term, prefix_length: undefined })).toThrow();
    expect(() =>
      validateStructure('StructureConstraint', {
        ...syntheticStructure.constraints[0],
        columns_known: false,
      }),
    ).toThrow();
  });
  it('rejects mismatched object identity and duplicate term positions', async () => {
    for (const data of [
      { ...syntheticStructure, table: { name: 'other' } },
      {
        ...syntheticStructure,
        indexes: [
          {
            ...syntheticStructure.indexes[0],
            terms: [syntheticStructure.indexes[0].terms[0], syntheticStructure.indexes[0].terms[0]],
          },
        ],
      },
    ]) {
      let count = 0;
      const client = new StructureClient(
        new ApiClient(
          async () =>
            new Response(JSON.stringify(++count === 1 ? cap : data), {
              headers: { 'Content-Type': 'application/json' },
            }),
        ),
      );
      await expect(
        client.read(input, syntheticStructure.table, 'token', new AbortController().signal),
      ).rejects.toMatchObject({ code: 'invalid_response' });
    }
  });
  it('enforces the aggregate term bound across individually valid index arrays', async () => {
    for (const count of [8, 9]) {
      const data = {
        ...syntheticStructure,
        indexes: Array.from({ length: count }, (_, index) => ({
          ...syntheticStructure.indexes[0],
          name: `index-${index}`,
          terms: Array.from({ length: 1024 }, (_, position) => ({
            ...syntheticStructure.indexes[0].terms[0],
            position: position + 1,
          })),
        })),
      };
      let calls = 0;
      const client = new StructureClient(
        new ApiClient(
          async () =>
            new Response(JSON.stringify(++calls === 1 ? cap : data), {
              headers: { 'Content-Type': 'application/json' },
            }),
        ),
      );
      const request = client.read(
        input,
        syntheticStructure.table,
        'token',
        new AbortController().signal,
      );
      if (count === 8) expect((await request).indexes).toHaveLength(8);
      else await expect(request).rejects.toMatchObject({ code: 'invalid_response' });
    }
  });
  it('never equates unknown or partial coverage with false or completeness', () => {
    expect(stateLabel('unknown')).toBe('Unbekannt');
    expect(stateLabel('no')).toBe('Nein');
    expect(stateLabel('not_applicable')).toBe('Nicht anwendbar');
    expect(coverageLabel('catalog')).toBe('Katalogangaben');
    expect(coverageLabel('partial')).toBe('Teilweise erfasst');
    expect(coverageLabel('unavailable')).toBe('Nicht verfügbar');
  });
});
