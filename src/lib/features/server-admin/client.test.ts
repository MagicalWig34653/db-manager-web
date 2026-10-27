// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '$lib/api';
import * as validators from '$lib/contract/v17/validators.js';
import { emptyConnection } from '$lib/workbench';
import { ServerAdminClient, errorMessage } from './client';
import { capabilities, result, statusRows } from './testing';
import { consistent, formatSeconds, scopesFor, shownValue, supportOf, utf8Bytes } from './model';

const connection = { ...emptyConnection(), driver: 'mysql' as const, database: 'app', host: 'h' };
const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function clientWith(handler: (url: string, init: RequestInit) => Response) {
  const fetcher = vi.fn(async (url: string, init: RequestInit) => handler(url, init));
  return {
    fetcher,
    client: new ServerAdminClient(new ApiClient(fetcher as unknown as typeof fetch)),
  };
}

describe('contract fixtures (copied from the backend)', () => {
  const dir = 'src/lib/features/server-admin/fixtures';
  const files = readdirSync(dir).filter((name) => name.endsWith('.json'));
  const schemas: Record<string, keyof typeof validators | undefined> = {
    ServerAdminCapabilities: 'ServerAdminCapabilities',
    ServerAdminReadRequest: 'ServerAdminReadRequest',
    ServerAdminReadResult: 'ServerAdminReadResult',
  };
  it.each(files.filter((name) => schemas[name.split('.')[0]]))('%s', (name) => {
    const validate = validators[schemas[name.split('.')[0]]!] as (value: unknown) => boolean;
    const valid = validate(JSON.parse(readFileSync(`${dir}/${name}`, 'utf8')));
    expect(valid).toBe(!name.includes('.invalid.'));
  });
});

describe('ServerAdminClient', () => {
  it('posts the documented body to /api/v17/<kind> with the bearer token', async () => {
    const { client, fetcher } = clientWith(() =>
      respond(200, result('variables', { limit: 50, offset: 100, scope: 'GLOBAL' })),
    );
    await client.read('variables', connection, 'tok', {
      limit: 50,
      offset: 100,
      filter: 'max',
      scope: 'GLOBAL',
    });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('/api/v17/variables');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ limit: 50, offset: 100, filter: 'max', scope: 'GLOBAL' });
    expect(body.connection.driver).toBe('mysql');
  }, 10000);

  it('sends scope only for variables and omits empty optional fields', async () => {
    const { client, fetcher } = clientWith(() => respond(200, result('status')));
    await client.read('status', connection, 'tok', { scope: 'GLOBAL', filter: '' });
    const body = JSON.parse(fetcher.mock.calls[0][1].body as string);
    expect(body).not.toHaveProperty('scope');
    expect(body).not.toHaveProperty('filter');
    expect(body).not.toHaveProperty('offset');
  });

  it('refuses an oversized filter before any request is sent', async () => {
    const { client, fetcher } = clientWith(() => respond(200, result('status')));
    await expect(
      client.read('status', connection, 'tok', { filter: 'x'.repeat(129) }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects answers that break the contract or do not match the request', async () => {
    const cases = [
      result('processes'), // wrong kind
      result('status', { driver: 'postgres' }),
      result('status', { offset: 100 }),
      result('status', { values: [{ name: 'X', value: '1', masked: true }] }), // masked with a value
      result('status', {
        processes: [{ id: '1', user: 'u', database: 'd', seconds: 0, self: false }],
      }),
      { ...result('status'), unexpected: true },
    ];
    for (const payload of cases) {
      const { client } = clientWith(() => respond(200, payload));
      await expect(client.read('status', connection, 'tok')).rejects.toMatchObject({
        code: 'invalid_response',
      });
    }
  });

  it('maps HTTP errors to localized, code-preserving ApiErrors', async () => {
    const error = (code: string) => ({ error: { code, message: 'driver text must not show' } });
    const map: [number, string, string][] = [
      [401, 'unauthorized', 'unauthorized'],
      [422, 'database_error', 'database_error'],
      [408, 'query_canceled', 'query_canceled'],
      [422, 'unsupported_feature', 'unsupported_feature'],
      [400, 'invalid_server_admin', 'invalid_server_admin'],
    ];
    for (const [status, code] of map) {
      const { client } = clientWith(() => respond(status, error(code)));
      const failure = await client.read('status', connection, 'tok').catch((e) => e);
      expect(failure).toBeInstanceOf(ApiError);
      expect(failure.code).toBe(code);
      expect(failure.message).not.toContain('driver text');
      expect(failure.message).toBe(errorMessage(failure));
    }
    const { client } = clientWith(() => new Response('', { status: 404 }));
    await expect(client.capabilities('tok')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('loads and validates capabilities', async () => {
    const { client, fetcher } = clientWith(() => respond(200, capabilities()));
    expect((await client.capabilities('tok')).contract_version).toBe('0.17.0');
    expect(fetcher.mock.calls[0][0]).toBe('/api/v17/capabilities');
    expect(fetcher.mock.calls[0][1].method).toBe('GET');
  });
});

describe('model helpers', () => {
  it('maps drivers and scopes', () => {
    const caps = capabilities();
    expect(supportOf(caps, 'postgresql', 'status').support).toBe('supported');
    expect(supportOf(caps, 'sqlite', 'variables').support).toBe('unsupported');
    expect(scopesFor('postgresql')).toEqual(['SESSION']);
    expect(scopesFor('mysql')).toEqual(['SESSION', 'GLOBAL']);
  });
  it('never exposes a masked value and keeps big counters as strings', () => {
    expect(shownValue({ name: 'a', value: null, masked: true })).toEqual({ kind: 'masked' });
    expect(shownValue({ name: 'a', value: null, masked: false })).toEqual({ kind: 'unknown' });
    expect(shownValue(statusRows[0])).toEqual({ kind: 'value', text: '1234567890123456789' });
  });
  it('checks consistency and measures UTF-8 bytes', () => {
    const expected = { kind: 'status' as const, driver: 'mysql' as const, offset: 0, limit: 0 };
    expect(consistent(result('status'), expected)).toBe(true);
    expect(consistent(result('status', { limit: 1, values: statusRows }), expected)).toBe(false);
    expect(utf8Bytes('ä')).toBe(2);
    expect(formatSeconds(3723)).toBe('1 h 2 min 3 s');
    expect(formatSeconds(5)).toBe('5 s');
  });
});
