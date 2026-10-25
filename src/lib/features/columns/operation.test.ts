// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api';
import type { ColumnsClient } from './client';
import { Operation } from './operation.svelte';
import { hash, plan, result } from './testing';

const context = () => ({
  connection: { driver: 'sqlite' as const, database: 'x' },
  token: 't',
  table: { name: 'orders' },
});
function make(client: Partial<ColumnsClient>, onphase = vi.fn(), onfinished = vi.fn()) {
  return {
    onphase,
    onfinished,
    op: new Operation({ context, onphase, onfinished, client: client as ColumnsClient }),
  };
}

describe('Operation', () => {
  it('discards a plan answer that arrives after reset', async () => {
    let resolve: (value: ReturnType<typeof plan>) => void = () => {};
    const { op } = make({ plan: () => new Promise((r) => (resolve = r)) });
    const pending = op.loadPlan([{}]);
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
    await op.loadPlan([{ action: 'drop', column: 'a' }]);
    const first = op.execute();
    void op.execute();
    op.reset();
    resolve(result());
    await first;
    expect(alter).toHaveBeenCalledTimes(1);
    expect((alter.mock.calls[0][0] as { expected_plan_sha256: string }).expected_plan_sha256).toBe(
      hash,
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
    await op.loadPlan([{}]);
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
    await op.loadPlan([{}]);
    await op.execute();
    expect(onphase).not.toHaveBeenCalled();
    expect(op.error).toContain('Plan');
    expect(op.phase).toBe('finished');
  });
});
