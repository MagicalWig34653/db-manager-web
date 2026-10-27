// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api';
import { emptyConnection } from '$lib/workbench';
import { ImportOperation } from './operation.svelte';
import {
  csvExecuteMetadata,
  defaultCommon,
  defaultCsv,
  planMetadata,
  sqlExecuteMetadata,
  type Job,
} from './model';

const fixture = (name: string) =>
  JSON.parse(readFileSync(`src/lib/features/import/fixtures/${name}.json`, 'utf8'));
const connection = { ...emptyConnection(), database: 'synthetic' };
const planRequest = () =>
  planMetadata(
    connection,
    { schema: 'main', name: 't' },
    { ...defaultCsv(), columns: ['id', 'value'] },
    defaultCommon('csv'),
  );
const id = 'a'.repeat(32);
const running = (processed = 0): Job => ({
  id,
  state: 'running',
  cancel_requested: false,
  progress: { processed, total: 3 },
});
const finished = (name = 'ImportResult.real-sqlite-skip'): Job => ({
  id,
  state: 'finished',
  cancel_requested: false,
  progress: { processed: 3, total: 3 },
  result: fixture(name),
});
const file = new Blob(['id,value\n1,a\n']);
const sleep = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));
function make(overrides: Record<string, unknown> = {}) {
  const client = {
    plan: vi.fn(async () => fixture('ImportPlan.real-TestSQLiteImportRoundTrip')),
    execute: vi.fn(
      async (
        _m: unknown,
        _f: unknown,
        _t: string,
        h: { onDispatch: () => void; onUploaded: () => void },
      ) => {
        h.onDispatch();
        h.onUploaded();
        return running();
      },
    ),
    status: vi.fn(async () => finished()),
    cancel: vi.fn(async () => running()),
    ...overrides,
  };
  const operation = new ImportOperation({
    client: client as never,
    pollMs: 1,
    maxStatusFailures: 3,
  });
  return { client, operation, report: vi.fn() };
}
async function planned(ctx: ReturnType<typeof make>) {
  await ctx.operation.makePlan(planRequest(), file, 't');
  expect(ctx.operation.phase).toBe('planned');
  return csvExecuteMetadata(ctx.operation.plannedRequest!, ctx.operation.plan!.plan_sha256);
}
afterEach(() => vi.restoreAllMocks());

it('walks plan, execute and poll to a finished result and spends the plan', async () => {
  const ctx = make();
  const meta = await planned(ctx);
  await ctx.operation.execute(meta, file, 't', ctx.report);
  expect(ctx.operation.consumed).toBe(true);
  expect(ctx.report.mock.calls.flat()).toEqual(['sending']);
  await vi.waitFor(() => expect(ctx.operation.phase).toBe('finished'));
  expect(ctx.report.mock.calls.flat()).toEqual(['sending', 'settled']);
  expect(ctx.operation.result?.outcome).toBe('completed');
  expect(ctx.operation.unknown).toBe(false);
  // Replay lock: the same plan cannot be executed again.
  await ctx.operation.execute(meta, file, 't', ctx.report);
  expect(ctx.client.execute).toHaveBeenCalledTimes(1);
});

it('sends only one execute for a double activation', async () => {
  const ctx = make();
  const meta = await planned(ctx);
  void ctx.operation.execute(meta, file, 't', ctx.report);
  void ctx.operation.execute(meta, file, 't', ctx.report);
  await ctx.operation.execute(meta, file, 't', ctx.report);
  expect(ctx.client.execute).toHaveBeenCalledTimes(1);
});

it('refuses to execute a CSV without a plan and a SQL import while another one is open', async () => {
  const ctx = make();
  await ctx.operation.execute(
    csvExecuteMetadata(planRequest(), 'b'.repeat(64)),
    file,
    't',
    ctx.report,
  );
  expect(ctx.client.execute).not.toHaveBeenCalled();
  const sql = sqlExecuteMetadata(connection, defaultCommon('sql'));
  void ctx.operation.execute(sql, file, 't', ctx.report);
  await ctx.operation.execute(sql, file, 't', ctx.report);
  expect(ctx.client.execute).toHaveBeenCalledTimes(1);
});

it('treats a network failure after dispatch as unknown and never retries', async () => {
  const ctx = make({
    execute: vi.fn(async (_m: unknown, _f: unknown, _t: string, h: { onDispatch: () => void }) => {
      h.onDispatch();
      throw new ApiError('network_error', 'x');
    }),
  });
  const meta = await planned(ctx);
  await ctx.operation.execute(meta, file, 't', ctx.report);
  expect(ctx.operation.phase).toBe('unknown');
  expect(ctx.operation.unknown).toBe(true);
  expect(ctx.report.mock.calls.flat()).toEqual(['sending', 'unknown']);
  await ctx.operation.execute(meta, file, 't', ctx.report);
  expect(ctx.client.execute).toHaveBeenCalledTimes(1);
});

