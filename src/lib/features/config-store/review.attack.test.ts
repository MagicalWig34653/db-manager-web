// SPDX-License-Identifier: AGPL-3.0-only
// Independent review attack tests for W-P20 web (docs/handoffs/W-P20-web-review.md). Tests named "HOLDS" pin a
// property that was verified; tests marked FIXED were `it.fails` markers of confirmed defects (W-01 to W-12) and are now ordinary tests.
import { readdirSync, readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as validators from '$lib/contract/v24/validators.js';
import type { WritePhase } from '$lib/rows';
import { emptyConnection } from '$lib/workbench';
import { PREFIX, SqlLibrary } from '../sql-editor/storage.svelte';
import { AppearanceSync } from './appearance.svelte';
import { BUFFER_KEY, WriteBuffer } from './buffer.svelte';
import { ClearFlow } from './clear.svelte';
import { ConfigClient, KINDS } from './client';
import { scopeFor } from './identity';
import { ServerLibrary } from './library.svelte';
import { Migration } from './migration.svelte';
import { recordServerHistory } from './record';
import SqlLibraryPanel from '../sql-editor/SqlLibraryPanel.svelte';
import ServerLibraryView from './ServerLibraryView.svelte';
import { ConfigStore, resetConfigStore } from './store.svelte';
import { FakeConfigServer } from './testing';

let fake: FakeConfigServer;
beforeEach(() => {
  localStorage.clear();
  fake = new FakeConfigServer();
});
afterEach(() => {
  cleanup();
  resetConfigStore(null);
  vi.restoreAllMocks();
});
const make = (token = fake.token, fetcher: typeof fetch = fake.fetch) =>
  new ConfigStore(token, {
    client: new ConfigClient(fetcher),
    buffer: new WriteBuffer(() => localStorage),
  });
const nonCaps = () => fake.calls.filter((c) => c.path !== '/api/v24/capabilities');

// ---------------------------------------------------------------------------------------------------------------
// (6) Differential: slim standalone validators (validator-roots.json) vs. the full schema compiled with Ajv.
// ---------------------------------------------------------------------------------------------------------------
describe('slim validators equal the full validators on fixtures and mutations', () => {
  const spec = JSON.parse(readFileSync('src/lib/contract/v24/api-v0.24.0.json', 'utf8'));
  const defs = JSON.parse(
    JSON.stringify(spec.components.schemas).replaceAll('#/components/schemas/', '#/$defs/'),
  );
  const ajv = new Ajv2020({ strict: false });
  ajv.addSchema({ $id: 'urn:review:v24', $defs: defs });
  const roots: string[] = JSON.parse(readFileSync('scripts/validator-roots.json', 'utf8'))['24'];
  const full = (name: string) => ajv.getSchema(`urn:review:v24#/$defs/${name}`)!;
  const slim = validators as unknown as Record<string, (v: unknown) => boolean>;

  it('roots cover every schema that an /api/v24 operation sends or receives', () => {
    const used = new Set<string>();
    const refs = (node: unknown) => {
      if (Array.isArray(node)) node.forEach(refs);
      else if (node && typeof node === 'object')
        for (const [k, v] of Object.entries(node)) {
          if (k === '$ref' && typeof v === 'string') used.add(v.split('/').pop()!);
          else refs(v);
        }
    };
    for (const [path, ops] of Object.entries(spec.paths))
      if (path.startsWith('/api/v24/'))
        for (const op of Object.values(ops as Record<string, any>)) {
          refs(op.requestBody);
          refs(op.responses);
        }
    const missing = [...used].filter((n) => n.startsWith('Config') && !roots.includes(n));
    // Directly referenced inner schemas are bundled through their parents; only list the ones never used as a root.
    const standalone = missing.filter((n) => typeof slim[n] !== 'function');
    expect(standalone.sort()).toEqual([]);
    expect(Object.keys(validators).sort()).toEqual([...roots].sort());
  });

  const dir = 'src/lib/features/config-store/fixtures';
  const fixtures: [string, unknown][] = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => [f, JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))]);

  function* mutants(value: unknown): Generator<unknown> {
    const clone = () => JSON.parse(JSON.stringify(value));
    yield clone();
    const walk = function* (node: unknown, path: (string | number)[]): Generator<unknown> {
      const apply = (replacement: unknown, remove = false) => {
        const root = clone();
        if (!path.length) return replacement;
        let cursor = root;
        for (const key of path.slice(0, -1)) cursor = cursor[key];
        const last = path[path.length - 1];
        if (remove) delete cursor[last];
        else cursor[last] = replacement;
        return root;
      };
      if (path.length) {
        yield apply(undefined, true);
        for (const bad of [null, 0, -1, 1.5, 2 ** 53, '', 'x'.repeat(300), true, [], {}, '\u0000'])
          yield apply(bad);
      }
      if (Array.isArray(node)) {
        yield apply([...node, ...node.slice(0, 1)]);
        yield apply([]);
        for (let i = 0; i < Math.min(node.length, 3); i++) yield* walk(node[i], [...path, i]);
      } else if (node && typeof node === 'object') {
        const extra = { ...(node as object), zz_unknown: 1 };
        yield apply(extra);
        for (const key of Object.keys(node)) yield* walk((node as any)[key], [...path, key]);
      }
    };
    yield* walk(value, []);
  }

  it('agrees on every fixture and on structural mutations of it', () => {
    let compared = 0;
    for (const [file, fixture] of fixtures) {
      const schema = file.split('.')[0];
      if (!roots.includes(schema)) continue;
      const reference = full(schema);
      for (const candidate of mutants(fixture)) {
        const a = slim[schema](candidate);
        const b = reference(candidate) as boolean;
        if (a !== b)
          throw new Error(
            `${file}: slim=${a} full=${b} for ${JSON.stringify(candidate).slice(0, 200)}`,
          );
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(2000);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// (1) Capabilities and local mode
// ---------------------------------------------------------------------------------------------------------------
describe('capabilities and mode (HOLDS)', () => {
  const caps = (overrides: Record<string, unknown>) => ({
    contract_version: '0.24.0',
    available: true,
    mode: 'server',
    reason: 'ok',
    owner_model: 'single',
    history_requires_opt_in: true,
    secrets_policy: 'reject',
    kinds: [],
    max_owner_bytes: 1,
    max_page: 100,
    default_page: 50,
    max_import_items: 100,
    max_request_bytes: 1048576,
    ...overrides,
  });
  const answer = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it.each([
    ['available but local_only', { available: true, mode: 'local_only', reason: 'ok' }],
    ['mode server but not available', { available: false, mode: 'server', reason: 'ok' }],
    ['not available, unreachable', { available: false, mode: 'local_only', reason: 'unreachable' }],
  ])('%s stays in local mode without any data request', async (_name, overrides) => {
    const calls: string[] = [];
    const store = make(fake.token, async (input) => {
      calls.push(String(input));
      return answer(caps(overrides));
    });
    await store.ensureReady();
    expect(store.mode).toBe('local');
    expect(await recordServerHistoryVia(store, 'SELECT 1')).toBe(false);
    expect(calls).toEqual(['/api/v24/capabilities']);
  });

  it('a capabilities answer that arrives late decides before any data request is sent', async () => {
    let release!: (value: Response) => void;
    const calls: string[] = [];
    const store = make(fake.token, (input) => {
      calls.push(String(input));
      if (String(input) === '/api/v24/capabilities')
        return new Promise<Response>((resolve) => (release = resolve));
      return fake.fetch(input);
    });
    resetConfigStore(store);
    const connection = emptyConnection();
    const pending = recordServerHistory(connection, 'SELECT 1', fake.token);
    await Promise.resolve();
    expect(calls).toEqual(['/api/v24/capabilities']); // nothing else while the answer is outstanding
    release(answer(caps({ available: false, mode: 'local_only', reason: 'not_configured' })));
    expect(await pending).toBe(false);
    expect(calls).toEqual(['/api/v24/capabilities']);
  });

  it('concurrent checks share one capabilities request', async () => {
    const store = make();
    await Promise.all([store.ensureReady(), store.ensureReady(), store.ensureReady()]);
    expect(fake.calls.filter((c) => c.path === '/api/v24/capabilities')).toHaveLength(1);
  });

  it('a malformed capabilities answer (extra/missing fields) falls back to local mode', async () => {
    const store = make(fake.token, async () => answer({ available: true, mode: 'server' }));
    await store.ensureReady();
    expect(store.mode).toBe('local');
    expect(store.reason).toBe('error');
  });

  it('runtime switch server -> local stops history writes at the record seam', async () => {
    const store = make();
    resetConfigStore(store);
    await store.ensureReady();
    expect(store.mode).toBe('server');
    fake.state = 'not_configured';
    await store.ensureReady(true);
    expect(store.mode).toBe('local');
    fake.calls.length = 0;
    expect(await recordServerHistory(emptyConnection(), 'SELECT 1', fake.token)).toBe(false);
    expect(nonCaps()).toEqual([]);
  });
});
const recordServerHistoryVia = async (store: ConfigStore, sql: string) => {
  resetConfigStore(store);
  return recordServerHistory(emptyConnection(), sql, store.token);
};

describe('store API does not enforce the mode itself (defect, Low)', () => {
  it('after a switch to local mode no data route is called through the store', async () => {
    const store = make();
    await store.ensureReady();
    fake.state = 'not_configured';
    await store.ensureReady(true);
    expect(store.mode).toBe('local');
    fake.calls.length = 0;
    await store.write('bookmarks', 's', { name: 'n', sql: 'SELECT 1' });
    await store.listPage('bookmarks', { scope: 's' });
    expect(nonCaps()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// (2) Data protection
// ---------------------------------------------------------------------------------------------------------------
describe('data protection', () => {
  it('HOLDS: the server error text and the SQL are never shown or stored', async () => {
    const sql = "SELECT 'hunter2-VERY-SECRET-literal'";
    const store = make(fake.token, async (input, init) =>
      String(input).includes('/capabilities') || (init?.method ?? 'GET') === 'GET'
        ? fake.fetch(input, init)
        : new Response(
            JSON.stringify({ error: { code: 'secret_rejected', message: `rejected: ${sql}` } }),
            { status: 422, headers: { 'Content-Type': 'application/json' } },
          ),
    );
    await store.ensureReady();
    const library = new ServerLibrary(store, 's', () => []);
    const message = await library.bookmark('n', 'SELECT 1');
    expect(message).toBe(library.error);
    expect(message).not.toContain('hunter2');
    expect(message).not.toContain('SELECT');
    expect(JSON.stringify(localStorage)).not.toContain('hunter2');
    expect(store.buffer.entries).toHaveLength(0); // a 422 is not an outage and is not buffered
  });

  it('HOLDS: history is not written without server opt-in and the client does not even try', async () => {
    const store = make();
    resetConfigStore(store);
    await store.ensureReady();
    fake.calls.length = 0;
    await recordServerHistory(emptyConnection(), 'SELECT 1', fake.token);
    expect(fake.writes()).toEqual([]);
  });

  it('HOLDS: appearance sends exactly theme and locale', async () => {
    const store = make();
    await store.ensureReady();
    const sync = new AppearanceSync(store, () => {}, 0);
    await sync.load();
    sync.push('dark', 'en');
    await vi.waitFor(() => expect(fake.writes().length).toBeGreaterThan(0));
    const body = fake.writes()[0].body as { data: Record<string, unknown>; key?: string };
    expect(Object.keys(body.data).sort()).toEqual(['locale', 'theme']);
  });

  it('HOLDS: a hostile server value for theme or locale is not applied', async () => {
    fake.seed('settings', { theme: '<img src=x onerror=1>', locale: 'xx' }, '', 'appearance');
    const store = make();
    await store.ensureReady();
    const applied = vi.fn();
    await new AppearanceSync(store, applied).load();
    expect(applied).not.toHaveBeenCalled();
  });

  it('FIXED (Medium, hardening): outage buffer persists SQL that the server would reject (JWT, URL with credentials) in plaintext localStorage', async () => {
    const store = make();
    resetConfigStore(store);
    await store.ensureReady();
    await store.setHistoryEnabled(true);
    fake.down = true;
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1rwW1gFWFOEjXk';
    await recordServerHistory(
      { ...emptyConnection(), password: 'pw' },
      `SELECT '${jwt}'`,
      fake.token,
    );
    await recordServerHistory(
      emptyConnection(),
      "SELECT 'postgres://admin:s3cr3t@db.internal/app'",
      fake.token,
    );
    const stored = localStorage.getItem(BUFFER_KEY) ?? '';
    expect(stored).not.toContain(jwt);
    expect(stored).not.toContain('s3cr3t');
  });

  it('FIXED (Medium for W-P30): the outage buffer is not bound to the token; another token flushes it to its own account', async () => {
    const first = make('token-a');
    void first;
    new WriteBuffer(() => localStorage).add({
      kind: 'bookmarks',
      scope: 's',
      client_ref: 'ref-1',
      time: '2026-10-27T10:00:00.000Z',
      data: { name: 'private', sql: 'SELECT 1' },
    });
    fake.token = 'token-b';
    const second = make('token-b');
    await second.ensureReady();
    expect(fake.count('bookmarks')).toBe(0);
  });

  it('FIXED (Low/Medium): "delete all" leaves buffered bookmarks in the browser; the next re-check replays them and revives deleted data', async () => {
    const store = make();
    resetConfigStore(store);
    await store.ensureReady();
    fake.seed('favorites', { table: 'orders' }, 's');
    fake.down = true;
    await store.write('bookmarks', 's', { name: 'pending', sql: 'SELECT 42' });
    expect(store.buffer.entries).toHaveLength(1);
    fake.down = false; // server is back, but nobody re-checked yet (store.degraded is still true)
    const flow = new ClearFlow(store, () => () => {});
    await flow.loadPlan([...KINDS]);
    flow.typed = flow.plan!.confirmation;
    await flow.execute();
    expect(flow.phase).toBe('done');
    await store.ensureReady(true); // the next SQL statement does this
    expect(fake.count('bookmarks')).toBe(0);
    expect(store.buffer.entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// (2)/(3)/(5) Migration
// ---------------------------------------------------------------------------------------------------------------
describe('migration', () => {
  const KEYS = Array.from({ length: 6 }, (_, i) => PREFIX + String(i).repeat(64));
  const phases = () => {
    const seen: WritePhase[] = [];
    return { seen, receive: () => (phase: WritePhase) => seen.push(phase) };
  };
  function seed(key: string, entries: number, bytes: number, history = false) {
    const library = new SqlLibrary(key);
    library.setEnabled(history);
    for (let i = 0; i < entries; i++) {
      library.bookmark(`b${i}`, `SELECT ${'x '.repeat(Math.floor(bytes / 2))}${i}`);
      if (history) library.record(`SELECT ${'y '.repeat(Math.floor(bytes / 2))}${i}`);
    }
  }

  it('HOLDS: stable client_ref and idempotent repeat; local data survives until the second button', async () => {
    seed(KEYS[0], 3, 40);
    const store = make();
    await store.ensureReady();
    const { receive } = phases();
    const migration = new Migration(store, receive, () => []);
    await migration.refreshPreview();
    migration.confirmed = true;
    await migration.run();
    expect(migration.summary).toMatchObject({ created: 3 });
    expect(new SqlLibrary(KEYS[0]).bookmarks).toHaveLength(3);
    const again = new Migration(store, receive, () => []);
    await again.refreshPreview();
    again.confirmed = true;
    await again.run();
    expect(again.summary).toMatchObject({ created: 0, exists: 3 });
    expect(fake.count('bookmarks')).toBe(3);
  });

  it('FIXED (Medium): confirmation given for a preview without history also covers history (and the server opt-in) after the checkbox is toggled', async () => {
    seed(KEYS[0], 2, 40, true);
    const store = make();
    await store.ensureReady();
    const migration = new Migration(store, phases().receive, () => []);
    await migration.refreshPreview();
    migration.confirmed = true; // user confirmed "2 bookmarks, 0 history"
    migration.includeHistory = true;
    await migration.refreshPreview(); // preview now includes history
    expect(migration.canRun).toBe(false); // wanted: a changed preview needs a new confirmation
  });

  it('FIXED (Medium): batches are cut by count (100) only; > 1 MiB of local entries make the migration fail permanently (request_too_large)', async () => {
    for (const key of KEYS.slice(0, 5)) seed(key, 20, 12000);
    const store = make();
    await store.ensureReady();
    const migration = new Migration(store, phases().receive, () => []);
    await migration.refreshPreview();
    expect(migration.preview!.items.length).toBeGreaterThanOrEqual(100);
    migration.confirmed = true;
    await migration.run();
    expect(migration.phase).toBe('done');
  });

  it('FIXED (Low): a lost answer during the import is reported as "settled" to the navigation lock, not as "unknown"', async () => {
    seed(KEYS[0], 2, 40);
    const store = make();
    await store.ensureReady();
    const { seen, receive } = phases();
    const migration = new Migration(store, receive, () => []);
    await migration.refreshPreview();
    migration.confirmed = true;
    fake.loseNextWriteAnswer = true;
    await migration.run();
    expect(migration.phase).toBe('failed');
    expect(seen).toContain('unknown');
  });

  it('HOLDS: double click starts exactly one import', async () => {
    seed(KEYS[0], 2, 40);
    const store = make();
    await store.ensureReady();
    const migration = new Migration(store, phases().receive, () => []);
    await migration.refreshPreview();
    migration.confirmed = true;
    await Promise.all([migration.run(), migration.run()]);
    expect(fake.calls.filter((c) => c.path === '/api/v24/config/import')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// (3) Concurrency, clear, paging
// ---------------------------------------------------------------------------------------------------------------
describe('concurrency and clear', () => {
  it('FIXED (Low): after a second 412 the conflict dialog keeps a stale "current" version, so "save mine" cannot succeed', async () => {
    const item = fake.seed('bookmarks', { name: 'a', sql: 'SELECT 1' }, 's');
    const store = make();
    await store.ensureReady();
    const library = new ServerLibrary(store, 's', () => []);
    await library.load();
    const entry = library.bookmarks[0];
    fake.items.get(item.id)!.version++; // somebody else changed it
    await library.edit(entry, 'mine', 'SELECT 1');
    expect(library.conflict).not.toBeNull();
    fake.items.get(item.id)!.version++; // and again before the choice is made
    await library.resolve('mine'); // fails with 412 (expected once)
    // Whatever the dialog does next, a second attempt must be able to win:
    const second = await library.resolve('mine');
    expect(second).toBe(true);
  });

  it('HOLDS: a stale delete never removes the entry and reloads', async () => {
    const item = fake.seed('bookmarks', { name: 'a', sql: 'SELECT 1' }, 's');
    const store = make();
    await store.ensureReady();
    const library = new ServerLibrary(store, 's', () => []);
    await library.load();
    fake.items.get(item.id)!.version++;
    expect(await library.remove('bookmarks', library.bookmarks[0])).toBe(false);
    expect(fake.count('bookmarks')).toBe(1);
  });

  it('HOLDS: plan_stale needs a new preview and the typed text must match exactly', async () => {
    fake.seed('bookmarks', { name: 'a', sql: 'SELECT 1' }, 's');
    const store = make();
    await store.ensureReady();
    const flow = new ClearFlow(store, () => () => {});
    await flow.loadPlan(['bookmarks']);
    flow.typed = flow.plan!.confirmation.toLowerCase();
    expect(flow.canExecute).toBe(false);
    flow.typed = flow.plan!.confirmation;
    fake.seed('bookmarks', { name: 'b', sql: 'SELECT 2' }, 's'); // changes the plan
    await flow.execute();
    expect(flow.phase).toBe('failed');
    expect(flow.plan).toBeNull();
    expect(fake.count('bookmarks')).toBe(2);
  });

  it('HOLDS: double click on execute sends one request', async () => {
    fake.seed('bookmarks', { name: 'a', sql: 'SELECT 1' }, 's');
    const store = make();
    await store.ensureReady();
    const flow = new ClearFlow(store, () => () => {});
    await flow.loadPlan(['bookmarks']);
    flow.typed = flow.plan!.confirmation;
    await Promise.all([flow.execute(), flow.execute()]);
    expect(fake.calls.filter((c) => c.path.endsWith('/clear/execute'))).toHaveLength(1);
  });

  it('FIXED (Low): the setting autosave drops a change made while the previous save is in flight', async () => {
    const store = make();
    await store.ensureReady();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow = new ConfigClient(async (input, init) => {
      if ((init?.method ?? 'GET') === 'POST') await gate;
      return fake.fetch(input, init);
    });
    const guarded = new ConfigStore(fake.token, { client: slow, buffer: store.buffer });
    await guarded.ensureReady();
    const sync = new AppearanceSync(guarded, () => {}, 0);
    await sync.load();
    sync.push('dark', 'de');
    await new Promise((r) => setTimeout(r, 10)); // first save now waits for the gate
    sync.push('light', 'de'); // second change while saving
    await new Promise((r) => setTimeout(r, 10));
    release();
    await new Promise((r) => setTimeout(r, 50));
    const doc = [...fake.items.values()].find((i) => i.key === 'appearance');
    expect(doc?.data.theme).toBe('light');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// (4) XSS and hostile text
// ---------------------------------------------------------------------------------------------------------------
describe('hostile text is rendered as text', () => {
  const connection = { ...emptyConnection(), database: 'xss-db' };
  const hostile = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>';
  it('HOLDS: bookmark names, SQL and conflict dialog contain no live elements', async () => {
    const scope = await scopeFor(connection);
    fake.seed('bookmarks', { name: hostile, sql: hostile }, scope);
    fake.seed('history', { sql: hostile }, scope);
    const store = make();
    await store.ensureReady();
    const { container } = render(ServerLibraryView, {
      props: { store, connection, token: fake.token, value: 'SELECT 1', onrestore: () => {} },
    });
    await waitFor(() => expect(container.textContent).toContain('onerror'));
    expect(container.querySelector('img, script, iframe, svg')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('FIXED (Low): a corrupted browser buffer entry with an invalid time reaches the date formatter unchanged (Intl RangeError in the view)', async () => {
    localStorage.setItem(
      BUFFER_KEY,
      JSON.stringify({
        version: 1,
        entries: [
          {
            kind: 'history',
            scope: 's',
            client_ref: 'r1',
            time: 'garbage',
            data: { sql: 'SELECT 1' },
          },
        ],
      }),
    );
    const store = make();
    const library = new ServerLibrary(store, 's', () => []);
    for (const entry of library.shown('history'))
      expect(Number.isFinite(Date.parse(entry.time))).toBe(true);
  });
});

describe('mode re-check while the library panel is open', () => {
  const connection = { ...emptyConnection(), database: 'recheck-db' };
  it('FIXED (Medium): a periodic capabilities re-check replaces the open panel by "checking" and destroys the draft (name, conflict dialog)', async () => {
    fake.state = 'not_configured';
    let release!: () => void;
    let hold = false;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const store = make(fake.token, async (input, init) => {
      if (hold && String(input) === '/api/v24/capabilities') await gate;
      return fake.fetch(input, init);
    });
    resetConfigStore(store);
    render(SqlLibraryPanel, {
      props: { connection, token: fake.token, value: 'SELECT 1', onrestore: () => {} },
    });
    const input = (await screen.findByLabelText('Name des Lesezeichens')) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'my draft' } });
    hold = true;
    const pending = store.ensureReady(true); // what the next executed statement triggers after 30 s
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByLabelText('Name des Lesezeichens')).not.toBeNull(); // wanted: the panel stays
    release();
    await pending;
  });
});
