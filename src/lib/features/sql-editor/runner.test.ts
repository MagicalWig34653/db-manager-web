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