it('shows a pre-run refusal as settled, keeps the spent plan and requires a new preview', async () => {
  const ctx = make({
    execute: vi.fn(async (_m: unknown, _f: unknown, _t: string, h: { onDispatch: () => void }) => {
      h.onDispatch();
      throw new ApiError('plan_mismatch', 'x');
    }),
  });
  const meta = await planned(ctx);
  await ctx.operation.execute(meta, file, 't', ctx.report);
  expect(ctx.operation.phase).toBe('planned');
  expect(ctx.operation.consumed).toBe(true);
  expect(ctx.operation.errorCode).toBe('plan_mismatch');
  expect(ctx.report.mock.calls.flat()).toEqual(['sending', 'settled']);
  await ctx.operation.execute(meta, file, 't', ctx.report);
  expect(ctx.client.execute).toHaveBeenCalledTimes(1);
  await ctx.operation.makePlan(planRequest(), file, 't');
  expect(ctx.operation.consumed).toBe(false);
  expect(ctx.operation.phase).toBe('planned');
});

it('lets a SQL import be retried after a pre-run refusal but not after an unknown outcome', async () => {
  const ctx = make({
    execute: vi.fn(async (_m: unknown, _f: unknown, _t: string, h: { onDispatch: () => void }) => {
      h.onDispatch();
      throw new ApiError('invalid_import', 'x');
    }),
  });
  const sql = sqlExecuteMetadata(connection, defaultCommon('sql'));
  await ctx.operation.execute(sql, file, 't', ctx.report);
  expect(ctx.operation.phase).toBe('idle');
  expect(ctx.operation.consumed).toBe(false);
  await ctx.operation.execute(sql, file, 't', ctx.report);
  expect(ctx.client.execute).toHaveBeenCalledTimes(2);
});

