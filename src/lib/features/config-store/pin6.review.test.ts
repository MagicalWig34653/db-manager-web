// SPDX-License-Identifier: AGPL-3.0-only
// Independent attack tests of the PIN-BUNDLE-6 review (docs/handoffs/PIN-BUNDLE-6-review.md in the backend repository):
// they re-check the W-P20 web review fixes W-01..W-12 without relying on the author's tests. `it.fails` marks a
// confirmed defect (the assertion states the wanted behaviour; the suite turns red once the defect is fixed).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WritePhase } from '$lib/rows';
import { PREFIX, SqlLibrary, readLocalLibraries } from '../sql-editor/storage.svelte';
import { ownerOf, WriteBuffer, BUFFER_KEY } from './buffer.svelte';
import { AppearanceSync } from './appearance.svelte';
import { ConfigClient } from './client';
import { Migration } from './migration.svelte';
import { MAX_BATCH_BYTES } from './model';
import { ConfigStore } from './store.svelte';
import { FakeConfigServer } from './testing';

let fake: FakeConfigServer;
beforeEach(() => {
  localStorage.clear();
  fake = new FakeConfigServer();
});
const make = (token = fake.token, now?: () => number) =>
  new ConfigStore(token, {
    client: new ConfigClient(fake.fetch),
    buffer: new WriteBuffer(() => localStorage),
    now,
  });
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const migrationFor = (store: ConfigStore, seen: WritePhase[] = []) =>
  new Migration(
    store,
    () => (phase) => seen.push(phase),
    () => [],
  );

describe('W-01 confirmation is bound to the preview', () => {
  const seed = () => {
    const a = new SqlLibrary(PREFIX + 'a'.repeat(64));
    a.bookmark('One', 'SELECT 1');
    a.bookmark('Two', 'SELECT 2');
    a.setEnabled(true);
    a.record('SELECT 10');
  };
  it('toggling the history option or changing the preview revokes the confirmation; no history leaves without it', async () => {
    seed();
    const store = make();
    await store.ensureReady();
    const migration = migrationFor(store);
    await migration.refreshPreview();
    migration.confirmed = true;
    expect(migration.canRun).toBe(true);
    migration.includeHistory = true;
    expect(migration.confirmed).toBe(false);
    await migration.run();
    expect(fake.writes()).toHaveLength(0);
    expect(store.historyEnabled).toBe(false);
    // Local data changes between two previews: the old confirmation does not carry over.
    migration.includeHistory = false;
    await migration.refreshPreview();
    migration.confirmed = true;
    new SqlLibrary(PREFIX + 'b'.repeat(64)).bookmark('Three', 'SELECT 3');
    await migration.refreshPreview();
    expect(migration.preview?.bookmarks).toBe(3);
    expect(migration.confirmed).toBe(false);
    await migration.run();
    expect(fake.writes()).toHaveLength(0);
  });
  it('what is sent is exactly the confirmed preview (items, refs) and the opt-in only with history', async () => {
    seed();
    const store = make();
    await store.ensureReady();
    const migration = migrationFor(store);
    await migration.refreshPreview();
    const refs = migration.preview!.items.map((i) => i.client_ref);
    migration.confirmed = true;
    await migration.run();
    const sent = fake
      .writes()
      .flatMap((c) => (c.body as { items?: { client_ref: string }[] }).items ?? [])
      .map((i) => i.client_ref);
    expect(sent).toEqual(refs);
    expect(store.historyEnabled).toBe(false);
  });
});

