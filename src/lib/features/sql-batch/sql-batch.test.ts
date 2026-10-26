// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '$lib/api';
import { emptyConnection } from '$lib/workbench';
import * as validators from '$lib/contract/v12/validators.js';
import { BatchClient, buildRequest, errorText, validate } from './client';
import { BatchOperation } from './operation.svelte';

export const fixture = (name: string) =>
  JSON.parse(readFileSync(`src/lib/features/sql-batch/fixtures/${name}.json`, 'utf8'));
const connection = { ...emptyConnection(), database: 'synthetic' };
const options = {
  sql: 'SELECT 1;',
  delimiter: '',
  mode: 'stop' as const,
  maxRows: 1000,
  timeoutMs: 10000,
};
const request = () => buildRequest(connection, options);
const result = { statements: [], duration_ms: 0 };
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

describe('v12 contract', () => {
  it('pins the exact backend bytes', () => {
    expect(
      createHash('sha256')
        .update(readFileSync('src/lib/contract/v12/api-v0.12.0.json'))
        .digest('hex'),
    ).toBe('7f0446edccdc368a202e4eaae5689d4b44d641e34bdf77ec8314de9f3e3f2dcd');
  });
  for (const file of readdirSync('src/lib/features/sql-batch/fixtures')) {
    it(`validates ${file}`, () => {
      const check = validators[file.split('.')[0] as keyof typeof validators];
      expect(
        check(JSON.parse(readFileSync(`src/lib/features/sql-batch/fixtures/${file}`, 'utf8'))),
      ).toBe(!file.includes('.invalid.'));
    });
  }
  it('rejects malformed responses', () =>
    expect(() => validate('SQLBatchResult', { statements: [] })).toThrow(ApiError));
});

describe('request and transport', () => {
  it.each([
    { sql: ' ' },
    { delimiter: '--' },
    { delimiter: '/*' },
    { delimiter: 'abc' },
    { maxRows: 10001 },
    { maxRows: -1 },
    { maxRows: 1.5 },
    { timeoutMs: 60001 },
    { sql: 'ü'.repeat(524288) },
    { sql: '"'.repeat(524288) },
  ])('rejects invalid options %j', (overrides) => {
    expect(() => buildRequest(connection, { ...options, ...overrides })).toThrow(ApiError);
  });
  it('allows defaults and punctuation delimiters without changing SQL', () => {
    expect(
      buildRequest(connection, {
        ...options,
        sql: 'DELIMITER //\nSELECT 1//',
        delimiter: '//',
        maxRows: 0,
        timeoutMs: 0,
      }),
    ).toMatchObject({
      sql: 'DELIMITER //\nSELECT 1//',
      confirm: true,
      delimiter: '//',
      max_rows: 0,
    });
  });
  it.each(['batch', 'explain', 'simulate'] as const)(
    'uses the %s route, one request and the session token',
    async (action) => {
      const fetcher = vi
        .fn()
        .mockResolvedValue(
          json(
            action === 'simulate'
              ? { outcome: 'rolled_back', warnings: [], duration_ms: 0 }
              : result,
          ),
        );
      const dispatch = vi.fn();
      await new BatchClient(new ApiClient(fetcher)).execute(
        action,
        request(),
        'synthetic-token',
        new AbortController().signal,
        dispatch,
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][0]).toBe(`/api/v12/sql/${action}`);
      expect(fetcher.mock.calls[0][1]).toMatchObject({
        method: 'POST',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        headers: { Authorization: 'Bearer synthetic-token' },
      });
      expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(request());
      expect(dispatch).toHaveBeenCalledTimes(1);
    },
  );
  it('does not dispatch oversized requests', async () => {
    const dispatch = vi.fn();
    const fetcher = vi.fn();
    await expect(
      new BatchClient(new ApiClient(fetcher)).execute(
        'batch',
        { ...request(), sql: 'a'.repeat(1048576) },
        '',
        new AbortController().signal,
        dispatch,
      ),
    ).rejects.toMatchObject({ code: 'request_too_large' });
    expect(dispatch).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('maps 422 to actionable DELIMITER help without raw error text', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        json({ error: { code: 'sql_not_supported', message: 'private server detail' } }, 422),
      );
    const operation = new BatchOperation(new BatchClient(new ApiClient(fetcher)));
    const report = vi.fn();
    await operation.run('batch', request(), '', report);
    expect(operation.error).toContain('DELIMITER //');
    expect(operation.error).not.toContain('private');
    expect(operation.unknown).toBe(false);
    expect(report.mock.calls.flat()).toEqual(['sending', 'settled']);
  });
  it('replaces unknown errors with fixed text', () =>
    expect(errorText(new Error('private'))).not.toContain('private'));
  it('caps actual response bytes and treats missing results as unknown', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response('x'.repeat(8388609), { headers: { 'content-type': 'application/json' } }),
      );
    const operation = new BatchOperation(new BatchClient(new ApiClient(fetcher)));
    const report = vi.fn();
    await operation.run('batch', request(), '', report);
    expect(operation.unknown).toBe(true);
    expect(report.mock.calls.flat()).toEqual(['sending', 'unknown']);
  });
});

