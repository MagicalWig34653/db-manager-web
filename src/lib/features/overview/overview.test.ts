// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '$lib/api';
import { emptyConnection } from '$lib/workbench';
import provenance from '$lib/contract/v7/provenance.json';
import {
  OverviewClient,
  arrangeObjects,
  driverCapability,
  formatBytes,
  formatDuration,
  rowsDisplay,
  validate,
  type ObjectInfo,
  type OverviewCapabilities,
} from './client';

const dir = 'src/lib/features/overview/fixtures';
const fixture = (name: string) => JSON.parse(readFileSync(`${dir}/${name}`, 'utf8'));
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const connection = { ...emptyConnection(), database: 'synthetic' };

describe('vendored contract 0.7.0', () => {
  it('matches the independently reviewed bytes', () => {
    const bytes = readFileSync('src/lib/contract/v7/api-v0.7.0.json');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(provenance.sha256);
    expect(provenance.sha256).toBe(
      'c6fd8c91315e25185d949d309397c7c0d80cc67fcab87ae521e38068e7004d17',
    );
  });
  it('accepts every valid fixture and rejects every invalid one', () => {
    const names = readdirSync(dir).filter((name) => name.endsWith('.json'));
    expect(names.length).toBe(32);
    for (const name of names) {
      const schema = name.split('.')[0] as Parameters<typeof validate>[0];
      const ok = () => validate(schema, fixture(name));
      if (name.includes('.invalid.')) expect(ok, name).toThrow();
      else expect(ok, name).not.toThrow();
    }
  });
});

describe('formatting and arrangement', () => {
  const rows = (state: 'estimated' | 'exact' | 'unknown', value: number | null) => ({
    value,
    state,
  });
  const object = (name: string, kind: string, over: Partial<ObjectInfo> = {}): ObjectInfo => ({
    schema: 'main',
    name,
    kind,
    rows: rows('estimated', 1),
    engine: null,
    collation: null,
    size_bytes: null,
    comment: null,
    ...over,
  });
  it('never shows an estimate as exact and keeps unknown empty', () => {
    expect(rowsDisplay(rows('estimated', 1234))).toEqual({ text: '1.234', state: 'estimated' });
    expect(rowsDisplay(rows('exact', 3))).toEqual({ text: '3', state: 'exact' });
    expect(rowsDisplay(rows('unknown', null))).toEqual({ text: '', state: 'unknown' });
  });
  it('formats sizes and durations', () => {
    expect(formatBytes(null)).toBe('');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(16384)).toBe('16 KiB');
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe('5 GiB');
    expect(formatDuration(90061)).toBe('1 d 1 h 1 min');
    expect(formatDuration(null)).toBe('');
  });
  it('filters by kind and name, sorts stably and puts unknown values last', () => {
    const list = [
      object('b_view', 'view', { rows: rows('unknown', null) }),
      object('a_table', 'table', { rows: rows('exact', 9), size_bytes: 10 }),
      object('c_table', 'table', { rows: rows('estimated', 2), size_bytes: 20 }),
      object('d_virtual', 'virtual'),
    ];
    const names = (items: ObjectInfo[]) => items.map((o) => o.name);
    expect(names(arrangeObjects(list, { text: '', kind: 'all' }, 'name', false))).toEqual([
      'a_table',
      'b_view',
      'c_table',
      'd_virtual',
    ]);
    expect(names(arrangeObjects(list, { text: '', kind: 'table' }, 'name', false))).toEqual([
      'a_table',
      'c_table',
    ]);
    expect(names(arrangeObjects(list, { text: '', kind: 'view' }, 'name', false))).toEqual([
      'b_view',
    ]);
    expect(names(arrangeObjects(list, { text: '', kind: 'other' }, 'name', false))).toEqual([
      'd_virtual',
    ]);
    expect(names(arrangeObjects(list, { text: 'TABLE', kind: 'all' }, 'name', false))).toEqual([
      'a_table',
      'c_table',
    ]);
    expect(names(arrangeObjects(list, { text: '', kind: 'all' }, 'rows', true))).toEqual([
      'a_table',
      'c_table',
      'd_virtual',
      'b_view',
    ]);
    expect(
      names(arrangeObjects(list, { text: '', kind: 'all' }, 'size', false)).slice(0, 2),
    ).toEqual(['a_table', 'c_table']);
    expect(list[0].name).toBe('b_view');
  });
});