describe('W-02 byte batches (900 KiB) measured on the real request bodies', () => {
  it('migration of 5 libraries x 20 bookmarks x 12 KB stays under the 1 MiB request limit in every request', async () => {
    for (let l = 0; l < 5; l++) {
      const lib = new SqlLibrary(PREFIX + String(l).repeat(64));
      for (let i = 0; i < 20; i++)
        lib.bookmark(`n${l}-${i}`, `SELECT '${'x'.repeat(12000)}${l}${i}'`);
    }
    // the local store keeps at most a bounded number of bytes; whatever is there is what is migrated
    const present = readLocalLibraries().reduce((n, l) => n + l.bookmarks.length, 0);
    const store = make();
    await store.ensureReady();
    const migration = migrationFor(store);
    await migration.refreshPreview();
    migration.confirmed = true;
    await migration.run();
    expect(migration.phase).toBe('done');
    const imports = fake.calls.filter((c) => c.path.endsWith('/import'));
    expect(imports.length).toBeGreaterThan(1);
    for (const call of imports) expect(bytes(call.body)).toBeLessThan(MAX_BATCH_BYTES + 1024);
    expect(migration.summary?.created).toBe(present);
  });
  it('the background flush after an outage also respects the byte cut and the count cut', async () => {
    const store = make();
    await store.ensureReady();
    await store.setHistoryEnabled(true);
    fake.down = true;
    for (let i = 0; i < 150; i++)
      expect(
        (await store.write('history', 's', { sql: `SELECT ${i}, '${'y'.repeat(2500)}'` })).ok,
      ).toBe(true);
    expect(store.buffer.entries.length).toBeGreaterThan(100);
    fake.down = false;
    fake.calls.length = 0;
    await store.ensureReady(true);
    const imports = fake.calls.filter((c) => c.path.endsWith('/import'));
    expect(imports.length).toBeGreaterThanOrEqual(2);
    for (const call of imports) {
      expect(bytes(call.body)).toBeLessThan(1024 * 1024);
      expect((call.body as { items: unknown[] }).items.length).toBeLessThanOrEqual(100);
    }
    expect(store.buffer.entries).toHaveLength(0);
  });
});

describe('W-03 capability re-check does not tear the open panel down', () => {
  it('a slow/failing re-check never leaves phase=ready and never flips the mode', async () => {
    const store = make();
    await store.ensureReady();
    const seen: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const original = fake.fetch;
    const client = new ConfigClient(async (input, init) => {
      if (String(input).includes('capabilities')) await gate;
      return original(input, init);
    });
    const guarded = new ConfigStore(fake.token, {
      client,
      buffer: new WriteBuffer(() => localStorage),
    });
    await (async () => {
      const first = guarded.ensureReady();
      release();
      await first;
    })();
    const poll = setInterval(() => seen.push(`${guarded.phase}/${guarded.mode}`), 0);
    const gate2 = new Promise<void>((r) => setTimeout(r, 40));
    const slow = new ConfigClient(async (input, init) => {
      if (String(input).includes('capabilities')) await gate2;
      return original(input, init);
    });
    (guarded as unknown as { client: ConfigClient }).client = slow;
    await guarded.ensureReady(true);
    clearInterval(poll);
    expect(new Set(seen)).toEqual(new Set(['ready/server']));
  });
  it('degraded re-check is throttled to 5 s and an outage re-check does not become local mode', async () => {
    let clock = 1_000_000;
    const store = make(fake.token, () => clock);
    await store.ensureReady();
    fake.failNetwork = true;
    await store.ensureReady(true);
    expect(store.degraded).toBe(true);
    expect(store.mode).toBe('server');
    const before = fake.calls.length;
    clock += 1000;
    await store.ensureReady();
    expect(fake.calls.length).toBe(before); // throttled
    clock += 6000;
    fake.failNetwork = false;
    await store.ensureReady();
    expect(store.degraded).toBe(false);
  });
});

