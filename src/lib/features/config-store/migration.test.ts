// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import type { WritePhase } from '$lib/rows';
import { readLocalLibraries, PREFIX, SqlLibrary } from '../sql-editor/storage.svelte';
import { WriteBuffer } from './buffer.svelte';
import { ClearFlow } from './clear.svelte';
import { ConfigClient } from './client';
import { Migration } from './migration.svelte';
import { prepareMigration } from './model';
import { ConfigStore } from './store.svelte';
import { FakeConfigServer } from './testing';

let fake: FakeConfigServer;
beforeEach(() => {
  localStorage.clear();
  fake = new FakeConfigServer();
});
const make = () =>
  new ConfigStore(fake.token, {
    client: new ConfigClient(fake.fetch),
    buffer: new WriteBuffer(() => localStorage),
  });
const KEY = PREFIX + 'c'.repeat(64);
function seedLocal(history = true) {
  const library = new SqlLibrary(KEY);
  library.setEnabled(history);
  library.bookmark('First', 'SELECT 1');
  library.bookmark('Second', 'SELECT 2');
  if (history) {
    library.record('SELECT 10');
    library.record('SELECT 11');
  }
}
const phases = () => {
  const seen: WritePhase[] = [];
  return { seen, receive: () => (phase: WritePhase) => seen.push(phase) };
};

describe('migration of local W-P16 data', () => {
  it('previews counts without any network request and never starts without confirmation', async () => {
    seedLocal();
    const store = make();
    await store.ensureReady();
    const before = fake.calls.length;
    const { seen, receive } = phases();
    const migration = new Migration(store, receive, () => []);
    await migration.refreshPreview();
    expect(migration.preview).toMatchObject({ bookmarks: 2, history: 0, hasHistory: true });
    migration.includeHistory = true;
    await migration.refreshPreview();
    expect(migration.preview).toMatchObject({ bookmarks: 2, history: 2 });
    expect(migration.canRun).toBe(false);
    await migration.run();
    expect(fake.calls.length).toBe(before);
    expect(seen).toEqual([]);
    expect(readLocalLibraries()).toHaveLength(1);
  });
  it('imports idempotently with client_ref, keeps local data, and a repeat creates nothing', async () => {
    seedLocal();
    const store = make();
    await store.ensureReady();
    const { seen, receive } = phases();
    const migration = new Migration(store, receive, () => []);
    migration.includeHistory = true;
    await migration.refreshPreview();
    migration.confirmed = true;
    await migration.run();
    expect(migration.phase).toBe('done');
    expect(migration.summary).toMatchObject({ created: 4, exists: 0, rejected: 0 });
    expect(fake.count('bookmarks')).toBe(2);
    expect(fake.count('history')).toBe(2);
    expect(store.historyEnabled).toBe(true); // opt-in is set first, only because history was included
    expect(seen).toEqual(['sending', 'settled']);
    expect(readLocalLibraries()[0].bookmarks).toHaveLength(2); // nothing deleted automatically
    const imports = fake.calls.filter((c) => c.path === '/api/v24/config/import');
    const sent = (imports[0].body as { items: { client_ref: string; scope: string }[] }).items;
    expect(
      sent.every((i) => /^[0-9a-f]{64}$/.test(i.client_ref) && i.scope === 'c'.repeat(64)),
    ).toBe(true);
    // Second run, e.g. after a reload (new ids locally): the server reports exists.
    const again = new Migration(store, receive, () => []);
    again.includeHistory = true;
    await again.refreshPreview();
    again.confirmed = true;
    await again.run();
    expect(again.summary).toMatchObject({ created: 0, exists: 4 });
    expect(fake.count('bookmarks')).toBe(2);
    expect(fake.count('history')).toBe(2);
  });
  it('does not touch the history opt-in when the history is not transferred', async () => {
    seedLocal();
    const store = make();
    await store.ensureReady();
    const migration = new Migration(
      store,
      () => () => {},
      () => [],
    );
    await migration.refreshPreview();
    migration.confirmed = true;
    await migration.run();
    expect(fake.count('history')).toBe(0);
    expect(store.historyEnabled).toBe(false);
    expect(fake.calls.some((c) => c.path === '/api/v24/config/settings')).toBe(false);
  });
  it('deletes only entries the server confirmed, only on the second explicit action', async () => {
    seedLocal(false);
    new SqlLibrary(KEY).bookmark('Bad', 'SELECT rejectme'); // passes the local rules, the server refuses it
    const store = make();
    await store.ensureReady();
    const migration = new Migration(
      store,
      () => () => {},
      () => [],
    );
    await migration.refreshPreview();
    migration.confirmed = true;
    await migration.run();
    expect(migration.phase).toBe('done');
    expect(migration.summary).toMatchObject({
      created: 2,
      rejected: 1,
      reasons: { secret_rejected: 1 },
    });
    expect(readLocalLibraries()[0].bookmarks).toHaveLength(3); // still all local
    migration.deleteLocal();
    expect(migration.phase).toBe('deleted');
    expect(migration.deletedCount).toBe(2);
    expect(readLocalLibraries()[0].bookmarks.map((b) => b.name)).toEqual(['Bad']);
    expect(fake.count('bookmarks')).toBe(2);
  });
  it('stops on a transport failure, reports it, leaves local data and settles the write lock', async () => {
    seedLocal(false);
    const store = make();
    await store.ensureReady();
    const { seen, receive } = phases();
    const migration = new Migration(store, receive, () => []);
    await migration.refreshPreview();
    migration.confirmed = true;
    fake.down = true;
    await migration.run();
    expect(migration.phase).toBe('failed');
    expect(migration.error).toContain('nicht erreichbar');
    expect(seen).toEqual(['sending', 'settled']);
    expect(readLocalLibraries()[0].bookmarks).toHaveLength(2);
    migration.deleteLocal(); // not allowed in the failed phase
    expect(readLocalLibraries()[0].bookmarks).toHaveLength(2);
    fake.down = false;
    migration.confirmed = true;
    await store.ensureReady(true);
    await migration.run();
    expect(migration.phase).toBe('done');
  });
  it('a double click runs exactly one transfer', async () => {
    seedLocal(false);
    const store = make();
    await store.ensureReady();
    const migration = new Migration(
      store,
      () => () => {},
      () => [],
    );
    await migration.refreshPreview();
    migration.confirmed = true;
    await Promise.all([migration.run(), migration.run()]);
    expect(fake.calls.filter((c) => c.path === '/api/v24/config/import')).toHaveLength(1);
  });
  it('splits large transfers into batches of the advertised size and skips credential-like entries', async () => {
    const library = new SqlLibrary(KEY);
    for (let i = 0; i < 120; i++) library.bookmark(`b${i}`, `SELECT ${i}`);
    const snapshots = readLocalLibraries();
    const preview = await prepareMigration(snapshots, {
      includeHistory: false,
      secrets: ['SELECT 5'],
    });
    expect(preview.skipped).toBeGreaterThan(0);
    const store = make();
    await store.ensureReady();
    const migration = new Migration(
      store,
      () => () => {},
      () => [],
    );
    await migration.refreshPreview();
    migration.confirmed = true;
    await migration.run();
    expect(fake.calls.filter((c) => c.path === '/api/v24/config/import')).toHaveLength(2);
    expect(fake.count('bookmarks')).toBe(120);
  });
});

