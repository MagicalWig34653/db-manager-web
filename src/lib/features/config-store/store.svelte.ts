// SPDX-License-Identifier: AGPL-3.0-only
// State of the server-side configuration store for one backend token: capability mode, history opt-in, documents,
// favorites, recents and the outage buffer. The server enforces every rule (opt-in, quotas, secrets, versions); the
// client only decides which backend to use and never reports "saved" before a 2xx answer.
import {
  ConfigClient,
  ConfigError,
  configClient,
  isOutage,
  type Capabilities,
  type Item,
  type Kind,
  type Schemas,
} from './client';
import { WriteBuffer, type BufferedWrite } from './buffer.svelte';
import { chunk, newRef } from './model';

export type Mode = 'server' | 'local';
export type Result<T = Item> =
  { ok: true; value: T; buffered?: boolean } | { ok: false; code: string };
export interface StoreDeps {
  client?: ConfigClient;
  buffer?: WriteBuffer;
  now?: () => number;
}
const RECHECK_MS = 30000;

const ownBool = (value: unknown): value is boolean => typeof value === 'boolean';

export class ConfigStore {
  phase = $state<'unknown' | 'loading' | 'ready'>('unknown');
  mode = $state<Mode>('local');
  /** ok | not_configured | unreachable | unsupported | error: why the local mode is active. */
  reason = $state('');
  /** Server mode, but the state store stopped answering: writes are buffered, reads may be stale. */
  degraded = $state(false);
  caps = $state<Capabilities | null>(null);
  historyEnabled = $state(false);
  usage = $state<Schemas['ConfigStatus'] | null>(null);
  /** Increments after every history or bookmark change made through this store; lists reload on it. */
  revision = $state(0);
  /** Buffered entries the server rejected on replay (not kept; shown once). */
  droppedOnReplay = $state(0);
  readonly buffer: WriteBuffer;
  private client: ConfigClient;
  private now: () => number;
  private checking: Promise<void> | null = null;
  private flushing: Promise<void> | null = null;
  private privacy: Item | null = null;
  private checkedAt = 0;

  constructor(
    readonly token: string,
    deps: StoreDeps = {},
  ) {
    this.client = deps.client ?? configClient;
    this.buffer = deps.buffer ?? new WriteBuffer();
    this.now = deps.now ?? Date.now;
  }

  get active() {
    return this.mode === 'server';
  }

  /** Reads the capabilities once; in local mode and after an outage it re-checks at most every 30 s. */
  ensureReady(force = false): Promise<void> {
    if (this.checking) return this.checking;
    const fresh =
      this.phase === 'ready' &&
      !force &&
      !this.degraded &&
      (this.mode === 'server' || this.now() - this.checkedAt < RECHECK_MS);
    if (fresh) return Promise.resolve();
    this.checking = this.refresh().finally(() => (this.checking = null));
    return this.checking;
  }

  private async refresh() {
    this.phase = 'loading';
    try {
      if (!this.token) throw new ConfigError('unauthorized');
      const caps = await this.client.capabilities(this.token);
      this.caps = caps;
      if (caps.available && caps.mode === 'server') {
        this.mode = 'server';
        this.reason = 'ok';
        this.degraded = false;
        await this.loadPrivacy();
        if (!this.degraded) await this.flush();
      } else {
        this.mode = 'local';
        this.reason = caps.reason === 'ok' ? 'error' : caps.reason;
        this.degraded = false;
      }
    } catch (cause) {
      this.mode = 'local';
      this.reason =
        cause instanceof ConfigError && cause.code === 'not_found' ? 'unsupported' : 'error';
      this.degraded = false;
    } finally {
      this.checkedAt = this.now();
      this.phase = 'ready';
    }
  }

  private async loadPrivacy() {
    try {
      const page = await this.client.list(this.token, 'settings', {
        scope: '',
        key: 'privacy',
        limit: 1,
      });
      const item = page.items[0] ?? null;
      this.privacy = item;
      this.historyEnabled =
        !!item && ownBool(item.data.history_enabled) && item.data.history_enabled;
    } catch (cause) {
      if (isOutage(cause)) this.degraded = true;
      else throw cause;
    }
  }

