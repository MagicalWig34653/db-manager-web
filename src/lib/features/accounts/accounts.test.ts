// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '$lib/api';
import * as validators from '$lib/contract/v15/validators.js';
import { AccountsClient, errorMessage } from './client';
import { actions, validSecret, type Schemas } from './model';
import { Operation } from './operation.svelte';
import { connection, ref, plan, result, hash, deferred, capabilities, details } from './testing';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const confirmation = { action: 'password', target_name: '9:synthetic@%', acknowledge_self: true };
const executeBody = {
  connection,
  account: ref,
  confirm: confirmation,
  expected_plan_sha256: hash,
  secret: 'synthetic-secret',
};
function scripted(handler: () => Response | Promise<Response>) {
  const fetcher = vi.fn(handler);
  return { client: new AccountsClient(new ApiClient(fetcher as typeof fetch)), fetcher };
}
describe('API 0.15 provenance and synthetic fixtures', () => {
  it('pins exact source bytes and an integrated backend-main origin', () => {
    const provenance = JSON.parse(readFileSync('src/lib/contract/v15/provenance.json', 'utf8'));
    const sha = createHash('sha256')
      .update(readFileSync('src/lib/contract/v15/api-v0.15.0.json'))
      .digest('hex');
    expect(sha).toBe('cd4681a200045c2fdd5ddf9f1bdc2a356c998b30e640495121925ca8a609dad1');
    expect(provenance.sha256).toBe(sha);
    expect(provenance.source_commit).toBe('3a7e1f13ecd18a9333870005d64e6d8ebb9a0c53');
  });
  for (const file of readdirSync('src/lib/features/accounts/fixtures').filter((file) =>
    file.endsWith('.json'),
  )) {
    it(file, () => {
      const schema = file.split('.')[0] as keyof typeof validators;
      const fixture = JSON.parse(
        readFileSync(`src/lib/features/accounts/fixtures/${file}`, 'utf8'),
      );
      expect(validators[schema](fixture)).toBe(!file.includes('.invalid.'));
    });
  }
  it('keeps generated synthetic test builders schema-valid', () => {
    expect(validators.AccountsCapabilities(capabilities())).toBe(true);
    expect(validators.AccountDetails(details())).toBe(true);
  });
});
describe('AccountsClient', () => {
  it('rejects secrets and unknown fields before a plan request', async () => {
    const { client, fetcher } = scripted(() => json(plan()));
    await expect(
      client.plan('password', { connection, account: ref, secret: 'hidden' }, 'tok'),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('validates action, confirmation and response', async () => {
    const { client } = scripted(() => json(plan('drop')));
    await expect(
      client.plan('password', { connection, account: ref }, 'tok'),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it.each([
    () => {
      throw new TypeError('transport');
    },
    () => new Response('<html>', { status: 502 }),
    () => json({ outcome: 'completed' }),
    () => json({ ...result(), secret: 'leaked' }),
  ])('reports uncertain writes without retrying', async (handler) => {
    const { client, fetcher } = scripted(handler);
    const onDispatch = vi.fn();
    await expect(client.execute('password', executeBody, 'tok', onDispatch)).rejects.toMatchObject({
      code: 'outcome_unknown',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onDispatch).toHaveBeenCalledTimes(1);
  });
  it('keeps definite rejection definite, hides raw error messages', async () => {
    const { client } = scripted(() =>
      json({ error: { code: 'plan_mismatch', message: 'RAW SECRET' } }, 409),
    );
    const error = await client
      .execute('password', executeBody, 'tok', () => {})
      .catch((error) => error);
    expect(error.code).toBe('plan_mismatch');
    expect(errorMessage(error)).toContain('Plan');
    expect(errorMessage(error)).not.toContain('RAW SECRET');
  });
  it('rejects invalid execute bodies before dispatch', async () => {
    const { client, fetcher } = scripted(() => json(result()));
    await expect(
      client.execute('password', { connection, account: ref }, 'tok', () => {}),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('explains missing API support', async () => {
    const { client } = scripted(() => json({ error: { code: 'not_found', message: '' } }, 404));
    await expect(client.capabilities('tok')).rejects.toMatchObject({ code: 'unsupported_feature' });
  });
  it.each(['list', 'inspect', 'access'] as const)('validates %s responses', async (method) => {
    const { client } = scripted(() => json({}));
    await expect(client[method]({ connection, account: ref }, 'tok')).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});
function setup() {
  const client = new AccountsClient();
  const phases: string[] = [];
  const context = { connection, token: 'tok' };
  const planSpy = vi.spyOn(client, 'plan').mockImplementation(async (action) => plan(action));
  const executeSpy = vi
    .spyOn(client, 'execute')
    .mockImplementation(async (_action, _body, _token, dispatch) => {
      dispatch();
      return result();
    });
  let blocked = false;
  const finished = vi.fn();
  const operation = new Operation({
    context: () => context,
    receiver: () => (phase) => phases.push(phase),
    blocked: () => blocked,
    client,
    onfinished: finished,
  });
  return {
    operation,
    client,
    phases,
    context,
    planSpy,
    executeSpy,
    finished,
    block: (value: boolean) => (blocked = value),
  };
}
describe('account operation safety', () => {
  it('requires plan, exact typed identity and explicit self acknowledgement', async () => {
    const { operation, executeSpy } = setup();
    await operation.execute(true, '9:synthetic@%', true, 'secret');
    expect(executeSpy).not.toHaveBeenCalled();
    await operation.loadPlan('password', { account: ref });
    expect(operation.canExecute(false, '9:synthetic@%', true, 'secret')).toBe(false);
    expect(operation.canExecute(true, 'synthetic', true, 'secret')).toBe(false);
    expect(operation.canExecute(true, '9:synthetic@%', false, 'secret')).toBe(false);
    expect(operation.canExecute(true, '9:synthetic@%', true, '')).toBe(false);
    expect(operation.canExecute(true, '9:synthetic@%', true, 'secret')).toBe(true);
  });
  it.each(['completed', 'rejected', 'outcome_unknown'] as const)(
    'sends once and locks after %s',
    async (outcome) => {
      const { operation, executeSpy, phases } = setup();
      const answer = deferred<Schemas['AccountResult']>();
      executeSpy.mockImplementation((_a, _b, _t, dispatch) => {
        dispatch();
        return answer.promise;
      });
      await operation.loadPlan('password', { account: ref });
      const first = operation.execute(true, '9:synthetic@%', true, 'secret');
      await operation.execute(true, '9:synthetic@%', true, 'secret');
      expect(executeSpy).toHaveBeenCalledTimes(1);
      answer.resolve(result(outcome));
      await first;
      await operation.execute(true, '9:synthetic@%', true, 'secret');
      expect(executeSpy).toHaveBeenCalledTimes(1);
      expect(operation.phase).toBe('finished');
      expect(phases).toEqual(['sending', outcome === 'outcome_unknown' ? 'unknown' : 'settled']);
    },
  );
  it('discards a late plan after reset and never retains a supplied secret', async () => {
    const { operation, planSpy } = setup();
    await operation.loadPlan('password', { account: ref, secret: 'hidden' });
    expect(planSpy).not.toHaveBeenCalled();
    const late = deferred<Schemas['AccountPlan']>();
    planSpy.mockReturnValue(late.promise);
    const pending = operation.loadPlan('password', { account: ref });
    operation.reset();
    late.resolve(plan());
    await pending;
    expect(operation.phase).toBe('idle');
    expect(operation.plan).toBeNull();
  });
  it('settles stale writes through the original receiver without restoring state', async () => {
    const { operation, executeSpy, phases, finished } = setup();
    const late = deferred<Schemas['AccountResult']>();
    executeSpy.mockImplementation((_a, _b, _t, dispatch) => {
      dispatch();
      return late.promise;
    });
    await operation.loadPlan('password', { account: ref });
    const pending = operation.execute(true, '9:synthetic@%', true, 'secret');
    operation.reset();
    late.resolve(result('outcome_unknown'));
    await pending;
    expect(phases).toEqual(['sending', 'unknown']);
    expect(operation.result).toBeNull();
    expect(finished).not.toHaveBeenCalled();
  });
  it('reports a lost execute answer and remains locked', async () => {
    const { operation, executeSpy, phases } = setup();
    executeSpy.mockImplementation(async (_a, _b, _t, dispatch) => {
      dispatch();
      throw new ApiError('outcome_unknown', 'raw');
    });
    await operation.loadPlan('password', { account: ref });
    await operation.execute(true, '9:synthetic@%', true, 'secret');
    expect(operation.unknown).toBe(true);
    expect(phases).toEqual(['sending', 'unknown']);
    expect(operation.phase).toBe('finished');
  });
  it('blocks planning and execution during another session write', async () => {
    const { operation, block, planSpy, executeSpy } = setup();
    block(true);
    await operation.loadPlan('password', { account: ref });
    expect(planSpy).not.toHaveBeenCalled();
    block(false);
    await operation.loadPlan('password', { account: ref });
    block(true);
    await operation.execute(true, '9:synthetic@%', true, 'secret');
    expect(executeSpy).not.toHaveBeenCalled();
  });
  it('validates UTF-8 secret bounds and NUL', () => {
    expect(validSecret('')).toBe(false);
    expect(validSecret('a\0b')).toBe(false);
    expect(validSecret('ü'.repeat(2048))).toBe(true);
    expect(validSecret('ü'.repeat(2049))).toBe(false);
  });
  it('requires action-specific plans for every offered action', async () => {
    for (const action of actions) {
      const { operation, planSpy } = setup();
      await operation.loadPlan(action, action === 'flush' ? {} : { account: ref });
      expect(planSpy).toHaveBeenCalledWith(
        action,
        expect.objectContaining({ connection }),
        'tok',
        expect.any(AbortSignal),
      );
      expect(operation.plan?.action).toBe(action);
    }
  });
});

describe('account error messages', () => {
  it('maps system_account and name-limit rejections to distinct German texts', async () => {
    const { ApiError } = await import('$lib/api');
    const { errorMessage } = await import('./client');
    expect(errorMessage(new ApiError('system_account', ''))).toContain('Systemkonten');
    expect(errorMessage(new ApiError('invalid_account_request', ''))).toContain('ungültig');
  });
});
