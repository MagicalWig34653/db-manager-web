// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '$lib/api';
import { ProgramsClient, errorMessage } from './client';
import { capabilities, listing, plan, program, result } from './testing';
import type { Change } from './model';
const change: Change = {
  connection: { driver: 'sqlite', database: 'fixture' },
  action: 'create',
  object: { kind: 'view', name: 'v' },
  input: { body: 'SELECT 1' },
};
const executeBody = {
  ...change,
  confirm: { action: 'create' as const },
  expected_plan_sha256: plan().plan_sha256,
};
afterEach(() => vi.restoreAllMocks());
it('validates capabilities and all read responses', async () => {
  const api = new ApiClient();
  const request = vi.spyOn(api, 'requestRaw');
  const client = new ProgramsClient(api);
  request.mockResolvedValueOnce(capabilities());
  expect((await client.capabilities('token')).contract_version).toBe('0.16.0');
  for (const read of [
    () => client.capabilities('token'),
    () => client.list({ connection: change.connection }, 'token'),
    () => client.describe({ connection: change.connection, object: change.object }, 'token'),
    () => client.plan(change, 'token'),
  ]) {
    request.mockResolvedValueOnce({ definition: '<b>invalid</b>' });
    await expect(read()).rejects.toMatchObject({ code: 'invalid_response' });
  }
});
it('treats malformed and network answers after dispatch as unknown without retry', async () => {
  for (const answer of ['invalid', 'network']) {
    const api = new ApiClient();
    const request = vi
      .spyOn(api, 'requestRaw')
      .mockImplementation(async (_path, _token, _body, _signal, write) => {
        write?.onDispatch();
        if (answer === 'network') throw new ApiError('network_error', 'raw');
        return {};
      });
    const client = new ProgramsClient(api);
    const dispatch = vi.fn();
    await expect(client.execute(executeBody, 'token', dispatch)).rejects.toMatchObject({
      code: 'outcome_unknown',
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
  }
});
it('keeps definite rejection and pre-dispatch errors separate from unknown commits', async () => {
  const api = new ApiClient();
  const request = vi.spyOn(api, 'requestRaw');
  const client = new ProgramsClient(api);
  request.mockRejectedValueOnce(new ApiError('request_too_large', 'raw'));
  await expect(client.execute(executeBody, 'token')).rejects.toMatchObject({
    code: 'request_too_large',
  });
  request.mockResolvedValueOnce(result({ outcome: 'rejected', reason: 'permission_denied' }));
  expect((await client.execute(executeBody, 'token')).outcome).toBe('rejected');
  expect(errorMessage(new ApiError('database_error', 'sensitive SQL'))).not.toContain('sensitive');
});
it('unwraps describe from the ProgramsResult envelope and rejects other cardinalities', async () => {
  const api = new ApiClient();
  const request = vi.spyOn(api, 'requestRaw');
  const client = new ProgramsClient(api);
  const item = program();
  const ask = { connection: change.connection, object: item.object as never };
  request.mockResolvedValueOnce({ ...listing(), objects: [item] });
  expect((await client.describe(ask, 'token')).object.name).toBe(item.object.name);
  request.mockResolvedValueOnce({ ...listing(), objects: [item, item] });
  await expect(client.describe(ask, 'token')).rejects.toMatchObject({ code: 'invalid_response' });
  request.mockResolvedValueOnce({ ...listing(), objects: [] });
  await expect(client.describe(ask, 'token')).rejects.toMatchObject({ code: 'invalid_response' });
});
it('retries transient database_busy on reads only', async () => {
  vi.useFakeTimers();
  const api = new ApiClient();
  const request = vi.spyOn(api, 'requestRaw');
  const client = new ProgramsClient(api);
  request.mockRejectedValueOnce(new ApiError('database_busy', 'raw'));
  request.mockResolvedValueOnce(listing());
  const pending = client.list({ connection: change.connection }, 'token');
  await vi.advanceTimersByTimeAsync(300);
  expect((await pending).driver).toBe('sqlite');
  vi.useRealTimers();
});
