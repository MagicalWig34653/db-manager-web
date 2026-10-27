// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api';
import { emptyConnection } from '$lib/workbench';
import { BulkClient, errorText, isRejection } from './client';
import { executeRequest, planRequest, selection } from './model';

const fixture = (name: string) =>
  JSON.parse(readFileSync(`src/lib/features/bulk/fixtures/${name}.json`, 'utf8'));
const connection = { ...emptyConnection(), database: 'synthetic' };
const table = { schema: 'main', name: 'p13_items' };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const signal = () => new AbortController().signal;
const rows = selection(
  {
    columns: [{ name: 'id', type: 'INTEGER' }],
    rows: [[{ kind: 'integer', value: '1' }], [{ kind: 'integer', value: '2' }]],
    truncated: false,
  },
  [0, 1],
).snapshots;
const deleteRequest = () => {
  const base = planRequest(connection, table, 'delete', rows);
  const plan = fixture('RowsBulkPlan.real-TestSQLiteRowsBulk');
  return executeRequest(base, {
    ...plan,
    rows: [{ ...plan.rows[0] }, { ...plan.rows[0] }],
  });
};
const client = (fetcher: (path: string, init: RequestInit) => Promise<Response>) =>
  new BulkClient(fetcher as unknown as typeof fetch);

it('returns typed results for 200 and for rejected or unknown 4xx/5xx answers', async () => {
  const dispatch = vi.fn();
  const ok = client(async () => json(fixture('RowsBulkResult.real-TestSQLiteRowsBulk')));
  const request = deleteRequest();
  const results = [
    await ok.execute(request, 't', signal(), dispatch),
    await client(async () => json(fixture('RowsBulkResult.rejected-placeholder'), 409)).execute(
      request,
      't',
      signal(),
      dispatch,
    ),
    await client(async () =>
      json(fixture('RowsBulkResult.outcome_unknown-placeholder'), 503),
    ).execute(request, 't', signal(), dispatch),
  ];
  expect(results.map((r) => r.outcome)).toEqual(['completed', 'rejected', 'outcome_unknown']);
  expect(dispatch).toHaveBeenCalledTimes(3);
});

it('maps an error body to a code, hides server text and keeps unknown for network loss after dispatch', async () => {
  const dispatch = vi.fn();
  const conflict = client(async () =>
    json({ error: { code: 'plan_conflict', message: 'geheim <b>' } }, 409),
  );
  const failure = await conflict.execute(deleteRequest(), 't', signal(), dispatch).catch((e) => e);
  expect(failure).toBeInstanceOf(ApiError);
  expect(failure.code).toBe('plan_conflict');
  expect(failure.message).not.toContain('geheim');
  expect(isRejection(failure)).toBe(true);
  const lost = client(async () => {
    throw new TypeError('network');
  });
  const unknown = await lost.execute(deleteRequest(), 't', signal(), dispatch).catch((e) => e);
  expect(unknown.code).toBe('outcome_unknown');
  expect(isRejection(unknown)).toBe(false);
  const truncated = client(
    async () =>
      new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  expect(
    (await truncated.execute(deleteRequest(), 't', signal(), dispatch).catch((e) => e)).code,
  ).toBe('outcome_unknown');
  expect(errorText(new ApiError('zzz', ''))).toBe(errorText(new ApiError('other', '')));
});

it('rejects a result that mentions rows outside the request', async () => {
  const bad = client(async () =>
    json({ outcome: 'completed', rows: [{ index: 5, outcome: 'completed' }] }),
  );
  await expect(bad.execute(deleteRequest(), 't', signal(), vi.fn())).rejects.toMatchObject({
    code: 'invalid_response',
  });
});

it('plans with POST JSON, validates the answer and sends the bearer token without credentials', async () => {
  const seen: { path: string; init: RequestInit }[] = [];
  const c = client(async (path, init) => {
    seen.push({ path, init });
    return json(fixture('RowsBulkPlan.real-TestSQLiteRowsBulk'));
  });
  const plan = await c.plan(planRequest(connection, table, 'delete', rows), 'tok', signal());
  expect(plan.action).toBe('copy');
  expect(seen[0].path).toBe('/api/v19/rows/plan');
  expect(seen[0].init).toMatchObject({
    method: 'POST',
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
  });
  expect((seen[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  const bad = client(async () => json({ nope: true }));
  await expect(
    bad.plan(planRequest(connection, table, 'delete', rows), 't', signal()),
  ).rejects.toMatchObject({ code: 'invalid_response' });
});

it('uploads metadata first and then exactly one file part, and refuses oversize files before sending', async () => {
  let form: FormData | null = null;
  const c = client(async (_path, init) => {
    form = init.body as FormData;
    return json({ outcome: 'committed', changed: true });
  });
  const metadata = {
    connection: planRequest(connection, table, 'delete', rows).connection,
    table,
    expected: {
      columns: ['id', 'raw'],
      values: [
        { kind: 'integer' as const, value: '1' },
        { kind: 'binary' as const, value: 'AA==' },
      ],
    },
    column: 'raw',
    confirm: true as const,
    timeout_ms: 10000,
  };
  const dispatch = vi.fn();
  const result = await c.upload(metadata, new Blob(['abc']), 't', signal(), dispatch);
  expect(result.changed).toBe(true);
  expect([...(form as unknown as FormData).keys()]).toEqual(['metadata', 'file']);
  expect(dispatch).toHaveBeenCalledTimes(1);
  const sent = vi.fn();
  await expect(
    c.upload(metadata, new Blob([new Uint8Array(512 * 1024 + 1)]), 't', signal(), sent),
  ).rejects.toMatchObject({ code: 'file_too_large' });
  expect(sent).not.toHaveBeenCalled();
  const conflict = client(async () => json({ error: { code: 'row_conflict', message: 'x' } }, 409));
  await expect(
    conflict.upload(metadata, new Blob(['abc']), 't', signal(), vi.fn()),
  ).rejects.toMatchObject({ code: 'row_conflict' });
});

function stream(chunks: Uint8Array[], failAfter = false) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (failAfter) controller.error(new Error('cut'));
      else controller.close();
    },
  });
}
const base = {
  connection: planRequest(connection, table, 'delete', rows).connection,
  table,
  expected: { columns: ['id'], values: [{ kind: 'integer' as const, value: '1' }] },
  column: 'raw',
};