describe('operation lifecycle', () => {
  it('blocks duplicate sends and discards a late response after reset', async () => {
    let resolve!: (value: typeof result) => void;
    const execute = vi.fn((_a, _r, _t, _s, dispatch) => {
      dispatch();
      return new Promise<typeof result>((r) => {
        resolve = r;
      });
    });
    const operation = new BatchOperation({ execute });
    const report = vi.fn();
    const pending = operation.run('batch', request(), '', report);
    await operation.run('batch', request(), '', report);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(operation.busy).toBe(true);
    operation.reset();
    resolve(result);
    await pending;
    expect(operation.result).toBeNull();
    expect(operation.error).toBe('');
    expect(operation.busy).toBe(false);
    expect(report.mock.calls.flat()).toEqual(['sending', 'unknown']);
  });
  it('aborts the actual signal and settles once without waiting for fetch', async () => {
    let signal!: AbortSignal;
    const execute = vi.fn((_a, _r, _t, s, dispatch) => {
      signal = s;
      dispatch();
      return new Promise<never>(() => {});
    });
    const operation = new BatchOperation({ execute });
    const report = vi.fn();
    const pending = operation.run('batch', request(), '', report);
    operation.cancel();
    operation.cancel();
    await pending;
    expect(signal.aborted).toBe(true);
    expect(operation.unknown).toBe(true);
    expect(operation.busy).toBe(false);
    expect(report.mock.calls.flat()).toEqual(['sending', 'unknown']);
  });
  it('uses the configured deadline plus 5 seconds', async () => {
    vi.useFakeTimers();
    try {
      const execute = vi.fn((_a, _r, _t, _s, dispatch) => {
        dispatch();
        return new Promise<never>(() => {});
      });
      const operation = new BatchOperation({ execute });
      const report = vi.fn();
      const pending = operation.run('batch', { ...request(), timeout_ms: 1000 }, '', report);
      await vi.advanceTimersByTimeAsync(5999);
      expect(operation.busy).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(operation.unknown).toBe(true);
      expect(report.mock.calls.flat()).toEqual(['sending', 'unknown']);
    } finally {
      vi.useRealTimers();
    }
  });
  it.each(['invalid_response', 'network_error', 'database_error'])(
    'never retries or claims rejection for %s after dispatch',
    async (code) => {
      const execute = vi.fn(async (_a, _r, _t, _s, dispatch) => {
        dispatch();
        throw new ApiError(code, 'private');
      });
      const operation = new BatchOperation({ execute });
      const report = vi.fn();
      await operation.run('batch', request(), '', report);
      expect(operation.unknown).toBe(true);
      expect(operation.error).not.toContain('private');
      expect(execute).toHaveBeenCalledTimes(1);
      expect(report.mock.calls.flat()).toEqual(['sending', 'unknown']);
    },
  );
  it.each([
    'SQLBatchResult.stop-placeholder',
    'SQLBatchResult.real-sqlite',
    'SQLSimulationResult.unknown-placeholder',
  ])('reports an uncertain outcome in HTTP 200: %s', async (name) => {
    const execute = vi.fn(async (_a, _r, _t, _s, dispatch) => {
      dispatch();
      return fixture(name);
    });
    const operation = new BatchOperation({ execute });
    const report = vi.fn();
    await operation.run('batch', request(), '', report);
    expect(operation.unknown).toBe(true);
    expect(report.mock.calls.flat()).toEqual(['sending', 'unknown']);
  });
  it('reports successful rollback as settled', async () => {
    const execute = vi.fn(async (_a, _r, _t, _s, dispatch) => {
      dispatch();
      return fixture('SQLSimulationResult.real-sqlite');
    });
    const operation = new BatchOperation({ execute });
    const report = vi.fn();
    await operation.run('simulate', request(), '', report);
    expect(operation.unknown).toBe(false);
    expect(report.mock.calls.flat()).toEqual(['sending', 'settled']);
  });
  it('does not end a write phase before dispatch', async () => {
    const operation = new BatchOperation({
      execute: vi.fn().mockRejectedValue(new ApiError('insecure_origin', 'private')),
    });
    const report = vi.fn();
    await operation.run('batch', request(), '', report);
    expect(report).not.toHaveBeenCalled();
  });
});