describe('W-04 owner binding of the outage buffer', () => {
  it('the token never reaches storage; foreign entries are invisible, not uploaded, not removed by other owners', async () => {
    const a = make('token-A-'.padEnd(40, 'a'));
    fake.token = 'token-A-'.padEnd(40, 'a');
    await a.ensureReady();
    await a.setHistoryEnabled(true);
    fake.down = true;
    await a.write('history', 's', { sql: 'SELECT 1' });
    await a.write('bookmarks', 's', { name: 'mine', sql: 'SELECT 2' });
    expect(a.buffer.entries).toHaveLength(2);
    const raw = localStorage.getItem(BUFFER_KEY) ?? '';
    for (const name of Object.keys(localStorage)) {
      expect(localStorage.getItem(name) ?? '').not.toContain('token-A-');
      expect(name).not.toContain('token-A-');
    }
    expect(raw).toContain(await ownerOf('token-A-'.padEnd(40, 'a')));
    // another token in the same browser
    fake.down = false;
    fake.token = 'token-B-'.padEnd(40, 'b');
    const b = make('token-B-'.padEnd(40, 'b'));
    await b.ensureReady();
    expect(b.buffer.entries).toHaveLength(0);
    fake.calls.length = 0;
    await b.flush();
    expect(fake.calls.filter((c) => c.path.endsWith('/import'))).toHaveLength(0);
    b.buffer.clear();
    b.buffer.removeKinds(['history', 'bookmarks']);
    b.buffer.remove(
      new Set((JSON.parse(raw).entries as { client_ref: string }[]).map((e) => e.client_ref)),
    );
    expect(JSON.parse(localStorage.getItem(BUFFER_KEY) ?? '{"entries":[]}').entries).toHaveLength(
      2,
    );
  });
  it('a tampered owner or foreign entry cannot be adopted by changing the field to the own hash only through valid format', async () => {
    const store = make();
    await store.ensureReady();
    const owner = await ownerOf(fake.token);
    expect(owner).toMatch(/^[0-9a-f]{32}$/);
    // 128-bit truncated, unsalted, single SHA-256 with a fixed prefix: computing it for a guess is one hash.
    expect(owner).toBe(await ownerOf(fake.token));
  });
});

describe('W-06 every store write reports sending and settled/unknown', () => {
  it('covers opt-in, create, update, delete, import, clear, recents, favorites, documents and the flush', async () => {
    const store = make();
    const phases: WritePhase[] = [];
    store.observe((p) => phases.push(p));
    await store.ensureReady();
    const balanced = () => {
      const sending = phases.filter((p) => p === 'sending').length;
      const closing = phases.filter((p) => p !== 'sending').length;
      return sending === closing;
    };
    const step = async (name: string, call: () => Promise<unknown>) => {
      const before = phases.length;
      await call();
      const mine = phases.slice(before);
      expect(mine[0], name).toBe('sending');
      expect(['settled', 'unknown'], name).toContain(mine.at(-1));
      expect(balanced(), name).toBe(true);
    };
    await step('opt-in', () => store.setHistoryEnabled(true));
    let id = '';
    await step('bookmark', async () => {
      const r = await store.write('bookmarks', 's', { name: 'x', sql: 'SELECT 1' });
      id = (r.ok && r.value.item?.id) || '';
    });
    const item = (await store.getItem('bookmarks', id)) as { ok: true; value: never };
    await step('update', () => store.updateItem(item.value, { name: 'y', sql: 'SELECT 2' }));
    await step('favorite', () => store.addFavorite('s', 't'));
    await step('recent', () => store.touchRecent('s', 't'));
    await step('document', () =>
      store.saveDocument('settings', 'appearance', { theme: 'dark', locale: 'de' }, null),
    );
    await step('import', () =>
      store.importBatch([
        {
          kind: 'history',
          scope: 's',
          client_ref: 'r1',
          time: new Date().toISOString(),
          data: { sql: 'SELECT 3' },
        },
      ]),
    );
    const plan = await store.clearPlan(['favorites']);
    expect(plan.ok).toBe(true);
    if (plan.ok)
      await step('clear', async () => {
        const result = await store.clearExecute({
          kinds: ['favorites'],
          plan_hash: plan.value.plan_hash,
          confirmation: plan.value.confirmation,
        });
        expect(result.ok).toBe(true);
      });
    await step('delete', async () => {
      const current = await store.getItem('bookmarks', id);
      expect(current.ok).toBe(true);
      if (current.ok) expect((await store.deleteItem(current.value)).ok).toBe(true);
    });
    // lost answer: unknown
    fake.loseNextWriteAnswer = true;
    const before = phases.length;
    await store.write('bookmarks', 's', { name: 'lost', sql: 'SELECT 9' });
    expect(phases.slice(before)).toContain('unknown');
    // background flush from refresh reports too
    fake.down = true;
    await store.write('history', 's', { sql: 'SELECT 77' });
    fake.down = false;
    const before2 = phases.length;
    await store.ensureReady(true);
    expect(phases.slice(before2)[0]).toBe('sending');
    expect(balanced()).toBe(true);
  });
  it('FINDING: no observer exists for writes made while neither panel is mounted (recents, history at query start)', async () => {
    // The store itself notifies (see above); Session.writeCount only hears panels that called store.observe.
    const store = make();
    await store.ensureReady();
    const phases: WritePhase[] = [];
    const stop = store.observe((p) => phases.push(p));
    stop(); // panel unmounted
    await store.touchRecent('s', 'table');
    expect(phases).toEqual([]);
  });
});