describe('OverviewClient', () => {
  const caps: OverviewCapabilities = {
    contract_version: '0.7.0',
    features: ['databases', 'objects', 'definition', 'server_info'],
    mutations: false,
    drivers: {
      sqlite: {
        databases: { support: 'limited', reason: 'Nur die eigene Datenbank.' },
        objects: { support: 'supported' },
        definition: { support: 'supported' },
        server_info: { support: 'supported' },
        exact_rows: { support: 'supported' },
      },
      mysql: {
        databases: { support: 'supported' },
        objects: { support: 'supported' },
        definition: { support: 'supported' },
        server_info: { support: 'supported' },
        exact_rows: { support: 'supported' },
      },
      postgres: {
        databases: { support: 'supported' },
        objects: { support: 'supported' },
        definition: { support: 'limited', reason: 'Rekonstruiert.' },
        server_info: { support: 'supported' },
        exact_rows: { support: 'unsupported', reason: 'Nein.' },
      },
    },
    default_limit: 200,
    max_limit: 1000,
    max_offset: 1000000,
    max_exact_objects: 100,
    default_timeout_ms: 10000,
    max_timeout_ms: 30000,
    max_list_items: 1000,
    max_definition_bytes: 1048576,
    max_request_bytes: 1048576,
  };
  it('maps the PostgreSQL draft driver to the contract key', () => {
    expect(
      driverCapability(caps, { ...connection, driver: 'postgresql' }, 'exact_rows').support,
    ).toBe('unsupported');
    expect(driverCapability(caps, connection, 'databases').reason).toBe(
      'Nur die eigene Datenbank.',
    );
  });
  it('posts the connection in the body only and sends optional fields conditionally', async () => {
    const fetcher = vi.fn(async () => json(fixture('ObjectsResult.sqlite-objects.json')));
    const client = new OverviewClient(new ApiClient(fetcher as unknown as typeof fetch));
    await client.objects({ ...connection, password: 'secret-pw' }, 'tok', {
      exactRows: true,
      limit: 100,
      timeoutMs: 8000,
    });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v7/objects');
    expect(url).not.toMatch(/secret|tok/);
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ exact_rows: true, limit: 100, timeout_ms: 8000 });
    expect(body).not.toHaveProperty('schema');
    expect(body).not.toHaveProperty('offset');
  });
  it('rejects malformed answers instead of showing them', async () => {
    const bad = fixture('ObjectsResult.bad-row-state.invalid.json');
    const client = new OverviewClient(
      new ApiClient((async () => json(bad)) as unknown as typeof fetch),
    );
    await expect(client.objects(connection, 'tok')).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
  it('explains the new error codes and a backend without API 0.7', async () => {
    const reject = (status: number, code: string) =>
      new OverviewClient(
        new ApiClient((async () =>
          json({ error: { code, message: 'x' } }, status)) as unknown as typeof fetch),
      );
    await expect(
      reject(404, 'object_not_found').definition(connection, 'tok', { name: 'x' }),
    ).rejects.toMatchObject({
      code: 'object_not_found',
      message: expect.stringContaining('nicht sichtbar'),
    });
    await expect(reject(400, 'invalid_overview').objects(connection, 'tok')).rejects.toMatchObject({
      code: 'invalid_overview',
      message: expect.stringContaining('Schemaname'),
    });
    await expect(reject(404, 'x').capabilities('tok')).rejects.toMatchObject({
      code: 'unsupported_feature',
    });
  });
});
