// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '$lib/api';
import { IndexesClient, indexesErrorMessage } from './client';
import { capabilities, result } from './testing';
afterEach(() => vi.restoreAllMocks());
it('validates capabilities and handles older backends', async () => {
  const raw = vi.spyOn(ApiClient.prototype, 'requestRaw');
  const client = new IndexesClient();
  raw.mockResolvedValue(capabilities());
  expect((await client.capabilities('t')).contract_version).toBe('0.13.0');
  raw.mockResolvedValue({});
  await expect(client.capabilities('t')).rejects.toMatchObject({ code: 'unsupported_feature' });
  raw.mockRejectedValue(new ApiError('not_found', 'private'));
  await expect(client.capabilities('t')).rejects.toMatchObject({ code: 'unsupported_feature' });
});
it('marks malformed or lost answers after dispatch unknown without retry', async () => {
  const raw = vi
    .spyOn(ApiClient.prototype, 'requestRaw')
    .mockImplementation(async (_p, _t, _b, _s, opts) => {
      opts?.onDispatch?.();
      return {};
    });
  await expect(new IndexesClient().alter({}, 't')).rejects.toMatchObject({
    code: 'outcome_unknown',
  });
  expect(raw).toHaveBeenCalledTimes(1);
  raw.mockImplementation(async (_p, _t, _b, _s, opts) => {
    opts?.onDispatch?.();
    throw new ApiError('network_error', 'secret');
  });
  await expect(new IndexesClient().alter({}, 't')).rejects.toMatchObject({
    code: 'outcome_unknown',
  });
});
it('keeps definite rejection definite and hides raw errors', async () => {
  vi.spyOn(ApiClient.prototype, 'requestRaw').mockRejectedValue(
    new ApiError('plan_mismatch', 'private SQL'),
  );
  await expect(new IndexesClient().alter({}, 't')).rejects.toMatchObject({ code: 'plan_mismatch' });
  expect(indexesErrorMessage(new ApiError('database_error', 'private SQL'))).not.toContain(
    'private',
  );
});
it('accepts a validated execution outcome', async () => {
  vi.spyOn(ApiClient.prototype, 'requestRaw').mockResolvedValue(result());
  expect((await new IndexesClient().alter({}, 't')).outcome).toBe('completed');
});
