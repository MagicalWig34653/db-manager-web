// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { ApiClient, ApiError } from '$lib/api';
import * as validators from '$lib/contract/v10/validators.js';
import { MaintenanceClient } from './client';
import { Operation } from './operation.svelte';
import { validItems, type Item } from './model';
import { capabilities, hash, item, plan, result } from './testing';

const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function arrange() {
  const client = new MaintenanceClient();
  const phases: string[] = [];
  const op = new Operation({
    context: () => ({ connection: { driver: 'sqlite', database: 'synthetic' }, token: 'test' }),
    receiver: () => (phase) => phases.push(phase),
    client,
  });
  const preview = vi.spyOn(client, 'plan').mockResolvedValue(plan());
  const execute = vi
    .spyOn(client, 'execute')
    .mockImplementation(async (_body, _token, dispatch) => {
      dispatch();
      return result();
    });
  return { client, op, phases, preview, execute };
}
describe('maintenance contract', () => {
  const fixtures = import.meta.glob('./fixtures/*.json', { eager: true, import: 'default' });
  for (const [path, fixture] of Object.entries(fixtures)) {
    const schema = path.split('/').at(-1)!.split('.')[0] as keyof typeof validators;
    it(path, () => expect(validators[schema](fixture)).toBe(!path.includes('.invalid.')));
  }
  it('pins canonical contract bytes', () => {
    const source = readFileSync('src/lib/contract/v10/api-v0.10.0.json');
    expect(createHash('sha256').update(source).digest('hex')).toBe(
      '077a0e0222963b112bd6ea528ef5668d2ff7fbe2b2d3555669487c4beaf55cc5',
    );
  });
});
describe('MaintenanceClient', () => {
  it('validates capabilities and refuses unavailable engines', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(capabilities()))
      .mockResolvedValueOnce(response({ ...capabilities(), available: false }));
    const client = new MaintenanceClient(new ApiClient(fetcher));
    expect((await client.capabilities('test')).max_items).toBe(50);
    await expect(client.capabilities('test')).rejects.toMatchObject({
      code: 'unsupported_feature',
    });
  });
  it('validates plan responses', async () => {
    const client = new MaintenanceClient(
      new ApiClient(vi.fn().mockResolvedValue(response({ items: [] }))),
    );
    await expect(client.plan({}, 'test')).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it.each(['network', 'malformed', 'invalid', 'server'])(
    'locks uncertain %s failures without retry',
    async (kind) => {
      const fetcher = vi.fn().mockImplementation(async () => {
        if (kind === 'network') throw new Error('private diagnostic');
        if (kind === 'malformed') return new Response('not json');
        if (kind === 'server') return response({}, 500);
        return response({ items: [], partial: false });
      });
      const dispatch = vi.fn();
      await expect(
        new MaintenanceClient(new ApiClient(fetcher)).execute({}, 'test', dispatch),
      ).rejects.toMatchObject({ code: 'outcome_unknown' });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledTimes(1);
    },
  );
});
describe('Operation', () => {
  it('requires a plan, confirmation, exact names; sends once and locks after completion', async () => {
    const { op, preview, execute, phases } = arrange();
    await op.execute(true, {});
    expect(execute).not.toHaveBeenCalled();
    preview.mockResolvedValue(plan([item], true));
    await op.loadPlan([item]);
    await op.execute(false, { 0: 'orders' });
    await op.execute(true, { 0: 'Orders' });
    expect(execute).not.toHaveBeenCalled();
    await Promise.all([op.execute(true, { 0: 'orders' }), op.execute(true, { 0: 'orders' })]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toMatchObject({
      items: [
        { expected_plan_sha256: hash, confirm: { action: 'analyze', target_name: 'orders' } },
      ],
    });
    expect(phases).toEqual(['sending', 'settled']);
    expect(op.phase).toBe('finished');
    await op.execute(true, { 0: 'orders' });
    expect(execute).toHaveBeenCalledTimes(1);
    op.reset();
    expect(op.plan).toBeNull();
  });
  it('executes only planned entries in original order and reports mixed unknown results', async () => {
    const { op, preview, execute, phases } = arrange();
    const items: Item[] = [
      item,
      { ...item, table: { name: 'rejected' } },
      { ...item, table: { name: 'later' } },
    ];
    const plans = plan(items);
    plans.items[1] = {
      ...plans.items[1],
      state: 'rejected',
      plan: null,
      reason: 'unsupported_table',
      target_name: '',
    };
    preview.mockResolvedValue(plans);
    const answer = result([items[0], items[2]]);
    answer.partial = true;
    answer.items[1] = {
      ...answer.items[1],
      outcome: 'outcome_unknown',
      reason: 'execution_unconfirmed',
    };
    execute.mockImplementation(async (_body, _token, dispatch) => {
      dispatch();
      return answer;
    });
    await op.loadPlan(items);
    await op.execute(true, {});
    expect((execute.mock.calls[0][0].items as Item[]).map((item) => item.table.name)).toEqual([
      'orders',
      'later',
    ]);
    expect(op.unknown).toBe(true);
    expect(phases).toEqual(['sending', 'unknown']);
  });
  it('discards late plans and finalizes dispatched writes even after reset', async () => {
    const { op, preview, execute, phases } = arrange();
    let releasePlan!: (value: ReturnType<typeof plan>) => void;
    preview.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releasePlan = resolve;
        }),
    );
    const pendingPlan = op.loadPlan([item]);
    op.reset();
    releasePlan(plan());
    await pendingPlan;
    expect(op.plan).toBeNull();
    await op.loadPlan([item]);
    let release!: (value: ReturnType<typeof result>) => void;
    execute.mockImplementation((_body, _token, dispatch) => {
      dispatch();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const pending = op.execute(true, {});
    op.reset();
    release(result());
    await pending;
    expect(op.result).toBeNull();
    expect(op.phase).toBe('idle');
    expect(phases).toEqual(['sending', 'settled']);
  });
  it.each(['rejected', 'unknown', 'mismatched'])('locks after %s execution', async (kind) => {
    const { op, execute, phases } = arrange();
    execute.mockImplementation(async (_body, _token, dispatch) => {
      dispatch();
      if (kind === 'unknown') throw new ApiError('outcome_unknown', 'raw');
      const answer = result();
      if (kind === 'rejected')
        answer.items[0] = { ...answer.items[0], outcome: 'rejected', reason: 'plan_mismatch' };
      if (kind === 'mismatched') answer.items[0].table = { name: 'wrong' };
      return answer;
    });
    await op.loadPlan([item]);
    await op.execute(true, {});
    await op.execute(true, {});
    expect(execute).toHaveBeenCalledTimes(1);
    expect(op.phase).toBe('finished');
    expect(phases).toEqual(['sending', kind === 'rejected' ? 'settled' : 'unknown']);
  });
  it('refuses unrelated plans', async () => {
    const { op, preview } = arrange();
    preview.mockResolvedValue(plan([{ ...item, table: { name: 'wrong' } }]));
    await op.loadPlan([item]);
    expect(op.plan).toBeNull();
    expect(op.error).toContain('invalid_response');
  });
  it('rejects duplicates, zero items and 51 tables before planning', async () => {
    const { op, preview } = arrange();
    for (const items of [
      [],
      [item, item],
      Array.from({ length: 51 }, (_, i) => ({ ...item, table: { name: String(i) } })),
    ]) {
      expect(validItems(items)).toBe(false);
      await op.loadPlan(items);
    }
    expect(preview).not.toHaveBeenCalled();
    expect(
      validItems(Array.from({ length: 50 }, (_, i) => ({ ...item, table: { name: String(i) } }))),
    ).toBe(true);
  });
});
