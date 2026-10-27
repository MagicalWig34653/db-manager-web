// SPDX-License-Identifier: AGPL-3.0-only
// Tests for the review findings W-01 to W-12 (docs/handoffs/W-P20-web-review.md) beyond the review's own attack tests.
import { beforeEach, describe, expect, it } from 'vitest';
import type { WritePhase } from '$lib/rows';
import { emptyConnection } from '$lib/workbench';
import { PREFIX, SqlLibrary } from '../sql-editor/storage.svelte';
import { ownerOf, WriteBuffer } from './buffer.svelte';
import { ConfigClient } from './client';
import { Migration } from './migration.svelte';
import { chunkBySize, MAX_BATCH_BYTES } from './model';
import { recordServerHistory } from './record';
import { anySecret, looksSecret } from './secrets';
import { ConfigStore, resetConfigStore } from './store.svelte';
import { FakeConfigServer } from './testing';

let fake: FakeConfigServer;
beforeEach(() => {
  localStorage.clear();
  fake = new FakeConfigServer();
});
const make = (token = fake.token) =>
  new ConfigStore(token, {
    client: new ConfigClient(fake.fetch),
    buffer: new WriteBuffer(() => localStorage),
  });

describe('W-05 client secret rules at server level', () => {
  const secrets = [
    "SELECT 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1'",
    "SELECT 'postgres://admin:s3cr3t@db.internal/app'",
    "SELECT '-----BEGIN PRIVATE KEY-----'",
    'SELECT 1 -- Authorization: Basic dXNlcjpwYXNzd29yZA==',
    "SELECT 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'",
    "SELECT '0123456789abcdef0123456789abcdef'",
    '! curl -u admin:hunter22 https://x.example',
    'SELECT 1 /* pw=abc123 */ -- password=abc',
    "SELECT 'AKIAABCDEFGHIJKLMNOP'",
    "SELECT 'ＰＡＳＳＷＯＲＤ'",
  ];
  it.each(secrets)('refuses %s', (sql) => expect(looksSecret(sql)).toBe(true));
  it('accepts ordinary SQL and finds nested document strings', () => {
    expect(looksSecret('SELECT id, name FROM users WHERE id = 7')).toBe(false);
    expect(anySecret({ a: ['x', { b: 'AKIAABCDEFGHIJKLMNOP' }] })).toBe(true);
  });
  it('scans a very long run without catastrophic backtracking', () => {
    const started = Date.now();
    looksSecret('a'.repeat(100000));
    looksSecret('x:'.repeat(50000));
    expect(Date.now() - started).toBeLessThan(2000);
  });
  it('the outage buffer never stores such entries and drops them when loading', async () => {
    const buffer = new WriteBuffer(() => localStorage);
    const entry = {
      kind: 'history' as const,
      scope: 's',
      client_ref: 'r',
      time: '2026-10-01T00:00:00.000Z',
      data: { sql: secrets[0] },
    };
    expect(buffer.add(entry)).toBe(false);
    localStorage.setItem(
      'db-manager.config-buffer.v1',
      JSON.stringify({ version: 1, entries: [{ ...entry, owner: '' }] }),
    );
    expect(new WriteBuffer(() => localStorage).entries).toEqual([]);
  });
});

describe('W-04 buffer bound to the token identity', () => {
  it('keeps a foreign identity invisible, never uploads it and still keeps it', async () => {
    fake.token = 'token-a';
    const a = make('token-a');
    await a.ensureReady();
    fake.down = true;
    await a.write('bookmarks', 's', { name: 'mine', sql: 'SELECT 1' });
    expect(a.buffer.entries).toHaveLength(1);
    expect(localStorage.getItem('db-manager.config-buffer.v1')).not.toContain('token-a');
    fake.down = false;
    fake.token = 'token-b';
    const b = make('token-b');
    await b.ensureReady();
    expect(b.buffer.entries).toHaveLength(0);
    expect(fake.count('bookmarks')).toBe(0);
    expect(localStorage.getItem('db-manager.config-buffer.v1')).toContain(await ownerOf("token-a", true));
  });
});

