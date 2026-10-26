// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api';
import type { IndexesClient } from './client';
import { Operation } from './operation.svelte';
import { plan, result } from './testing';

const context = () => ({
  connection: { driver: 'sqlite' as const, database: 'x' },
  token: 't',
  table: { name: 'orders' },
});
function make(client: Partial<IndexesClient>, onphase = vi.fn(), onfinished = vi.fn()) {
  return {
    onphase,
    onfinished,
    op: new Operation({ context, onphase, onfinished, client: client as IndexesClient }),
  };
}

describe('Operation', () => {
  it('discards a plan answer that arrives after reset', async () => {
    let resolve: (value: ReturnType<typeof plan>) => void = () => {};
    const { op } = make({ plan: () => new Promise((r) => (resolve = r)) });
    const pending = op.loadPlan({ action: 'index_create' });
    op.reset();
    resolve(plan());
    await pending;
    expect(op.plan).toBeNull();
    expect(op.phase).toBe('idle');
  });

  it('sends one execute with the plan hash and reports one final phase even for a stale answer', async () => {
    let resolve: (value: ReturnType<typeof result>) => void = () => {};
    const alter = vi.fn(
      (_body: unknown, _token: string, onDispatch?: () => void) =>
        new Promise<ReturnType<typeof result>>((r) => {
          onDispatch?.();
          resolve = r;
        }),
    );
    const { op, onphase, onfinished } = make({ plan: async () => plan(), alter });
    await op.loadPlan({ action: 'index_drop', name: 'idx' });
    const first = op.execute();
    void op.execute();
    op.reset();
    resolve(result());
    await first;
    expect(alter).toHaveBeenCalledTimes(1);
    expect((alter.mock.calls[0][0] as { expected_plan_sha256: string }).expected_plan_sha256).toBe(
      plan().plan_sha256,
    );
    expect(onphase.mock.calls.map((c) => c[0])).toEqual(['sending', 'settled']);
    expect(onfinished).not.toHaveBeenCalled();
    expect(op.result).toBeNull();
  });

  it('turns an unknown result outcome into the unknown state', async () => {
    const { op, onphase } = make({
      plan: async () => plan(),
      alter: async (_b, _t, d) => {
        d?.();
        return result({ outcome: 'outcome_unknown', reason: 'commit_unknown' });
      },
    });
    await op.loadPlan({ action: 'index_create' });
    await op.execute();
    expect(op.unknown).toBe(true);
    expect(onphase.mock.calls.map((c) => c[0])).toEqual(['sending', 'unknown']);
    await op.execute();
    expect(onphase).toHaveBeenCalledTimes(2);
  });

  it('does not report a write phase when the request never left (plan mismatch before dispatch)', async () => {
    const { op, onphase } = make({
      plan: async () => plan(),
      alter: async () => {
        throw new ApiError('plan_mismatch', 'x');
      },
    });
    await op.loadPlan({ action: 'index_create' });
    await op.execute();
    expect(onphase).not.toHaveBeenCalled();
    expect(op.error).toContain('Plan');
    expect(op.phase).toBe('finished');
  });
});

it('requires the exact table name from the destructive plan and copies the action', async () => {
  const alter = vi.fn(async () => result());
  const { op } = make({
    plan: async () => plan({ destructive: true, target_name: 'orders "' }),
    alter,
  });
  await op.execute();
  expect(alter).not.toHaveBeenCalled();
  await op.loadPlan({ action: 'foreign_key_drop', name: 'fk' });
  await op.execute('fk');
  expect(alter).not.toHaveBeenCalled();
  await op.execute('orders "');
  expect(alter).toHaveBeenCalledTimes(1);
  expect(alter.mock.calls[0]).toBeDefined();
  await op.execute('orders "');
  expect(alter).toHaveBeenCalledTimes(1);
});
it('keeps the original write receiver when context changes during dispatch', async () => {
  let receiver = vi.fn();
  const original = receiver;
  let release: (value: ReturnType<typeof result>) => void = () => {};
  const op = new Operation({
    context,
    writeReceiver: () => receiver,
    client: {
      plan: async () => plan(),
      alter: async (_b: unknown, _t: string, d: () => void) => {
        d();
        return new Promise((r) => (release = r));
      },
    } as unknown as IndexesClient,
  });
  await op.loadPlan({ action: 'index_create' });
  const pending = op.execute();
  op.reset();
  receiver = vi.fn();
  release(result());
  await pending;
  expect(original.mock.calls.map((c) => c[0])).toEqual(['sending', 'settled']);
  expect(receiver).not.toHaveBeenCalled();
});
