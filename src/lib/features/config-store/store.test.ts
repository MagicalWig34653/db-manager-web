// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import { WriteBuffer } from './buffer.svelte';
import { ConfigClient, ConfigError } from './client';
import { ServerLibrary } from './library.svelte';
import { errorText } from './model';
import { ConfigStore } from './store.svelte';
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
const SCOPE = 'a'.repeat(64);

describe('capabilities and mode', () => {
  it('uses the server only when available and mode server', async () => {
    const store = make();
    await store.ensureReady();
    expect(store.mode).toBe('server');
    expect(store.reason).toBe('ok');
    expect(store.caps?.owner_model).toBe('single');
    expect(fake.calls.map((c) => c.path)).toContain('/api/v24/capabilities');
  });
  it.each([
    ['not_configured', 'not_configured'],
    ['unreachable', 'unreachable'],
    ['missing', 'unsupported'],
  ] as const)('stays in local mode with a clear reason (%s)', async (state, reason) => {
    fake.state = state;
    const store = make();
    await store.ensureReady();
    expect(store.mode).toBe('local');
    expect(store.reason).toBe(reason);
    // Only the capabilities call was made: no data route is touched in local mode.
    expect(fake.calls.every((c) => c.path === '/api/v24/capabilities')).toBe(true);
  });
  it('treats a failed or invalid capabilities answer as local mode without raw text', async () => {
    fake.failNetwork = true;
    const store = make();
    await store.ensureReady();
    expect(store.mode).toBe('local');
    expect(store.reason).toBe('error');
    const bad = new ConfigStore('t', {
      client: new ConfigClient(
        async () =>
          new Response('{"mode":"server"}', { headers: { 'Content-Type': 'application/json' } }),
      ),
      buffer: new WriteBuffer(() => localStorage),
    });
    await bad.ensureReady();
    expect(bad.mode).toBe('local');
  });
  it('recovers from local_only without a reload once the server answers again', async () => {
    fake.state = 'unreachable';
    let now = 0;
    const store = new ConfigStore(fake.token, {
      client: new ConfigClient(fake.fetch),
      buffer: new WriteBuffer(() => localStorage),
      now: () => now,
    });
    await store.ensureReady();
    expect(store.mode).toBe('local');
    fake.state = 'server';
    await store.ensureReady();
    expect(store.mode).toBe('local'); // rechecked at most every 30 s
    now = 31000;
    await store.ensureReady();
    expect(store.mode).toBe('server');
  });
  it('rejects a wrong token as local mode, not as saved', async () => {
    const store = make('wrong');
    await store.ensureReady();
    expect(store.mode).toBe('local');
  });
});

describe('history opt-in', () => {
  it('writes no history without the server-side opt-in and corrects a stale local belief', async () => {
    const store = make();
    await store.ensureReady();
    expect(store.historyEnabled).toBe(false);
    const refused = await store.write('history', SCOPE, { sql: 'SELECT 1' });
    expect(refused).toEqual({ ok: false, code: 'history_disabled' });
    expect(fake.count('history')).toBe(0);
    expect(store.buffer.entries).toHaveLength(0);
    expect((await store.setHistoryEnabled(true)).ok).toBe(true);
    expect(store.historyEnabled).toBe(true);
    expect((await store.write('history', SCOPE, { sql: 'SELECT 1' })).ok).toBe(true);
    // Switched off elsewhere: the next refused write flips the local flag.
    [...fake.items.values()].find((i) => i.key === 'privacy')!.data.history_enabled = false;
    expect(await store.write('history', SCOPE, { sql: 'SELECT 2' })).toEqual({
      ok: false,
      code: 'history_disabled',
    });
    expect(store.historyEnabled).toBe(false);
  });
  it('toggles through create then versioned update and shows the server state after a conflict', async () => {
    const store = make();
    await store.ensureReady();
    await store.setHistoryEnabled(true);
    await store.setHistoryEnabled(false);
    const put = fake.calls.find((c) => c.method === 'PUT')!;
    expect(put.ifMatch).toBe('"1"');
    expect(store.historyEnabled).toBe(false);
    // Another device changed it: stale version -> 412 -> reloaded state, not overwritten.
    [...fake.items.values()].find((i) => i.key === 'privacy')!.version = 7;
    [...fake.items.values()].find((i) => i.key === 'privacy')!.data.history_enabled = true;
    const result = await store.setHistoryEnabled(false);
    expect(result).toEqual({ ok: false, code: 'version_conflict' });
    expect(store.historyEnabled).toBe(true);
  });
  it('loads the existing opt-in on start', async () => {
    fake.seed('settings', { history_enabled: true }, '', 'privacy');
    const store = make();
    await store.ensureReady();
    expect(store.historyEnabled).toBe(true);
  });
});

