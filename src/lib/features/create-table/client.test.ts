// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '$lib/api';
import { CreateClient, createErrorMessage } from './client';
import { buildRequest, newColumn } from './model';
import { createCapabilities, createResult, errorBody } from '../../../../tests/fixtures/create';

const json = { 'Content-Type': 'application/json' };
const request = () =>
  buildRequest(
    {
      schema: '',
      name: 'odd"name',
      columns: [{ ...newColumn(), name: 'id', kind: 'int64', nullable: false }],
      primaryKey: [],
    },
    { driver: 'sqlite', database: 'synthetic' },
  );
function clientWith(handler: (path: string, init?: RequestInit) => Promise<Response>) {
  const fetcher = vi.fn(handler);
  return { fetcher, client: new CreateClient(new ApiClient(fetcher as unknown as typeof fetch)) };
}

describe('CreateClient.capabilities', () => {
  it('accepts the 0.6 capability document', async () => {
    const { client, fetcher } = clientWith(
      async () => new Response(JSON.stringify(createCapabilities), { headers: json }),
    );
    await expect(client.capabilities('tok')).resolves.toMatchObject({ contract_version: '0.6.0' });
    expect(fetcher.mock.calls[0][0]).toBe('/api/v6/capabilities');
  });
  it('maps 404, a missing feature and an invalid document to unsupported_feature', async () => {
    for (const make of [
      () => new Response(JSON.stringify(errorBody('x')), { status: 404, headers: json }),
      () =>
        new Response(JSON.stringify({ ...createCapabilities, features: [] }), { headers: json }),
      () => new Response(JSON.stringify({ contract_version: '0.5.0' }), { headers: json }),
    ]) {
      const { client } = clientWith(async () => make());
      await expect(client.capabilities('tok')).rejects.toMatchObject({
        code: 'unsupported_feature',
      });
    }
  });
});

describe('CreateClient.create', () => {
  it('posts exactly one authenticated request with confirm:true and validates the result', async () => {
    const dispatched = vi.fn();
    const { client, fetcher } = clientWith(
      async () =>
        new Response(JSON.stringify(createResult('transactional', 'odd"name')), { headers: json }),
    );
    const result = await client.create(request(), 'tok', dispatched);
    expect(result.structure_check).toBe('transactional');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [path, init] = fetcher.mock.calls[0];
    expect(path).toBe('/api/v6/tables/create');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    const body = JSON.parse(String(init?.body));
    expect(body.confirm).toBe(true);
    expect(body.table.name).toBe('odd"name');
    expect(dispatched).toHaveBeenCalledOnce();
  });
  it.each(['transactional', 'observed', 'different', 'unavailable'] as const)(
    'accepts structure_check %s',
    async (check) => {
      const { client } = clientWith(
        async () => new Response(JSON.stringify(createResult(check)), { headers: json }),
      );
      const result = await client.create(request(), 'tok');
      expect(result.structure_check).toBe(check);
      expect('actual_description' in result).toBe(check !== 'unavailable');
    },
  );
  it('rejects a contradictory result (snapshot_atomic for observed) as outcome_unknown', async () => {
    const { client } = clientWith(
      async () =>
        new Response(JSON.stringify({ ...createResult('observed'), snapshot_atomic: true }), {
          headers: json,
        }),
    );
    await expect(client.create(request(), 'tok')).rejects.toMatchObject({
      code: 'outcome_unknown',
    });
  });
  it('reports 409 as create_conflict without retrying', async () => {
    const { client, fetcher } = clientWith(
      async () =>
        new Response(JSON.stringify(errorBody('create_conflict')), { status: 409, headers: json }),
    );
    const failure = await client.create(request(), 'tok').catch((e) => e);
    expect(failure.code).toBe('create_conflict');
    expect(createErrorMessage(failure)).toContain('nicht verändert');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('reports 503 outcome_unknown, lost responses and transport errors as unknown, never retrying', async () => {
    const cases: (() => Promise<Response>)[] = [
      async () =>
        new Response(JSON.stringify(errorBody('outcome_unknown')), { status: 503, headers: json }),
      async () => {
        throw new TypeError('network');
      },
      async () =>
        new Response('<html>bad gateway</html>', {
          status: 502,
          headers: { 'Content-Type': 'text/html' },
        }),
    ];
    for (const handler of cases) {
      const { client, fetcher } = clientWith(handler);
      const failure = await client.create(request(), 'tok').catch((e) => e);
      expect(failure.code).toBe('outcome_unknown');
      expect(createErrorMessage(failure)).toContain('Nicht erneut senden');
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it('keeps validation errors as definite, German code-based messages', async () => {
    const { client } = clientWith(
      async () =>
        new Response(JSON.stringify(errorBody('invalid_create')), { status: 400, headers: json }),
    );
    const failure = await client.create(request(), 'tok').catch((e) => e);
    expect(failure.code).toBe('invalid_create');
    expect(createErrorMessage(failure)).toContain('abgewiesen');
  });
  it('never sends a request that violates the contract', async () => {
    const { client, fetcher } = clientWith(async () => new Response('{}', { headers: json }));
    const bad = { ...request(), confirm: false } as never;
    await expect(client.create(bad, 'tok')).rejects.toMatchObject({ code: 'invalid_create' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