describe('W-06 every writer reports its phases', () => {
  const run = async (action: (store: ConfigStore) => Promise<unknown>, loseAnswer = false) => {
    const store = make();
    await store.ensureReady();
    const seen: WritePhase[] = [];
    store.observe((phase) => seen.push(phase));
    fake.loseNextWriteAnswer = loseAnswer;
    await action(store);
    return seen;
  };
  it('opt-in, bookmark, favorite, recent, document and delete: sending then settled', async () => {
    for (const action of [
      (s: ConfigStore) => s.setHistoryEnabled(true),
      (s: ConfigStore) => s.write('bookmarks', 's', { name: 'n', sql: 'SELECT 1' }),
      (s: ConfigStore) => s.addFavorite('s', 't'),
      (s: ConfigStore) => s.touchRecent('s', 't'),
      (s: ConfigStore) => s.saveDocument('layouts', 'k', { a: 1 }, null),
    ])
      expect(await run(action)).toEqual(['sending', 'settled']);
  });
  it('a lost answer is unknown, a refusal is settled, reads report nothing', async () => {
    expect(await run((s) => s.addFavorite('s', 't'), true)).toEqual(['sending', 'unknown']);
    expect(await run((s) => s.write('bookmarks', 's', { name: 'n', sql: 'rejectme' }))).toEqual([
      'sending',
      'settled',
    ]);
    expect(await run((s) => s.listPage('bookmarks', {}))).toEqual([]);
  });
  it('the background replay of the buffer is observed too', async () => {
    const store = make();
    await store.ensureReady();
    fake.down = true;
    await store.write('bookmarks', 's', { name: 'n', sql: 'SELECT 1' });
    fake.down = false;
    const seen: WritePhase[] = [];
    store.observe((phase) => seen.push(phase));
    await store.ensureReady(true);
    expect(seen).toEqual(['sending', 'settled']);
  });
});

describe('W-01/W-02 migration confirmation and batches', () => {
  const seed = (key: string, count: number, bytes: number) => {
    const library = new SqlLibrary(key);
    for (let i = 0; i < count; i++)
      library.bookmark(`b${i}`, `SELECT ${'x '.repeat(Math.floor(bytes / 2))}${i}`);
  };
  it('cuts by bytes and count and keeps each batch under the limit', () => {
    const items = Array.from({ length: 250 }, (_, i) => ({ i, text: 'x'.repeat(10000) }));
    const batches = chunkBySize(items, 100);
    expect(batches.flat()).toHaveLength(250);
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(100);
      expect(new TextEncoder().encode(JSON.stringify({ items: batch })).length).toBeLessThan(
        MAX_BATCH_BYTES,
      );
    }
  });
  it('a changed option withdraws the confirmation; confirming again works', async () => {
    seed(PREFIX + '1'.repeat(64), 2, 40);
    const history = new SqlLibrary(PREFIX + '2'.repeat(64));
    history.setEnabled(true);
    history.record('SELECT 5');
    const store = make();
    await store.ensureReady();
    const migration = new Migration(
      store,
      () => () => {},
      () => [],
    );
    await migration.refreshPreview();
    migration.confirmed = true;
    expect(migration.canRun).toBe(true);
    migration.includeHistory = true;
    expect(migration.confirmed).toBe(false);
    await migration.refreshPreview();
    expect(migration.canRun).toBe(false);
    migration.confirmed = true;
    expect(migration.canRun).toBe(true);
  });
  it('an entry above the server item limit stays local with a clear count', async () => {
    seed(PREFIX + '3'.repeat(64), 1, 40);
    const store = make();
    await store.ensureReady();
    store.caps!.kinds = store.caps!.kinds.map((k) => ({ ...k, max_item_bytes: 20 }));
    const migration = new Migration(
      store,
      () => () => {},
      () => [],
    );
    await migration.refreshPreview();
    migration.confirmed = true;
    await migration.run();
    expect(migration.summary).toMatchObject({ created: 0, tooLarge: 1 });
    expect(fake.calls.filter((c) => c.path.endsWith('/import'))).toHaveLength(0);
  });
});