it('returns to the plan when the upload is aborted before the body was complete', async () => {
  const ctx = make({
    execute: vi.fn(
      (_m: unknown, _f: unknown, _t: string, h: { onDispatch: () => void; signal: AbortSignal }) =>
        new Promise((_, reject) => {
          h.onDispatch();
          h.signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    ),
  });
  const meta = await planned(ctx);
  const run = ctx.operation.execute(meta, file, 't', ctx.report);
  expect(ctx.operation.phase).toBe('uploading');
  await ctx.operation.cancel('t');
  await run;
  expect(ctx.operation.phase).toBe('planned');
  expect(ctx.operation.consumed).toBe(false);
  expect(ctx.report.mock.calls.flat()).toEqual(['sending', 'settled']);
  expect(ctx.operation.notice).not.toBe('');
});

it('declares an abort unknown once every body byte was sent, even before the upload event (review F-5)', async () => {
  const ctx = make({
    execute: vi.fn(
      (
        _m: unknown,
        _f: unknown,
        _t: string,
        h: {
          onDispatch: () => void;
          onProgress: (loaded: number, total: number) => void;
          signal: AbortSignal;
        },
      ) =>
        new Promise((_, reject) => {
          h.onDispatch();
          h.onProgress(10, 10); // all bytes handed over, onUploaded has not fired yet
          h.signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    ),
  });
  const meta = await planned(ctx);
  const run = ctx.operation.execute(meta, file, 't', ctx.report);
  expect(ctx.operation.phase).toBe('uploading');
  await ctx.operation.cancel('t');
  await run;
  expect(ctx.operation.phase).toBe('unknown');
  expect(ctx.operation.consumed).toBe(true);
  expect(ctx.report.mock.calls.flat()).toEqual(['sending', 'unknown']);
});

it('allows repeating a stop request whose call failed (review F-6)', async () => {
  let attempts = 0;
  const ctx = make({
    status: vi.fn(async () => running(1)),
    cancel: vi.fn(async () => {
      if (++attempts === 1) throw new Error('network');
      return running(2);
    }),
  });
  const meta = await planned(ctx);
  await ctx.operation.execute(meta, file, 't', ctx.report);
  await ctx.operation.cancel('t');
  expect(ctx.operation.cancelRequested).toBe(false);
  await ctx.operation.cancel('t');
  expect(ctx.client.cancel).toHaveBeenCalledTimes(2);
  expect(ctx.operation.cancelRequested).toBe(true);
  ctx.operation.reset();
});

it('declares an abort after the full upload unknown', async () => {
  const ctx = make({
    execute: vi.fn(
      (
        _m: unknown,
        _f: unknown,
        _t: string,
        h: { onDispatch: () => void; onUploaded: () => void; signal: AbortSignal },
      ) =>
        new Promise((_, reject) => {
          h.onDispatch();
          h.onUploaded();
          h.signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    ),
  });
  const meta = await planned(ctx);
  const run = ctx.operation.execute(meta, file, 't', ctx.report);
  expect(ctx.operation.phase).toBe('starting');
  await ctx.operation.cancel('t');
  await run;
  expect(ctx.operation.phase).toBe('unknown');
  expect(ctx.operation.consumed).toBe(true);
  expect(ctx.report.mock.calls.flat()).toEqual(['sending', 'unknown']);
});

it('requests a stop of a running job once and keeps polling for the real result', async () => {
  let polls = 0;
  const ctx = make({
    status: vi.fn(async () =>
      ++polls < 3 ? running(polls) : finished('ImportResult.real-sqlite-rollback'),
    ),
  });
  const meta = await planned(ctx);
  await ctx.operation.execute(meta, file, 't', ctx.report);
  expect(ctx.operation.phase).toBe('running');
  await ctx.operation.cancel('t');
  await ctx.operation.cancel('t');
  expect(ctx.client.cancel).toHaveBeenCalledTimes(1);
  expect(ctx.operation.cancelRequested).toBe(true);
  await vi.waitFor(() => expect(ctx.operation.phase).toBe('finished'));
  expect(ctx.operation.result?.statements.some((s) => s.outcome === 'rolled_back')).toBe(true);
});

it('marks a finished result with an unknown outcome and reports unknown', async () => {
  const ctx = make({
    status: vi.fn(async () => finished('ImportResult.real-sqlite-commit-unknown')),
  });
  const meta = await planned(ctx);
  await ctx.operation.execute(meta, file, 't', ctx.report);
  await vi.waitFor(() => expect(ctx.operation.phase).toBe('finished'));
  expect(ctx.operation.unknown).toBe(true);
  expect(ctx.report.mock.calls.flat()).toEqual(['sending', 'unknown']);
});

it('declares the outcome unknown when the job disappears or the status stays unreadable', async () => {
  const gone = make({
    status: vi.fn(async () => {
      throw new ApiError('not_found', 'x');
    }),
  });
  await gone.operation.execute(
    sqlExecuteMetadata(connection, defaultCommon('sql')),
    file,
    't',
    gone.report,
  );
  await vi.waitFor(() => expect(gone.operation.phase).toBe('unknown'));
  expect(gone.report.mock.calls.flat()).toEqual(['sending', 'unknown']);
  const flaky = make({
    status: vi.fn(async () => {
      throw new ApiError('network_error', 'x');
    }),
  });
  await flaky.operation.execute(
    sqlExecuteMetadata(connection, defaultCommon('sql')),
    file,
    't',
    flaky.report,
  );
  await vi.waitFor(() => expect(flaky.operation.phase).toBe('unknown'));
  expect(flaky.client.status).toHaveBeenCalledTimes(3);
});

it('releases the write lock as unknown when the view goes away while the job runs', async () => {
  const ctx = make({ status: vi.fn(async () => running()) });
  await ctx.operation.execute(
    sqlExecuteMetadata(connection, defaultCommon('sql')),
    file,
    't',
    ctx.report,
  );
  expect(ctx.operation.phase).toBe('running');
  ctx.operation.reset();
  expect(ctx.report.mock.calls.flat()).toEqual(['sending', 'unknown']);
  const calls = ctx.client.status.mock.calls.length;
  await sleep(10);
  expect(ctx.client.status.mock.calls.length).toBe(calls);
  expect(ctx.operation.phase).toBe('idle');
});

it('reports a plan error without touching the write lock and can cancel a preview', async () => {
  const failing = make({
    plan: vi.fn(async () => {
      throw new ApiError('invalid_import', 'x');
    }),
  });
  await failing.operation.makePlan(planRequest(), file, 't');
  expect(failing.operation.phase).toBe('idle');
  expect(failing.operation.errorCode).toBe('invalid_import');
  const slow = make({
    plan: vi.fn(
      (_m: unknown, _f: unknown, _t: string, h: { signal: AbortSignal }) =>
        new Promise((_, reject) =>
          h.signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          ),
        ),
    ),
  });
  const run = slow.operation.makePlan(planRequest(), file, 't');
  expect(slow.operation.phase).toBe('planning');
  await slow.operation.cancel('t');
  await run;
  expect(slow.operation.phase).toBe('idle');
  expect(slow.operation.notice).not.toBe('');
});
