// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, expect, it, vi } from 'vitest';
import { gateway } from '$lib/gateway';
import { emptyConnection } from '$lib/workbench';
import { Session } from '$lib/shell/session.svelte';
import { SqlRunner } from '$lib/shell/sql.svelte';
import { libraryFor } from './storage.svelte';
afterEach(() => vi.restoreAllMocks());
it('records exactly the submitted SQL on the execution path and never executes restored data', async () => {
  const execute = vi
    .spyOn(gateway, 'execute')
    .mockResolvedValue({ results: [], warnings: [], elapsedMs: 0 });
  const session = new Session({ onConnected() {}, onCatalogSettled() {}, onCleared() {} });
  session.connection = { ...emptyConnection(), database: 'runner-example' };
  const library = await libraryFor(session.connection);
  library.setEnabled(true);
  const runner = new SqlRunner();
  runner.sql = 'SELECT 10';
  await runner.execute(session);
  await vi.waitFor(() => expect(library.history).toHaveLength(1));
  runner.sql = 'SELECT 20';
  expect(execute).toHaveBeenCalledTimes(1);
  expect(library.history[0].sql).toBe('SELECT 10');
  session.connectionBusy = true;
  await runner.execute(session);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(library.history).toHaveLength(1);
});

it('treats every run as a writer: writeCount is raised while pending and settled after the answer', async () => {
  let release: (value: { results: []; warnings: []; elapsedMs: number }) => void = () => {};
  vi.spyOn(gateway, 'execute').mockReturnValue(new Promise((resolve) => (release = resolve)));
  const session = new Session({ onConnected() {}, onCatalogSettled() {}, onCleared() {} });
  session.connection = { ...emptyConnection(), database: 'runner-writer' };
  const runner = new SqlRunner();
  runner.sql = 'DROP TABLE orders';
  const pending = runner.execute(session);
  expect(session.writeInFlight).toBe(true);
  release({ results: [], warnings: [], elapsedMs: 0 });
  await pending;
  expect(session.writeInFlight).toBe(false);
  expect(session.writeNotice).toBe(false);
});

it('marks a cancelled non-SELECT run as unknown outcome but a cancelled plain SELECT as settled', async () => {
  const session = new Session({ onConnected() {}, onCatalogSettled() {}, onCleared() {} });
  session.connection = { ...emptyConnection(), database: 'runner-cancel' };
  vi.spyOn(gateway, 'execute').mockImplementation(
    (_c, _t, _s, _o, signal) =>
      new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError'))),
      ),
  );
  const select = new SqlRunner();
  select.sql = 'SELECT 1';
  const first = select.execute(session);
  select.cancel();
  await first;
  expect(session.writeInFlight).toBe(false);
  expect(session.writeNotice).toBe(false);
  const ddl = new SqlRunner();
  ddl.sql = 'UPDATE t SET a = 1';
  const second = ddl.execute(session);
  ddl.cancel();
  await second;
  expect(session.writeInFlight).toBe(false);
  expect(session.writeNotice).toBe(true);
});

it('does not start while another writer is in flight', async () => {
  const execute = vi.spyOn(gateway, 'execute');
  const session = new Session({ onConnected() {}, onCatalogSettled() {}, onCleared() {} });
  session.connection = { ...emptyConnection(), database: 'runner-busy' };
  session.writeCount = 1;
  const runner = new SqlRunner();
  runner.sql = 'SELECT 1';
  await runner.execute(session);
  expect(execute).not.toHaveBeenCalled();
});

it('classifies only a plain single SELECT as read-only', async () => {
  const { looksReadOnly } = await import('$lib/shell/sql.svelte');
  for (const sql of ['SELECT 1', ' select * from t;', '-- c\nSHOW TABLES', 'VALUES (1)'])
    expect(looksReadOnly(sql), sql).toBe(true);
  for (const sql of [
    'WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x',
    'SELECT 1; DROP TABLE t',
    'SELECT * INTO u FROM t',
    'SELECT * FROM t FOR UPDATE',
    'DELETE FROM t',
    'EXPLAIN ANALYZE DELETE FROM t',
  ])
    expect(looksReadOnly(sql), sql).toBe(false);
});