  /** Runs a call; outages mark the store degraded, a refused history write corrects the opt-in state. */
  private async guard<T>(call: () => Promise<T>): Promise<Result<T>> {
    try {
      return { ok: true, value: await call() };
    } catch (cause) {
      if (cause instanceof ConfigError) {
        if (isOutage(cause)) this.degraded = true;
        if (cause.code === 'history_disabled') this.historyEnabled = false;
        return { ok: false, code: cause.code };
      }
      if (cause instanceof DOMException && cause.name === 'AbortError')
        return { ok: false, code: 'aborted' };
      return { ok: false, code: 'error' };
    }
  }

  // ----- privacy (history opt-in) -----

  /** Opt-in or opt-out of server-side history; existing entries stay until deleted through a clear plan. */
  async setHistoryEnabled(value: boolean): Promise<Result<boolean>> {
    const result = await this.guard(async () => {
      if (this.privacy) {
        this.privacy = await this.client.update(
          this.token,
          'settings',
          this.privacy.id,
          this.privacy.version,
          { history_enabled: value },
        );
      } else {
        const { item } = await this.client.create(this.token, 'settings', {
          scope: '',
          key: 'privacy',
          data: { history_enabled: value },
        });
        this.privacy = item;
      }
      this.historyEnabled = value;
      return value;
    });
    if (!result.ok && ['version_conflict', 'already_exists', 'not_found'].includes(result.code)) {
      // Changed elsewhere: show the current server state instead of overwriting it blindly.
      await this.guard(() => this.loadPrivacy());
    }
    return result;
  }

  // ----- generic items -----

  listPage(kind: Kind, query: { scope?: string; key?: string; limit?: number; cursor?: string }) {
    return this.guard(() => this.client.list(this.token, kind, query));
  }
  async createItem(
    kind: Kind,
    body: Schemas['ConfigCreateRequest'],
  ): Promise<Result<{ item: Item; created: boolean }>> {
    const result = await this.guard(() => this.client.create(this.token, kind, body));
    if (result.ok && (kind === 'history' || kind === 'bookmarks')) this.revision++;
    return result;
  }
  getItem(kind: Kind, id: string) {
    return this.guard(() => this.client.get(this.token, kind, id));
  }
  async updateItem(item: Item, data: Record<string, unknown>) {
    const result = await this.guard(() =>
      this.client.update(this.token, item.kind, item.id, item.version, data),
    );
    if (result.ok && item.kind === 'bookmarks') this.revision++;
    return result;
  }
  async deleteItem(item: Item): Promise<Result<true>> {
    const result = await this.guard(async () => {
      try {
        await this.client.remove(this.token, item.kind, item.id, item.version);
      } catch (cause) {
        // Already gone is the wanted end state.
        if (!(cause instanceof ConfigError && cause.code === 'not_found')) throw cause;
      }
      return true as const;
    });
    if (result.ok && (item.kind === 'history' || item.kind === 'bookmarks')) this.revision++;
    return result;
  }
  async refreshUsage() {
    const result = await this.guard(() => this.client.status(this.token));
    if (result.ok) this.usage = result.value;
    return result;
  }

  // ----- history and bookmarks with outage buffer -----

  /** Creates a history entry or bookmark; during an outage it is buffered in this browser (idempotent replay). */
  async write(
    kind: 'history' | 'bookmarks',
    scope: string,
    data: Record<string, unknown>,
  ): Promise<Result<{ item?: Item }>> {
    const clientRef = newRef();
    const time = new Date().toISOString();
    const result = await this.createItem(kind, { scope, client_ref: clientRef, data });
    if (result.ok) return { ok: true, value: { item: result.value.item } };
    if (isOutage(new ConfigError(result.code))) {
      const kept = this.buffer.add({ kind, scope, client_ref: clientRef, time, data });
      if (!kept) return { ok: false, code: 'buffer_full' };
      this.revision++;
      return { ok: true, value: {}, buffered: true };
    }
    return result;
  }

