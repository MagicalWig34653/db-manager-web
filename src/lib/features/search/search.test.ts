// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ApiClient, ApiError } from '$lib/api';
import * as validators from '$lib/contract/v14/validators.js';
import { SearchClient, searchError } from './client';
import { highlight, textColumns, validText } from './model';
import { Operation } from './operation.svelte';
import { Resource } from './resource.svelte';
import { request, plan, description, capabilities } from './testing';
const fixtures = import.meta.glob('./fixtures/*.json', { eager: true, import: 'default' });
const response = (json: unknown) =>
  new Response(JSON.stringify(json), { headers: { 'Content-Type': 'application/json' } });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { resolve, reject, promise };
};

describe('API 0.14', () => {
  it('pins the source bytes and validates every backend fixture', () => {
    const provenance = JSON.parse(readFileSync('src/lib/contract/v14/provenance.json', 'utf8'));
    expect(
      createHash('sha256')
        .update(readFileSync('src/lib/contract/v14/api-v0.14.0.json'))
        .digest('hex'),
    ).toBe(provenance.sha256);
    expect(Object.keys(fixtures)).toHaveLength(46);
    for (const [path, value] of Object.entries(fixtures)) {
      const schema = path.split('/').at(-1)!.split('.')[0] as keyof typeof validators;
      expect(validators[schema](value), path).toBe(!path.includes('.invalid.'));
    }
    expect(validators.SearchCapabilities(capabilities())).toBe(true);
  });
  it('validates target identity, row width and shared count budget', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response({
        tables: [
          { table: { name: 'wrong' }, columns: ['note'], count: 1, count_exact: true, rows: [] },
        ],
      }),
    );
    const client = new SearchClient(new ApiClient(fetcher));
    const body = {
      connection: request().connection,
      targets: [{ table: request().table, columns: ['note'] }],
      term: 'fox',
      mode: 'substring' as const,
    };
    await expect(client.search(body, 'token')).rejects.toMatchObject({ code: 'invalid_response' });
    for (const result of [
      { table: request().table, columns: ['note'], count: 1, count_exact: true, rows: [[]] },
      { table: request().table, columns: ['note'], count: 101, count_exact: false, rows: [] },
    ]) {
      fetcher.mockResolvedValueOnce(response({ tables: [result] }));
      await expect(client.search(body, 'token')).rejects.toMatchObject({
        code: 'invalid_response',
      });
    }
  });
  it('rejects a plan for another target', async () => {
    const client = new SearchClient(
      new ApiClient(vi.fn().mockResolvedValue(response({ ...plan(), column: 'other' }))),
    );
    await expect(client.plan(request(), 't')).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('sends one write and classifies invalid and lost responses as unknown', async () => {
    for (const fetcher of [
      vi.fn().mockRejectedValue(new TypeError('offline')),
      vi.fn().mockResolvedValue(response({ bad: true })),
    ]) {
      const client = new SearchClient(new ApiClient(fetcher));
      const dispatched = vi.fn();
      await expect(
        client.execute(
          {
            ...request(),
            expected_plan_sha256: plan().plan_sha256,
            confirm: { action: 'replace', target_name: 'orders', affected_rows: 1 },
          },
          't',
          dispatched,
        ),
      ).rejects.toMatchObject({ code: 'outcome_unknown' });
      expect(dispatched).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    expect(searchError(new ApiError('database_error', 'private SQL secret'))).not.toContain(
      'secret',
    );
  });
});
describe('safe model', () => {
  it('bounds UTF-8 bytes and preserves empty replacement and literal text', () => {
    expect(validText('😀'.repeat(1024))).toBe(true);
    expect(validText('😀'.repeat(1025))).toBe(false);
    expect(validText('')).toBe(false);
    expect(validText('', true)).toBe(true);
    expect(validText('a\0')).toBe(false);
    expect(
      highlight('<img> fox & fox', 'fox', 'substring')
        .filter((p) => p.hit)
        .map((p) => p.text),
    ).toEqual(['fox', 'fox']);
    expect(highlight('fox', '.*', 'regex')).toEqual([{ text: 'fox', hit: false }]);
    expect(
      highlight('abab', 'ab bab', 'all_words')
        .map((p) => p.text)
        .join(''),
    ).toBe('abab');
  });
  it('excludes binary, generated and key targets for replacement', () => {
    const data = description();
    data.columns[1].generated = 'stored';
    data.columns[2].pk_position = 2;
    expect(textColumns(data).map((c) => c.name)).toEqual(['note', 'other']);
    expect(textColumns(data, true)).toEqual([]);
  });
});
describe('replacement lifecycle', () => {
  function arrange() {
    const client = new SearchClient();
    const phases: string[] = [];
    let blocked = false;
    const operation = new Operation({
      client,
      onphase: () => (phase) => phases.push(phase),
      blocked: () => blocked,
    });
    vi.spyOn(client, 'plan').mockResolvedValue(plan());
    return {
      client,
      phases,
      operation,
      block: () => {
        blocked = true;
      },
    };
  }
  it('requires exact name, count and confirmation; locks synchronously and after completion', async () => {
    const { client, phases, operation } = arrange();
    const waiting =
      deferred<
        ReturnType<typeof plan> extends never
          ? never
          : { outcome: 'completed'; affected_rows: number }
      >();
    const execute = vi.spyOn(client, 'execute').mockImplementation((_body, _token, dispatch) => {
      dispatch();
      return waiting.promise;
    });
    await operation.loadPlan(request(), 't');
    await operation.execute('wrong', '1', true);
    await operation.execute('orders', '0', true);
    await operation.execute('orders', '1', false);
    expect(execute).not.toHaveBeenCalled();
    const first = operation.execute('orders', '1', true);
    void operation.execute('orders', '1', true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(phases).toEqual(['sending']);
    waiting.resolve({ outcome: 'completed', affected_rows: 1 });
    await first;
    await operation.execute('orders', '1', true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(operation.phase).toBe('finished');
    expect(phases).toEqual(['sending', 'settled']);
    expect(execute.mock.calls[0][0]).toMatchObject({
      expected_plan_sha256: plan().plan_sha256,
      confirm: { action: 'replace', target_name: 'orders', affected_rows: 1 },
    });
  });
  it.each(['completed', 'rejected', 'outcome_unknown'] as const)(
    'locks after %s',
    async (outcome) => {
      const { client, operation, phases } = arrange();
      vi.spyOn(client, 'execute').mockImplementation(async (_body, _token, dispatch) => {
        dispatch();
        return { outcome, affected_rows: 0 };
      });
      await operation.loadPlan(request(), 't');
      await operation.execute('orders', '1', true);
      expect(operation.phase).toBe('finished');
      expect(phases).toEqual(['sending', outcome === 'outcome_unknown' ? 'unknown' : 'settled']);
    },
  );
  it('balances stale writes and captures the receiver; discards late plan and read answers', async () => {
    const { client, operation, phases } = arrange();
    const pending = deferred<never>();
    vi.spyOn(client, 'execute').mockImplementation((_body, _token, dispatch) => {
      dispatch();
      return pending.promise;
    });
    await operation.loadPlan(request(), 't');
    const sent = operation.execute('orders', '1', true);
    operation.reset();
    pending.reject(new ApiError('outcome_unknown', 'lost'));
    await sent;
    expect(phases).toEqual(['sending', 'unknown']);
    expect(operation.phase).toBe('idle');
    expect(operation.error).toBe('');
    const late = deferred<ReturnType<typeof plan>>();
    vi.mocked(client.plan).mockReturnValue(late.promise);
    const planning = operation.loadPlan(request(), 't');
    operation.reset();
    late.resolve(plan());
    await planning;
    expect(operation.plan).toBeNull();
    const read = new Resource<number>();
    const answer = deferred<number>();
    const loading = read.run(() => answer.promise);
    read.abort();
    answer.resolve(3);
    await loading;
    expect(read.data).toBeNull();
    expect(read.busy).toBe(false);
  });
  it('retains the immutable planned input and blocks writes while another write runs', async () => {
    const { client, operation, block } = arrange();
    const input = request();
    await operation.loadPlan(input, 't');
    input.replacement = 'changed';
    const execute = vi
      .spyOn(client, 'execute')
      .mockResolvedValue({ outcome: 'completed', affected_rows: 1 });
    await operation.execute('orders', '1', true);
    expect(execute.mock.calls[0][0].replacement).toBe('cat');
    operation.reset();
    await operation.loadPlan(request(), 't');
    block();
    await operation.execute('orders', '1', true);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
