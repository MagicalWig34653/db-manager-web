// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '$lib/api';
import { emptyConnection } from '$lib/workbench';
import { ImportClient, errorText, isRejection, type Transport } from './client';
import { csvExecuteMetadata, defaultCommon, defaultCsv, planMetadata } from './model';

const fixture = (name: string) =>
  JSON.parse(readFileSync(`src/lib/features/import/fixtures/${name}.json`, 'utf8'));
const connection = { ...emptyConnection(), database: 'synthetic' };
const handlers = () => ({
  signal: new AbortController().signal,
  onDispatch: vi.fn(),
  onProgress: vi.fn(),
  onUploaded: vi.fn(),
});
const request = () =>
  planMetadata(
    connection,
    { schema: 'main', name: 't' },
    { ...defaultCsv(), columns: ['id', 'value'] },
    defaultCommon('csv'),
  );
const job = (extra = {}) => ({
  id: 'a'.repeat(32),
  state: 'running',
  cancel_requested: false,
  progress: { processed: 0, total: 3 },
  ...extra,
});

it('validates and returns a plan and does not send invalid metadata', async () => {
  const transport = vi.fn<Transport>(async () => ({
    status: 200,
    body: fixture('ImportPlan.real-TestSQLiteImportRoundTrip'),
  }));
  const client = new ImportClient(new ApiClient(), transport);
  const plan = await client.plan(request(), new Blob(['x']), 't', handlers());
  expect(plan.rows).toBe(3);
  expect(transport.mock.calls[0][0]).toBe('/api/v18/imports/plan');
  await expect(
    client.plan({ ...request(), csv: { columns: [] } }, new Blob(['x']), 't', handlers()),
  ).rejects.toMatchObject({ code: 'invalid_response' });
  expect(transport).toHaveBeenCalledTimes(1);
});

it('rejects plan answers that break the contract or contradict themselves', async () => {
  const bad = { ...fixture('ImportPlan.real-TestSQLiteImportRoundTrip'), valid_rows: 99 };
  const client = new ImportClient(
    new ApiClient(),
    async () => ({ status: 200, body: bad }) as never,
  );
  await expect(client.plan(request(), new Blob(['x']), 't', handlers())).rejects.toMatchObject({
    code: 'invalid_response',
  });
  const wrong = new ImportClient(new ApiClient(), async () => ({ status: 200, body: { x: 1 } }));
  await expect(wrong.plan(request(), new Blob(['x']), 't', handlers())).rejects.toMatchObject({
    code: 'invalid_response',
  });
});

it('maps error bodies to codes and treats only pre-run refusals as rejections', async () => {
  const client = new ImportClient(new ApiClient(), async () => ({
    status: 409,
    body: { error: { code: 'plan_mismatch', message: 'serverseitiger Text' } },
  }));
  const execute = csvExecuteMetadata(request(), 'b'.repeat(64));
  const failure = await client.execute(execute, new Blob(['x']), 't', handlers()).catch((e) => e);
  expect(failure).toBeInstanceOf(ApiError);
  expect(failure.code).toBe('plan_mismatch');
  expect(failure.message).not.toContain('serverseitiger');
  expect(isRejection(failure)).toBe(true);
  expect(isRejection(new ApiError('network_error', ''))).toBe(false);
  expect(isRejection(new ApiError('outcome_unknown', ''))).toBe(false);
  expect(isRejection(new Error('x'))).toBe(false);
  expect(errorText(new ApiError('weird', ''))).toBe(errorText(new ApiError('failed', '')));
  const hostile = new ImportClient(new ApiClient(), async () => ({
    status: 500,
    body: { error: { code: '<img onerror=x>', message: 'm' } },
  }));
  await expect(hostile.execute(execute, new Blob(['x']), 't', handlers())).rejects.toMatchObject({
    code: 'invalid_response',
  });
});

it('accepts only a 202 job with a matching shape for execute', async () => {
  const execute = csvExecuteMetadata(request(), 'b'.repeat(64));
  const ok = new ImportClient(new ApiClient(), async () => ({ status: 202, body: job() }));
  expect((await ok.execute(execute, new Blob(['x']), 't', handlers())).id).toHaveLength(32);
  const not202 = new ImportClient(new ApiClient(), async () => ({ status: 200, body: job() }));
  await expect(not202.execute(execute, new Blob(['x']), 't', handlers())).rejects.toBeInstanceOf(
    ApiError,
  );
  const badId = new ImportClient(new ApiClient(), async () => ({
    status: 202,
    body: job({ id: 'XYZ' }),
  }));
  await expect(badId.execute(execute, new Blob(['x']), 't', handlers())).rejects.toMatchObject({
    code: 'invalid_response',
  });
});

it('reads job status and cancel with id checks and POST for cancel', async () => {
  const calls: { path: string; method: string }[] = [];
  const fetcher = vi.fn(async (path: string, init: RequestInit) => {
    calls.push({ path, method: init.method ?? 'GET' });
    return new Response(
      JSON.stringify(job({ id: path.includes('/cancel') ? 'c'.repeat(32) : 'a'.repeat(32) })),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  }) as unknown as typeof fetch;
  const client = new ImportClient(new ApiClient(fetcher));
  const signal = new AbortController().signal;
  expect((await client.status('a'.repeat(32), 't', signal)).state).toBe('running');
  expect(calls[0]).toEqual({ path: `/api/v18/imports/${'a'.repeat(32)}`, method: 'GET' });
  await expect(client.cancel('a'.repeat(32), 't', signal)).rejects.toMatchObject({
    code: 'invalid_response',
  });
  expect(calls[1].method).toBe('POST');
  await expect(client.status('../../etc', 't', signal)).rejects.toMatchObject({
    code: 'invalid_response',
  });
  expect(calls).toHaveLength(2);
});

it('rejects a finished job without result and a running job with result', async () => {
  const bad1 = new ImportClient(
    new ApiClient(
      (async () =>
        new Response(JSON.stringify(job({ state: 'finished' })), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    ),
  );
  await expect(
    bad1.status('a'.repeat(32), 't', new AbortController().signal),
  ).rejects.toMatchObject({ code: 'invalid_response' });
  const bad2 = new ImportClient(
    new ApiClient(
      (async () =>
        new Response(JSON.stringify(job({ result: fixture('ImportResult.real-sqlite-skip') })), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    ),
  );
  await expect(
    bad2.status('a'.repeat(32), 't', new AbortController().signal),
  ).rejects.toMatchObject({ code: 'invalid_response' });
});