describe('errors never echo input', () => {
  it('maps secret rejection and quota to catalog text without the SQL', async () => {
    const store = make();
    await store.ensureReady();
    const sql = "ALTER USER x IDENTIFIED BY 'hunter2-PASSWORD'";
    const result = await store.write('bookmarks', SCOPE, { name: 'n', sql });
    expect(result).toEqual({ ok: false, code: 'secret_rejected' });
    const text = errorText(result.ok ? '' : result.code);
    expect(text).not.toContain('hunter2');
    expect(text).toContain('Zugangsdaten');
    fake.limitOverride.bookmarks = 1;
    await store.write('bookmarks', SCOPE, { name: 'a', sql: 'SELECT 1' });
    const second = await store.write('bookmarks', SCOPE, { name: 'b', sql: 'SELECT 2' });
    expect(second).toEqual({ ok: false, code: 'quota_exceeded' });
    expect(errorText(new ConfigError('weird_new_code'))).toBe('Der Vorgang ist fehlgeschlagen.');
  });
});

describe('server library', () => {
  const library = async (store: ConfigStore) => {
    await store.ensureReady();
    const lib = new ServerLibrary(store, SCOPE, () => ['pw', 'token']);
    await lib.load();
    return lib;
  };
  it('pages with cursors newest first and keeps scopes apart', async () => {
    for (let i = 0; i < 60; i++)
      fake.seed('bookmarks', { name: `b${i}`, sql: `SELECT ${i}` }, SCOPE);
    fake.seed('bookmarks', { name: 'other', sql: 'SELECT 0' }, 'b'.repeat(64));
    const lib = await library(make());
    expect(lib.bookmarks).toHaveLength(50);
    expect(lib.bookmarks[0].name).toBe('b59');
    expect(lib.cursor.bookmarks).not.toBe('');
    await lib.more('bookmarks');
    expect(lib.bookmarks).toHaveLength(60);
    expect(lib.cursor.bookmarks).toBe('');
    expect(lib.bookmarks.some((b) => b.name === 'other')).toBe(false);
  });
  it('sends exactly one request for a double click', async () => {
    const lib = await library(make());
    const first = lib.bookmark('Mark', 'SELECT 1');
    const second = lib.bookmark('Mark', 'SELECT 1');
    expect(await first).toBe('saved');
    expect(await second).toBe('');
    expect(fake.writes().filter((c) => c.path === '/api/v24/config/bookmarks')).toHaveLength(1);
  });
  it('refuses local secrets before any request', async () => {
    const lib = await library(make());
    const before = fake.calls.length;
    expect(await lib.bookmark('x', "SELECT 'pw'")).toBe(lib.error);
    expect(await lib.bookmark('x', 'ALTER USER a IDENTIFIED BY b')).toBe(lib.error);
    expect(fake.calls.length).toBe(before);
  });
  it('deletes with If-Match and reloads after a stale version', async () => {
    const store = make();
    const lib = await library(store);
    await lib.bookmark('A', 'SELECT 1');
    await lib.load();
    const entry = lib.bookmarks[0];
    fake.items.get(entry.id)!.version = 5;
    expect(await lib.remove('bookmarks', entry)).toBe(false);
    expect(fake.calls.filter((c) => c.method === 'DELETE')[0].ifMatch).toBe('"1"');
    expect(lib.error).toContain('geändert');
    const fresh = lib.bookmarks[0];
    expect(fresh.version).toBe(5);
    expect(await lib.remove('bookmarks', fresh)).toBe(true);
    expect(fake.count('bookmarks')).toBe(0);
  });
  it('offers a merge choice on a stale edit and never overwrites silently', async () => {
    const store = make();
    const lib = await library(store);
    await lib.bookmark('A', 'SELECT 1');
    await lib.load();
    const entry = lib.bookmarks[0];
    const rec = fake.items.get(entry.id)!;
    rec.data = { name: 'Server', sql: 'SELECT 2' };
    rec.version = 2;
    expect(await lib.edit(entry, 'Mine', 'SELECT 1')).toBe(false);
    expect(lib.conflict?.current?.data.name).toBe('Server');
    expect(fake.items.get(entry.id)!.data.name).toBe('Server');
    expect(await lib.resolve('mine')).toBe(true);
    expect(fake.items.get(entry.id)!.data).toEqual({ name: 'Mine', sql: 'SELECT 1' });
    expect(fake.items.get(entry.id)!.version).toBe(3);
    expect(lib.conflict).toBeNull();
  });
  it('keeps the server version when chosen', async () => {
    const lib = await library(make());
    await lib.bookmark('A', 'SELECT 1');
    await lib.load();
    const entry = lib.bookmarks[0];
    fake.items.get(entry.id)!.version = 4;
    await lib.edit(entry, 'Mine', 'SELECT 1');
    expect(await lib.resolve('server')).toBe(true);
    expect(fake.items.get(entry.id)!.data.name).toBe('A');
  });
});