describe('clear everything: plan then typed confirmation', () => {
  const seedServer = () => {
    fake.seed('bookmarks', { name: 'a', sql: 'SELECT 1' }, 's');
    fake.seed('favorites', { table: 't' }, 's');
  };
  it('shows the plan, requires the exact typed text and deletes afterwards only', async () => {
    seedServer();
    const store = make();
    await store.ensureReady();
    const { seen, receive } = phases();
    const flow = new ClearFlow(store, receive);
    await flow.loadPlan(['bookmarks', 'favorites']);
    expect(flow.plan?.confirmation).toBe('LÖSCHEN 2');
    expect(fake.count('bookmarks')).toBe(1);
    flow.typed = 'löschen 2';
    expect(flow.canExecute).toBe(false);
    await flow.execute();
    expect(fake.writes().filter((c) => c.path.endsWith('/execute'))).toHaveLength(0);
    flow.typed = 'LÖSCHEN 2';
    await Promise.all([flow.execute(), flow.execute()]);
    expect(flow.phase).toBe('done');
    expect(flow.result?.total).toBe(2);
    expect(fake.items.size).toBe(0);
    expect(fake.writes().filter((c) => c.path.endsWith('/execute'))).toHaveLength(1);
    expect(seen).toEqual(['sending', 'settled']);
  });
  it('a plan changed in between deletes nothing and demands a new preview', async () => {
    seedServer();
    const store = make();
    await store.ensureReady();
    const flow = new ClearFlow(store, () => () => {});
    await flow.loadPlan(['bookmarks', 'favorites']);
    fake.seed('bookmarks', { name: 'late', sql: 'SELECT 9' }, 's');
    flow.typed = flow.plan!.confirmation;
    await flow.execute();
    expect(flow.phase).toBe('failed');
    expect(flow.error).toContain('Vorschau');
    expect(fake.items.size).toBe(3);
  });
  it('flags a lost answer as unknown and reports the unknown write phase', async () => {
    seedServer();
    const store = make();
    await store.ensureReady();
    const { seen, receive } = phases();
    const flow = new ClearFlow(store, receive);
    await flow.loadPlan(['bookmarks']);
    flow.typed = flow.plan!.confirmation;
    fake.loseNextWriteAnswer = true;
    await flow.execute();
    expect(flow.unknown).toBe(true);
    expect(seen).toEqual(['sending', 'unknown']);
  });
  it('an empty plan cannot be executed', async () => {
    const store = make();
    await store.ensureReady();
    const flow = new ClearFlow(store, () => () => {});
    await flow.loadPlan(['history']);
    flow.typed = flow.plan!.confirmation;
    expect(flow.canExecute).toBe(false);
  });
  it('exports everything as the validated server document', async () => {
    seedServer();
    const store = make();
    await store.ensureReady();
    const exported = await store.exportAll();
    expect(exported.ok && exported.value.count).toBe(2);
    expect(exported.ok && JSON.parse(exported.value.text).format).toBe('dbm-config-export');
  });
});