it('downloads only complete bodies that match Content-Length and the size limit', async () => {
  const ok = client(
    async () =>
      new Response(stream([new Uint8Array([1, 2]), new Uint8Array([3])]), {
        headers: { 'content-type': 'application/octet-stream', 'content-length': '3' },
      }),
  );
  const { bytes } = await ok.download(base, 't', signal());
  expect([...bytes]).toEqual([1, 2, 3]);
  const short = client(
    async () =>
      new Response(stream([new Uint8Array([1, 2])]), {
        headers: { 'content-type': 'application/octet-stream', 'content-length': '3' },
      }),
  );
  await expect(short.download(base, 't', signal())).rejects.toMatchObject({
    code: 'network_error',
  });
  const cut = client(
    async () =>
      new Response(stream([new Uint8Array([1])], true), {
        headers: { 'content-type': 'application/octet-stream', 'content-length': '3' },
      }),
  );
  await expect(cut.download(base, 't', signal())).rejects.toMatchObject({ code: 'network_error' });
  const big = client(
    async () =>
      new Response(stream([]), {
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String(512 * 1024 + 1),
        },
      }),
  );
  await expect(big.download(base, 't', signal())).rejects.toMatchObject({
    code: 'invalid_response',
  });
  const html = client(
    async () =>
      new Response(stream([new Uint8Array([60])]), {
        headers: { 'content-type': 'text/html', 'content-length': '1' },
      }),
  );
  await expect(html.download(base, 't', signal())).rejects.toMatchObject({
    code: 'invalid_response',
  });
  const refused = client(async () =>
    json({ error: { code: 'unsupported_file_column', message: 'x' } }, 422),
  );
  await expect(refused.download(base, 't', signal())).rejects.toMatchObject({
    code: 'unsupported_file_column',
  });
});

it('looks up foreign keys with a bound search and validates the answer', async () => {
  const seen: unknown[] = [];
  const c = client(async (_path, init) => {
    seen.push(JSON.parse(init.body as string));
    return json(fixture('ForeignKeyLookupResult.real-TestSQLiteRowsBulk'));
  });
  const request = {
    connection: base.connection,
    table,
    column: 'owner',
    display_column: 'label',
    search: "x'; DROP TABLE y; --%",
    page_size: 50,
    offset: 0,
  };
  const found = await c.lookup(request, 't', signal());
  expect(found.choices.length).toBeGreaterThan(0);
  expect(seen[0]).toMatchObject({ search: request.search });
  await expect(
    c.lookup({ ...request, display_column: 'other' }, 't', signal()),
  ).rejects.toMatchObject({
    code: 'invalid_response',
  });
  await expect(
    c.lookup({ ...request, search: 'x'.repeat(257) }, 't', signal()),
  ).rejects.toMatchObject({ code: 'invalid_response' });
});

it('turns a missing v19 into unsupported_feature', async () => {
  const c = client(async () => json({ error: { code: 'not_found', message: 'x' } }, 404));
  await expect(c.capabilities('t', signal())).rejects.toMatchObject({
    code: 'unsupported_feature',
  });
});