describe('outage buffer', () => {
  it('buffers during 503, shows entries as pending and replays idempotently without loss or duplicates', async () => {
    const store = make();
    await store.ensureReady();
    await store.setHistoryEnabled(true);
    fake.down = true;
    const result = await store.write('bookmarks', SCOPE, { name: 'Buffered', sql: 'SELECT 1' });
    expect(result).toMatchObject({ ok: true, buffered: true });
    expect(store.degraded).toBe(true);
    expect(store.buffer.entries).toHaveLength(1);
    // Persisted in this browser: a fresh buffer (page reload) still has it.
    expect(new WriteBuffer(() => localStorage).entries).toHaveLength(1);
    const lib = new ServerLibrary(store, SCOPE, () => []);
    expect(lib.shown('bookmarks')[0]).toMatchObject({ name: 'Buffered', pending: true });
    fake.down = false;
    await store.ensureReady(true);
    expect(store.degraded).toBe(false);
    expect(store.buffer.entries).toHaveLength(0);
    expect(fake.count('bookmarks', SCOPE)).toBe(1);
    // Replaying the same buffer again (lost answer) must not duplicate.
    const ref =
      fake.items.size && [...fake.items.values()].find((i) => i.kind === 'bookmarks')!.client_ref;
    const again = await store.importBatch([
      {
        kind: 'bookmarks',
        scope: SCOPE,
        client_ref: ref as string,
        data: { name: 'Buffered', sql: 'SELECT 1' },
      },
    ]);
    expect(again.ok && again.value.exists).toBe(1);
    expect(fake.count('bookmarks', SCOPE)).toBe(1);
  });
  it('treats a lost answer after sending as an outage with an idempotent replay', async () => {
    const store = make();
    await store.ensureReady();
    fake.loseNextWriteAnswer = true;
    const result = await store.write('bookmarks', SCOPE, { name: 'Lost', sql: 'SELECT 1' });
    expect(result).toMatchObject({ ok: true, buffered: true });
    expect(fake.count('bookmarks')).toBe(1); // it did commit on the server
    await store.ensureReady(true);
    expect(fake.count('bookmarks')).toBe(1); // replay found it (exists)
    expect(store.buffer.entries).toHaveLength(0);
  });
  it('tells when the buffer is full instead of pretending to save', async () => {
    const store = make();
    await store.ensureReady();
    fake.down = true;
    for (let i = 0; i < 200; i++)
      await store.write('bookmarks', SCOPE, { name: `n${i}`, sql: 'SELECT 1' });
    const full = await store.write('bookmarks', SCOPE, { name: 'over', sql: 'SELECT 1' });
    expect(full).toEqual({ ok: false, code: 'buffer_full' });
  });
  it('drops buffered entries the server rejects and reports them', async () => {
    const store = make();
    await store.ensureReady();
    fake.down = true;
    await store.write('history', SCOPE, { sql: 'SELECT 1' }); // opt-in unknown locally: buffered
    fake.down = false;
    await store.ensureReady(true);
    expect(store.buffer.entries).toHaveLength(0);
    expect(store.droppedOnReplay).toBe(1);
    expect(fake.count('history')).toBe(0);
  });
});

describe('documents, favorites, recents, searches, layouts', () => {
  it('saves a layout document with versions and reports a conflict instead of overwriting', async () => {
    const store = make();
    await store.ensureReady();
    const key = 'table:db.users';
    const created = await store.saveDocument(
      'layouts',
      key,
      { columns: ['id', 'name'], widths: { id: 80 } },
      null,
      SCOPE,
    );
    expect(created.ok).toBe(true);
    const item = created.ok ? created.value : null;
    const updated = await store.saveDocument(
      'layouts',
      key,
      { columns: ['name', 'id'] },
      item,
      SCOPE,
    );
    expect(updated.ok && updated.value.version).toBe(2);
    const stale = await store.saveDocument('layouts', key, { columns: ['x'] }, item, SCOPE);
    expect(stale).toMatchObject({ ok: false, code: 'version_conflict' });
    expect('conflict' in stale && stale.conflict?.data).toEqual({ columns: ['name', 'id'] });
    const dup = await store.saveDocument('layouts', key, { columns: ['y'] }, null, SCOPE);
    expect(dup).toMatchObject({ ok: false, code: 'version_conflict' });
  });
  it('keeps favorites idempotent and pulls recents to the top', async () => {
    const store = make();
    await store.ensureReady();
    const a = await store.addFavorite(SCOPE, 'users', 'app');
    const b = await store.addFavorite(SCOPE, 'users', 'app');
    expect(a.ok && a.value.created).toBe(true);
    expect(b.ok && b.value.created).toBe(false);
    expect(fake.count('favorites')).toBe(1);
    await store.touchRecent(SCOPE, 'one');
    await store.touchRecent(SCOPE, 'two');
    await store.touchRecent(SCOPE, 'one');
    const list = await store.listPage('recents', { scope: SCOPE });
    expect(list.ok && list.value.items.map((i) => i.data.table)).toEqual(['one', 'two']);
    const saved = await store.saveSearch(SCOPE, 'Search', { text: 'abc' });
    expect(saved.ok).toBe(true);
    expect(fake.count('searches')).toBe(1);
  });
  it('never sends anything but the allowlisted appearance values as a setting', async () => {
    const store = make();
    await store.ensureReady();
    const secret = await store.saveDocument(
      'settings',
      'appearance',
      { theme: 'dark', locale: 'de', password: 'x' },
      null,
    );
    expect(secret).toMatchObject({ ok: false, code: 'secret_rejected' });
  });
});