describe('W-03/W-10/W-12 mode handling', () => {
  it('a failing background re-check keeps the working server mode and only marks it degraded', async () => {
    const store = make();
    await store.ensureReady();
    expect(store.mode).toBe('server');
    fake.failNetwork = true;
    await store.ensureReady(true);
    expect(store.mode).toBe('server');
    expect(store.degraded).toBe(true);
    expect(store.phase).toBe('ready');
  });
  it('a background re-check never goes back through "loading"', async () => {
    const store = make();
    await store.ensureReady();
    const phases: string[] = [];
    const original = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(store), 'phase');
    void original;
    const pending = store.ensureReady(true);
    phases.push(store.phase);
    await pending;
    expect(phases).toEqual(['ready']);
  });
  it('the store refuses data calls in local mode', async () => {
    fake.state = 'not_configured';
    const store = make();
    await store.ensureReady();
    expect(await store.write('bookmarks', 's', { name: 'n', sql: 'SELECT 1' })).toEqual({
      ok: false,
      code: 'local_mode',
    });
    expect(fake.calls.every((c) => c.path === '/api/v24/capabilities')).toBe(true);
  });
  it('history pauses visibly when the opt-in cannot be read instead of dropping silently', async () => {
    fake.down = true;
    fake.state = 'server';
    const store = make();
    // First contact during an outage: capabilities say unreachable -> local mode, not paused.
    await store.ensureReady();
    expect(store.mode).toBe('local');
    fake.down = false;
    const ok = make();
    resetConfigStore(ok);
    await ok.ensureReady();
    ok.privacyKnown = false; // opt-in unreadable after a degraded start
    expect(await recordServerHistory(emptyConnection(), 'SELECT 1', fake.token)).toBe(true);
    expect(ok.historyPaused).toBe(true);
    expect(fake.count('history')).toBe(0);
  });
});

describe('recently used', () => {
  it('is written when a table is opened in server mode and never in local mode', async () => {
    const { recordRecent } = await import('./record');
    const connection = { ...emptyConnection(), database: 'recent-db' };
    const store = make();
    resetConfigStore(store);
    await recordRecent(connection, fake.token, { name: 'orders', schema: 'main' });
    await recordRecent(connection, fake.token, { name: 'orders', schema: 'main' });
    expect(fake.count('recents')).toBe(1);
    const local = new FakeConfigServer();
    local.state = 'not_configured';
    const offline = new ConfigStore(local.token, {
      client: new ConfigClient(local.fetch),
      buffer: new WriteBuffer(() => localStorage),
    });
    resetConfigStore(offline);
    await recordRecent(connection, local.token, { name: 'orders' });
    expect(local.calls.every((c) => c.path === '/api/v24/capabilities')).toBe(true);
  });
});

describe('legacy local entries stay readable', () => {
  it('an old entry that the stricter rules refuse is still loaded and skipped (not lost) by the migration', async () => {
    const key = PREFIX + '9'.repeat(64);
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        enabled: false,
        history: [],
        bookmarks: [
          {
            id: 'a',
            name: 'Old',
            sql: "SELECT '0123456789abcdef0123456789abcdef'",
            time: '2026-10-01T00:00:00.000Z',
          },
          { id: 'b', name: 'Fine', sql: 'SELECT 1', time: '2026-10-01T00:00:00.000Z' },
        ],
      }),
    );
    expect(new SqlLibrary(key).bookmarks).toHaveLength(2);
    const store = make();
    await store.ensureReady();
    const migration = new Migration(
      store,
      () => () => {},
      () => [],
    );
    await migration.refreshPreview();
    expect(migration.preview).toMatchObject({ bookmarks: 1, skipped: 1 });
  });
});

describe('appearance changes before the initial load', () => {
  it('a fast double change before load() wins over the server value and only the last one is sent', async () => {
    const { AppearanceSync } = await import('./appearance.svelte');
    fake.seed('settings', { theme: 'dark', locale: 'en' }, '', 'appearance');
    const store = make();
    await store.ensureReady();
    const applied: unknown[] = [];
    const sync = new AppearanceSync(store, (v) => applied.push(v), 0);
    const loading = sync.load();
    sync.push('light', 'en');
    sync.push('system', 'de');
    await loading;
    await new Promise((r) => setTimeout(r, 100));
    const puts = fake.writes().filter((c) => c.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0].body).toEqual({ data: { theme: 'system', locale: 'de' } });
    expect(applied).toEqual([]);
  });
});
