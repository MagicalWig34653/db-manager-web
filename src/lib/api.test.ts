// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ApiClient, ApiError, toConnection, validatePayload } from './api';
import { createGateway } from './gateway';
import { emptyConnection, displayCell, selectObject } from './workbench';
import provenance from './contract/provenance.json';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const draft = { ...emptyConnection(), database: 'synthetic' };
const cap = {
  contract_version: '0.1.0',
  drivers: ['sqlite'],
  credential_storage: false,
  max_rows: 10000,
  max_timeout_ms: 60000,
};

describe('frozen contract and typed values', () => {
  it('pins the exact independently approved contract bytes', () => {
    const bytes = readFileSync('src/lib/contract/api-v0.1.0.json');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(provenance.sha256);
    expect(provenance.sha256).toBe(
      '4b598dc69a1904685e67a717997412654440ac10f47c17f7a025ccd114e294be',
    );
  });
  it('keeps empty strings, NULL and large numbers distinct', () => {
    expect(
      displayCell(validatePayload('Cell', { kind: 'integer', value: '9007199254740993123456789' })),
    ).toBe('9007199254740993123456789');
    expect(displayCell({ kind: 'text', value: '' })).toBe('');
    expect(displayCell({ kind: 'null' })).toBe('NULL');
    expect(displayCell({ kind: 'boolean', value: 'true' })).toBe('true');
    expect(() => validatePayload('Cell', { kind: 'integer', value: 9007199254740992 })).toThrow(
      ApiError,
    );
    expect(() => validatePayload('Cell', { kind: 'null', value: '' })).toThrow(ApiError);
  });
  it('rejects null options and unsafe SQLite aliases without changing the schema', () => {
    expect(() =>
      validatePayload('QueryRequest', {
        connection: { driver: 'sqlite', database: 'synthetic' },
        sql: 'SELECT 1',
        max_rows: null,
      }),
    ).toThrow(ApiError);
    expect(() =>
      validatePayload('Connection', { driver: 'sqlite', database: '../outside' }),
    ).toThrow(ApiError);
    expect(toConnection(draft)).toEqual({ driver: 'sqlite', database: 'synthetic' });
    expect(toConnection({ ...draft, driver: 'mysql' }).tls_mode).toBe('verify-full');
    expect(toConnection({ ...draft, driver: 'postgresql' }).driver).toBe('postgres');
  });
  it('quotes identifiers as data while preparing a query without executing it', () => {
    expect(selectObject({ name: 'a"b', schema: 'main', type: 'table' }, 'sqlite')).toBe(
      'SELECT * FROM "main"."a""b";',
    );
    expect(selectObject({ name: 'a`b', type: 'table' }, 'mysql')).toBe('SELECT * FROM `a``b`;');
  });
});

describe('API transport', () => {
  it('sends secrets only in a header and POST body, without cookies or cache', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ status: 'ok' }));
    await new ApiClient(fetcher).test(
      toConnection({ ...draft, driver: 'mysql', password: 'synthetic-password' }),
      'synthetic-token',
    );
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('/api/v1/connections/test');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer synthetic-token' });
    expect(init).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
    expect(JSON.parse(String(init?.body)).connection.password).toBe('synthetic-password');
  });
  it('never displays raw backend error messages which might contain credentials', async () => {
    const client = new ApiClient(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          json(
            { error: { code: 'database_error', message: 'password=synthetic-private-value' } },
            422,
          ),
        ),
    );
    await expect(client.test(toConnection(draft), '')).rejects.toThrow('Prüfe Verbindung');
    await expect(client.test(toConnection(draft), '')).rejects.not.toThrow(
      'synthetic-private-value',
    );
  });
  it('makes authentication failures actionable', async () => {
    const client = new ApiClient(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          json({ error: { code: 'unauthorized', message: 'Anmeldung erforderlich.' } }, 401),
        ),
    );
    await expect(client.capabilities('bad-token')).rejects.toThrow('Backend-Zugang');
  });
  it('rejects malformed successful replies and network failures honestly', async () => {
    const bad = new ApiClient(vi.fn<typeof fetch>().mockResolvedValue(json({ tables: null })));
    await expect(bad.catalog(toConnection(draft), '')).rejects.toThrow('ungültige Antwort');
    const offline = new ApiClient(
      vi.fn<typeof fetch>().mockRejectedValue(new Error('private-host')),
    );
    await expect(offline.capabilities('')).rejects.toThrow('nicht erreichbar');
  });
  it('propagates cancellation and does not report success', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      controller.abort();
      throw init?.signal?.reason;
    });
    await expect(
      new ApiClient(fetcher).query(
        { connection: toConnection(draft), sql: 'SELECT 1' },
        '',
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('uses explicit tagged response values and preserves truncation and multiple resultsets', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        duration_ms: 3,
        results: [
          {
            columns: [{ name: 'n', database_type: 'BIGINT' }],
            rows: [[{ kind: 'integer', value: '9007199254740993123' }]],
            truncated: true,
          },
          { columns: [], rows: [], truncated: false, rows_affected: '9007199254740993123' },
        ],
      }),
    );
    const result = await createGateway(new ApiClient(fetcher)).execute(
      draft,
      '',
      'SELECT 1',
      { maxRows: 100, timeoutMs: 10000 },
      new AbortController().signal,
    );
    expect(result.results[0].rows[0][0].value).toBe('9007199254740993123');
    expect(result.results[0].truncated).toBe(true);
    expect(result.results[1].affectedRows).toBe('9007199254740993123');
  });
  it('refuses unadvertised drivers before sending credentials to the DB endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ ...cap, drivers: [] }));
    await expect(createGateway(new ApiClient(fetcher)).test(draft, 'token')).rejects.toThrow(
      'nicht verfügbar',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/capabilities');
  });
  it('rejects rows with mismatched columns', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        duration_ms: 1,
        results: [{ columns: [], rows: [[{ kind: 'null' }]], truncated: false }],
      }),
    );
    await expect(
      createGateway(new ApiClient(fetcher)).execute(
        draft,
        '',
        'SELECT 1',
        { maxRows: 100, timeoutMs: 10000 },
        new AbortController().signal,
      ),
    ).rejects.toThrow('Spalten');
  });
});
