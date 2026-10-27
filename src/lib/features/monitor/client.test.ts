// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '$lib/api';
import * as validators from '$lib/contract/v20/validators.js';
import { emptyConnection } from '$lib/workbench';
import { MonitorClient } from './client';
import { capabilities, result } from './testing';

const connection = { ...emptyConnection(), driver: 'mysql' as const, database: 'app', host: 'h' };
const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function clientWith(handler: (url: string, init: RequestInit) => Response) {
  const fetcher = vi.fn(async (url: string, init: RequestInit) => handler(url, init));
  return {
    fetcher,
    client: new MonitorClient(new ApiClient(fetcher as unknown as typeof fetch)),
  };
}

describe('contract fixtures (copied from the backend)', () => {
  const dir = 'src/lib/features/monitor/fixtures';
  const schemas = ['MonitorRequest', 'MonitorResult'] as const;
  const files = readdirSync(dir).filter(
    (name) => name.endsWith('.json') && schemas.includes(name.split('.')[0] as never),
  );
  it.each(files)('%s', (name) => {
    const validate = validators[name.split('.')[0] as (typeof schemas)[number]] as (
      value: unknown,
    ) => boolean;
    const valid = validate(JSON.parse(readFileSync(`${dir}/${name}`, 'utf8')));
    expect(valid).toBe(!name.includes('.invalid.'));
  });
});

it('rejects a record that carries a secret-like field', () => {
  const record = JSON.parse(
    readFileSync(
      `${'src/lib/features/monitor/fixtures'}/MonitorRecord.secret.invalid.json`,
      'utf8',
    ),
  );
  expect(validators.MonitorResult(result('sample', [record]))).toBe(false);
});

describe('MonitorClient', () => {
  it('posts to /api/v20/monitor/<action> with only the supported fields', async () => {
    const { client, fetcher } = clientWith(() =>
      respond(200, result('binary-events', [], { limit: 25 })),
    );
    await client.run('binary-events', connection, 'tok', {
      limit: 25,
      log: 'bin.000001',
      position: 4,
    });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('/api/v20/monitor/binary-events');
    expect(JSON.parse(init.body as string)).toMatchObject({
      limit: 25,
      log: 'bin.000001',
      position: 4,
    });
    expect(JSON.parse(init.body as string)).not.toHaveProperty('offset');
  });

  it('refuses a malformed log name or oversized SQL before sending', async () => {
    const { client, fetcher } = clientWith(() => respond(200, result('binary-events')));
    await expect(
      client.run('binary-events', connection, 'tok', { log: '../etc/passwd' }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(
      client.run('profiling', connection, 'tok', { sql: 'x'.repeat(16385) }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('treats a mismatching or unexpected answer as invalid', async () => {
    for (const payload of [
      result('engines'),
      { ...result('sample'), secret: 'x' },
      result('sample', [{ questions: 'abc' }]),
    ]) {
      const { client } = clientWith(() => respond(200, payload));
      await expect(client.run('sample', connection, 'tok')).rejects.toMatchObject({
        code: 'invalid_response',
      });
    }
  });

  it('turns authentication and rights errors into errors, not into "unavailable"', async () => {
    for (const [status, code] of [
      [401, 'unauthorized'],
      [422, 'database_error'],
      [400, 'invalid_monitor'],
    ] as const) {
      const { client } = clientWith(() =>
        respond(status, { error: { code, message: 'raw driver text' } }),
      );
      const failure = await client.run('replication', connection, 'tok').catch((e) => e);
      expect(failure).toBeInstanceOf(ApiError);
      expect(failure.code).toBe(code);
      expect(failure.message).not.toContain('raw driver text');
    }
  });

  it('passes an "unavailable" answer through as data', async () => {
    const { client } = clientWith(() =>
      respond(
        200,
        result('analysis', [], { state: 'unavailable', reason: 'Keine Rechte.', source: 'none' }),
      ),
    );
    expect((await client.run('analysis', connection, 'tok')).state).toBe('unavailable');
  });

  it('reads capabilities from /api/v20/capabilities', async () => {
    const { client, fetcher } = clientWith(() => respond(200, capabilities()));
    await client.capabilities('tok');
    expect(fetcher.mock.calls[0][0]).toBe('/api/v20/capabilities');
  });
});