  /** Replays the buffer through the idempotent import; entries leave the buffer only after the server answered. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (!this.buffer.entries.length) return Promise.resolve();
    this.flushing = this.runFlush().finally(() => (this.flushing = null));
    return this.flushing;
  }
  private async runFlush() {
    const size = this.caps?.max_import_items ?? 100;
    for (const batch of chunk<BufferedWrite>([...this.buffer.entries], size)) {
      const result = await this.guard(() =>
        this.client.importItems(this.token, {
          items: batch.map((e) => ({
            kind: e.kind,
            scope: e.scope,
            client_ref: e.client_ref,
            time: e.time,
            data: e.data,
          })),
        }),
      );
      if (!result.ok) return; // still unavailable (or refused as a whole): keep everything
      this.degraded = false;
      this.droppedOnReplay += result.value.rejected;
      this.buffer.remove(new Set(batch.map((e) => e.client_ref)));
      this.revision++;
    }
  }

  /** One import batch (idempotent through client_ref); the caller maps results to its own entries by index. */
  importBatch(items: Schemas['ConfigImportItem'][]) {
    return this.guard(() => this.client.importItems(this.token, { items }));
  }
  exportAll() {
    return this.guard(() => this.client.exportText(this.token));
  }
  clearPlan(kinds: Kind[], scope?: string) {
    return this.guard(() =>
      this.client.clearPlan(this.token, { kinds, ...(scope === undefined ? {} : { scope }) }),
    );
  }
  async clearExecute(body: Schemas['ConfigClearExecuteRequest']) {
    const result = await this.guard(() => this.client.clearExecute(this.token, body));
    if (result.ok) {
      this.revision++;
      if (body.kinds.includes('settings') && (!body.scope || body.scope === ''))
        this.privacy = null;
      if (body.kinds.includes('settings')) await this.guard(() => this.loadPrivacy());
    }
    return result;
  }

  // ----- documents (settings, layouts) with optimistic concurrency -----

  async getDocument(
    kind: 'settings' | 'layouts',
    key: string,
    scope = '',
  ): Promise<Result<Item | null>> {
    const page = await this.listPage(kind, { scope, key, limit: 1 });
    return page.ok ? { ok: true, value: page.value.items[0] ?? null } : page;
  }
  /**
   * Saves a document against the version the caller last saw. A stale version never overwrites: the current server
   * item comes back as `conflict` so the caller can show a merge choice (take the server's or save mine on top).
   */
  async saveDocument(
    kind: 'settings' | 'layouts',
    key: string,
    data: Record<string, unknown>,
    known: Item | null,
    scope = '',
  ): Promise<Result<Item> | { ok: false; code: 'version_conflict'; conflict: Item | null }> {
    const attempt = known
      ? await this.updateItem(known, data)
      : await this.createItem(kind, { scope, key, data }).then((r) =>
          r.ok ? ({ ok: true, value: r.value.item } as Result<Item>) : r,
        );
    if (attempt.ok) return attempt;
    if (attempt.code === 'version_conflict' || attempt.code === 'already_exists') {
      const current = await this.getDocument(kind, key, scope);
      return {
        ok: false,
        code: 'version_conflict',
        conflict: current.ok ? current.value : null,
      };
    }
    return attempt;
  }

  // ----- favorites and recents -----

  addFavorite(scope: string, table: string, database?: string) {
    return this.createItem('favorites', {
      scope,
      data: { table, ...(database ? { database } : {}) },
    });
  }
  /** The server pulls an existing entry to the top (version +1) instead of creating a duplicate. */
  touchRecent(scope: string, table: string, database?: string) {
    return this.createItem('recents', {
      scope,
      data: { table, ...(database ? { database } : {}) },
    });
  }
  saveSearch(scope: string, name: string, definition: Record<string, unknown>) {
    return this.createItem('searches', { scope, data: { name, definition } });
  }
}

let current: ConfigStore | null = null;
/** One store per backend token; a token change drops all state (nothing of the old session is kept in memory). */
export function configStoreFor(token: string): ConfigStore {
  if (!current || current.token !== token) current = new ConfigStore(token);
  return current;
}
export function resetConfigStore(store: ConfigStore | null = null) {
  current = store;
}
