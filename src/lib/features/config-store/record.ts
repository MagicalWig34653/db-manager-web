// SPDX-License-Identifier: AGPL-3.0-only
import type { ConnectionDraft } from '$lib/workbench';
import { safeSql } from '../sql-editor/storage.svelte';
import { scopeFor } from './identity';
import { configStoreFor } from './store.svelte';

/**
 * Called when a SQL statement starts. Returns true when the server store is responsible (it then writes history only
 * with the server-side opt-in, buffered during an outage) and false when the browser-local W-P16 mode must handle it.
 */
export async function recordServerHistory(
  connection: ConnectionDraft,
  sql: string,
  token: string,
): Promise<boolean> {
  const store = configStoreFor(token);
  await store.ensureReady();
  if (!store.active) return false;
  if (!store.privacyKnown) {
    // The opt-in cannot be read (outage right after start): pause and show it instead of silently dropping.
    store.historyPaused = true;
    return true;
  }
  if (!store.historyEnabled) return true;
  if (!safeSql(sql, [connection.password, token])) return true;
  await store.write('history', await scopeFor(connection), { sql });
  return true;
}

/** Writes "recently used" when a table is opened; only in server mode, failures are ignored (comfort data). */
export async function recordRecent(
  connection: ConnectionDraft,
  token: string,
  object: { name: string; schema?: string },
): Promise<void> {
  const store = configStoreFor(token);
  await store.ensureReady();
  if (!store.active || store.degraded) return;
  await store.touchRecent(await scopeFor(connection), object.name, object.schema);
}
