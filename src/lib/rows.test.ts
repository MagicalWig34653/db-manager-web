// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ApiClient } from './api';
import { RowClient, prepareChanges, copySnapshot, validateRow, type FieldDraft } from './rows';
const connection = { driver: 'sqlite' as const, database: 'synthetic' };
const table = { name: 'rows' };
const expected = {
  columns: ['id', 'amount', 'optional', 'empty', 'bytes'],
  values: [
    { kind: 'integer' as const, value: '9223372036854775807' },
    { kind: 'decimal' as const, value: '12345678901234567890.12345678901234567890' },
    { kind: 'null' as const },
    { kind: 'text' as const, value: '' },
    { kind: 'binary' as const, value: 'AP8=' },
  ],
};
const change = {
  column: 'amount',
  value: { kind: 'decimal' as const, value: '12345678901234567890.12345678901234567891' },
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const mutate = (
  fetcher: typeof fetch,
  signal = new AbortController().signal,
  onDispatch = () => {},
) =>
  new RowClient(new ApiClient(fetcher)).mutate(
    'update',
    connection,
    table,
    copySnapshot(expected),
    [change],
    'synthetic-token',
    signal,
    onDispatch,
  );
describe('frozen, explicit, lossless row mutations', () => {
  it('pins both reviewed contracts and the public backend with both protection fixes', () => {
    for (const [version, sha] of [
      [3, 'ec77c9739cda11df3f4cb9fe756a632e67840fdc0f6190deee1aa1d1333dc308'],
      [4, '4763ebf8632a9ef977cf7d3a6037299fc4dafde0a581fe10cb34d844f8356fbf'],
    ]) {
      const provenance = JSON.parse(
        readFileSync(`src/lib/contract/v${version}/provenance.json`, 'utf8'),
      );
      expect(
        createHash('sha256')
          .update(readFileSync(`src/lib/contract/v${version}/api-v0.${version}.0.json`))
          .digest('hex'),
      ).toBe(sha);
      expect(provenance.source_commit).toBe('72855cf57ceb6620dead42856ee6c9d52d0612bd');
    }
  });
  it('retains every original tagged cell and sends no SQL exactly once', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(reply({ outcome: 'committed', changed: true, row: expected }));
    const dispatch = vi.fn();
    await mutate(fetcher, undefined, dispatch);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [path, request] = fetcher.mock.calls[0];
    const body = JSON.parse(request.body);
    expect(path).toBe('/api/v3/rows/update');
    expect(body.expected).toEqual(expected);
    expect(body.changes).toEqual([change]);
    expect(body.confirm).toBe(true);
    expect(body.sql).toBeUndefined();
    const cloned = copySnapshot(expected);
    cloned.values[0].value = 'different';
    expect(expected.values[0].value).toBe('9223372036854775807');
  });
  it('distinguishes omitted defaults, explicit NULL, empty text and locked columns', () => {
    const field = (column: string, mode: FieldDraft['mode'], value = ''): FieldDraft => ({
      column,
      mode,
      value,
      kind: 'text',
      locked: false,
    });
    expect(
      prepareChanges(
        [
          field('default', 'default'),
          field('optional', 'null'),
          field('empty', 'value'),
          { ...field('generated', 'value', 'ignored'), locked: true },
        ],
        'insert',
      ),
    ).toEqual([
      { column: 'optional', value: { kind: 'null' } },
      { column: 'empty', value: { kind: 'text', value: '' } },
    ]);
    expect(() => prepareChanges([field('unchanged', 'unchanged')], 'update')).toThrow();
    expect(() =>
      validateRow('UpdateRequest', {
        connection,
        table,
        expected,
        changes: [change],
        confirm: false,
      }),
    ).toThrow();
  });
  it('withholds all new writing support when the v4 gate is missing', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('Not found', { status: 404 }));
    await expect(
      new RowClient(new ApiClient(fetcher)).eligibility(
        connection,
        table,
        'synthetic-token',
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'unsupported_feature' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('/api/v4/capabilities');
  });
  it('never retries a conflict or turns it into success', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        reply({ error: { code: 'row_conflict', message: 'untrusted detail' } }, 409),
      );
    await expect(mutate(fetcher)).rejects.toMatchObject({ code: 'row_conflict' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('classifies dispatch transport loss, invalid success data and server uncertainty as unknown', async () => {
    for (const fetcher of [
      vi.fn().mockRejectedValue(new Error('private transport detail')),
      vi
        .fn()
        .mockResolvedValue(
          new Response('lost body', { headers: { 'Content-Type': 'application/json' } }),
        ),
      vi
        .fn()
        .mockResolvedValue(
          reply({ error: { code: 'outcome_unknown', message: 'private DB detail' } }, 503),
        ),
      vi
        .fn()
        .mockResolvedValue(
          reply({ outcome: 'committed', changed: true, row: { columns: ['id'], values: [] } }),
        ),
    ]) {
      await expect(mutate(fetcher)).rejects.toMatchObject({ code: 'outcome_unknown' });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it('distinguishes abort before dispatch from abort after dispatch', async () => {
    const before = new AbortController();
    before.abort();
    const untouched = vi.fn();
    await expect(mutate(untouched, before.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(untouched).not.toHaveBeenCalled();
    const after = new AbortController();
    const fetcher = vi.fn().mockImplementation(async () => {
      after.abort();
      throw new DOMException('Aborted', 'AbortError');
    });
    await expect(mutate(fetcher, after.signal)).rejects.toMatchObject({ code: 'outcome_unknown' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
