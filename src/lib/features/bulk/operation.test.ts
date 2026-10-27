// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api';
import { emptyConnection } from '$lib/workbench';
import { BulkOperation } from './operation.svelte';
import { planRequest, selection, type BulkResult, type Plan } from './model';

const connection = { ...emptyConnection(), database: 'synthetic' };
const table = { schema: 'main', name: 'items' };
const rows = selection(
  {
    columns: [{ name: 'id', type: 'INTEGER' }],
    rows: [[{ kind: 'integer', value: '1' }], [{ kind: 'integer', value: '2' }]],
    truncated: false,
  },
  [0, 1],
).snapshots;
const request = () => planRequest(connection, table, 'delete', rows);
const plan = (over: Partial<Plan> = {}): Plan => ({
  table,
  action: 'delete',
  row_count: 2,
  rows: ['1', '2'].map((v, i) => ({
    key: [{ column: 'id', value: { kind: 'integer' as const, value: v } }],
    stability_sha256: String(i).repeat(64),
  })),
  warnings: [],
  plan_sha256: 'f'.repeat(64),
  ...over,
});
const done = (outcome: BulkResult['outcome'] = 'completed', reason?: string): BulkResult => ({
  outcome,
  rows: [0, 1].map((index) => ({ index, outcome })),
  ...(reason ? { reason } : {}),
});
function make(overrides: Record<string, unknown> = {}) {
  const client = {
    plan: vi.fn(async () => plan()),
    execute: vi.fn(async (_r: unknown, _t: string, _s: AbortSignal, dispatch: () => void) => {
      dispatch();
      return done();
    }),
    ...overrides,
  };
  const operation = new BulkOperation({ client: client as never, primaryKey: () => ['id'] });
  return { client, operation, report: vi.fn() };
}

it('plans, executes once and spends the plan', async () => {
  const { client, operation, report } = make();
  await operation.makePlan(request(), 't');
  expect(operation.phase).toBe('planned');
  await operation.execute('t', report);
  expect(operation.phase).toBe('finished');
  expect(operation.consumed).toBe(true);
  expect(operation.result?.outcome).toBe('completed');
  expect(report.mock.calls.flat()).toEqual(['sending', 'settled']);
  expect(client.execute.mock.calls[0][0]).toMatchObject({
    confirm: true,
    expected_plan_sha256: 'f'.repeat(64),
    rows: [{ stability_sha256: '0'.repeat(64) }, { stability_sha256: '1'.repeat(64) }],
  });
  // Replay lock.
  await operation.execute('t', report);
  expect(client.execute).toHaveBeenCalledTimes(1);
});

it('sends one request for a double activation', async () => {
  const { client, operation, report } = make();
  await operation.makePlan(request(), 't');
  void operation.execute('t', report);
  void operation.execute('t', report);
  await operation.execute('t', report);
  expect(client.execute).toHaveBeenCalledTimes(1);
});

it('refuses a plan that is about other rows', async () => {
  const swapped = make({ plan: vi.fn(async () => plan({ rows: plan().rows.slice().reverse() })) });
  await swapped.operation.makePlan(request(), 't');
  expect(swapped.operation.phase).toBe('idle');
  expect(swapped.operation.errorCode).toBe('invalid_response');
  await swapped.operation.execute('t', swapped.report);
  expect(swapped.client.execute).not.toHaveBeenCalled();
});

it('shows plan_conflict as stale and does not touch the write lock', async () => {
  const conflict = make({
    execute: vi.fn(async (_r: unknown, _t: string, _s: AbortSignal, dispatch: () => void) => {
      dispatch();
      throw new ApiError('plan_conflict', 'x');
    }),
  });
  await conflict.operation.makePlan(request(), 't');
  await conflict.operation.execute('t', conflict.report);
  expect(conflict.operation.phase).toBe('finished');
  expect(conflict.operation.errorCode).toBe('plan_conflict');
  expect(conflict.operation.stale).toBe(true);
  expect(conflict.operation.unknown).toBe(false);
  expect(conflict.report.mock.calls.flat()).toEqual(['sending', 'settled']);
  await conflict.operation.execute('t', conflict.report);
  expect(conflict.client.execute).toHaveBeenCalledTimes(1);
});

it('reports a rejected result as settled and requires a new preview', async () => {
  const rejected = make({
    execute: vi.fn(async (_r: unknown, _t: string, _s: AbortSignal, dispatch: () => void) => {
      dispatch();
      return done('rejected', 'row_conflict');
    }),
  });
  await rejected.operation.makePlan(request(), 't');
  await rejected.operation.execute('t', rejected.report);
  expect(rejected.operation.result?.outcome).toBe('rejected');
  expect(rejected.operation.stale).toBe(true);
  expect(rejected.operation.consumed).toBe(true);
  expect(rejected.report.mock.calls.flat()).toEqual(['sending', 'settled']);
});

it('treats outcome_unknown results and lost connections as unknown', async () => {
  const unknown = make({
    execute: vi.fn(async (_r: unknown, _t: string, _s: AbortSignal, dispatch: () => void) => {
      dispatch();
      return done('outcome_unknown', 'outcome_unknown');
    }),
  });
  await unknown.operation.makePlan(request(), 't');
  await unknown.operation.execute('t', unknown.report);
  expect(unknown.operation.unknown).toBe(true);
  expect(unknown.report.mock.calls.flat()).toEqual(['sending', 'unknown']);
  const lost = make({
    execute: vi.fn(async (_r: unknown, _t: string, _s: AbortSignal, dispatch: () => void) => {
      dispatch();
      throw new ApiError('outcome_unknown', 'x');
    }),
  });
  await lost.operation.makePlan(request(), 't');
  await lost.operation.execute('t', lost.report);
  expect(lost.operation.phase).toBe('unknown');
  expect(lost.report.mock.calls.flat()).toEqual(['sending', 'unknown']);
  await lost.operation.execute('t', lost.report);
  expect(lost.client.execute).toHaveBeenCalledTimes(1);
});

it('releases the write lock as unknown when closed during the request', async () => {
  let release: (value: BulkResult) => void = () => {};
  const pending = make({
    execute: vi.fn(
      (_r: unknown, _t: string, _s: AbortSignal, dispatch: () => void) =>
        new Promise<BulkResult>((resolve) => {
          dispatch();
          release = resolve;
        }),
    ),
  });
  await pending.operation.makePlan(request(), 't');
  const run = pending.operation.execute('t', pending.report);
  expect(pending.operation.phase).toBe('executing');
  pending.operation.reset(pending.report);
  expect(pending.report.mock.calls.flat()).toEqual(['sending', 'unknown']);
  release(done());
  await run;
  expect(pending.operation.phase).toBe('idle');
  expect(pending.report.mock.calls.flat()).toEqual(['sending', 'unknown']);
});

it('can abort a preview', async () => {
  const slow = make({
    plan: vi.fn(
      (_r: unknown, _t: string, signal: AbortSignal) =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
        ),
    ),
  });
  const run = slow.operation.makePlan(request(), 't');
  expect(slow.operation.phase).toBe('planning');
  slow.operation.cancelPlan();
  await run;
  expect(slow.operation.phase).toBe('idle');
  expect(slow.operation.error).toBe('');
});