describe('W-09 and the appearance race', () => {
  it('a change made while a save is in flight is sent afterwards', async () => {
    const store = make();
    await store.ensureReady();
    const sync = new AppearanceSync(store, () => {}, 0);
    await sync.load();
    sync.push('dark', 'de');
    await vi.waitFor(() => expect(fake.writes().length).toBe(1));
    sync.push('light', 'en');
    await vi.waitFor(() => expect(fake.writes().length).toBe(2));
    expect((fake.writes()[1].body as { data: unknown }).data).toEqual({
      theme: 'light',
      locale: 'en',
    });
  });
  // Root cause candidate of the config-store.spec.ts:244 flake: push() before load() has finished is dropped, and nothing
  // re-sends it (the panel effect depends on preferences only).
  it('DEFECT: a change made before the initial load() finished is lost on the server', async () => {
    const store = make();
    await store.ensureReady();
    const sync = new AppearanceSync(store, () => {}, 0);
    const loading = sync.load(); // GET still in flight
    sync.push('dark', 'de'); // user picks the theme right after switching to server mode
    await loading;
    await new Promise((r) => setTimeout(r, 200));
    expect(fake.writes().length).toBeGreaterThan(0); // wanted; fails today
  });
});

describe('Legacy data', () => {
  it('local entries with credentials are skipped and counted by the migration, never sent, but still readable locally', async () => {
    const lib = new SqlLibrary(PREFIX + 'e'.repeat(64));
    lib.bookmark('ok', 'SELECT 1');
    localStorage.setItem(
      PREFIX + 'f'.repeat(64),
      JSON.stringify({
        version: 1,
        enabled: true,
        history: [
          {
            id: 'h1',
            sql: "SELECT 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1'",
            name: '',
            time: '2026-10-01T10:00:00.000Z',
          },
        ],
        bookmarks: [
          {
            id: 'b1',
            name: 'pw',
            sql: 'SELECT 2 -- curl -u admin:hunter22 x',
            time: '2026-10-01T10:00:00.000Z',
          },
        ],
      }),
    );
    const store = make();
    await store.ensureReady();
    const migration = migrationFor(store);
    migration.includeHistory = true;
    await migration.refreshPreview();
    expect(migration.preview?.skipped).toBe(2);
    migration.confirmed = true;
    await migration.run();
    const sent = JSON.stringify(fake.writes().map((c) => c.body));
    expect(sent).not.toContain('eyJhbGci');
    expect(sent).not.toContain('hunter22');
    expect(readLocalLibraries().flatMap((l) => [...l.history, ...l.bookmarks])).toHaveLength(3);
  });
});
