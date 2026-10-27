// SPDX-License-Identifier: AGPL-3.0-only
// Server-backed counterpart of the W-P16 SqlLibrary for one connection scope: history and bookmarks read in cursor
// pages (newest first) and written with the server's version checks. Every method that sends a request is
// single-flight (`busy`), so a double click sends exactly one request.
import { safeSql } from '../sql-editor/storage.svelte';
import type { ConfigStore } from './store.svelte';
import type { Item } from './client';
import { errorText } from './model';
import { looksSecret } from './secrets';

export interface ViewEntry {
  id: string;
  name: string;
  sql: string;
  time: string;
  version: number;
  /** Kept in this browser only until the server answers again. */
  pending: boolean;
  item?: Item;
}
export type Conflict = { mine: { name: string; sql: string }; current: Item | null; target: Item };

const PAGE = 50;
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const view = (item: Item): ViewEntry => ({
  id: item.id,
  name: text(item.data.name),
  sql: text(item.data.sql),
  time: item.created_at,
  version: item.version,
  pending: false,
  item,
});

export class ServerLibrary {
  history = $state<ViewEntry[]>([]);
  bookmarks = $state<ViewEntry[]>([]);
  cursor = $state({ history: '', bookmarks: '' });
  loading = $state(false);
  busy = $state(false);
  /** Catalog text of the last failure; never contains server text or SQL. */
  error = $state('');
  conflict = $state<Conflict | null>(null);
  private generation = 0;

  constructor(
    private store: ConfigStore,
    readonly scope: string,
    private secrets: () => string[],
  ) {}

  get enabled() {
    return this.store.historyEnabled;
  }
  get pendingCount() {
    return this.store.buffer.entries.filter((e) => e.scope === this.scope).length;
  }
  private buffered(kind: 'history' | 'bookmarks'): ViewEntry[] {
    return this.store.buffer.entries
      .filter((e) => e.kind === kind && e.scope === this.scope)
      .map((e) => ({
        id: `pending-${e.client_ref}`,
        name: text(e.data.name),
        sql: text(e.data.sql),
        time: e.time,
        version: 0,
        pending: true,
      }))
      .reverse();
  }

  /** Loads the first page of both lists (replaces them). */
  async load() {
    const generation = ++this.generation;
    this.loading = true;
    this.error = '';
    const [history, bookmarks] = await Promise.all([
      this.store.listPage('history', { scope: this.scope, limit: PAGE }),
      this.store.listPage('bookmarks', { scope: this.scope, limit: PAGE }),
    ]);
    if (generation !== this.generation) return;
    this.loading = false;
    if (history.ok) {
      this.history = history.value.items.map(view);
      this.cursor.history = history.value.next_cursor;
    }
    if (bookmarks.ok) {
      this.bookmarks = bookmarks.value.items.map(view);
      this.cursor.bookmarks = bookmarks.value.next_cursor;
    }
    const failed = !history.ok ? history : !bookmarks.ok ? bookmarks : null;
    if (failed && !failed.ok) this.error = errorText(failed.code);
  }
  async more(kind: 'history' | 'bookmarks') {
    const cursor = this.cursor[kind];
    if (!cursor || this.loading) return;
    this.loading = true;
    const page = await this.store.listPage(kind, { scope: this.scope, limit: PAGE, cursor });
    this.loading = false;
    if (!page.ok) {
      this.error = errorText(page.code);
      return;
    }
    const known = new Set(this[kind].map((e) => e.id));
    this[kind] = [...this[kind], ...page.value.items.filter((i) => !known.has(i.id)).map(view)];
    this.cursor[kind] = page.value.next_cursor;
  }
  /** Entries to show: buffered (not yet synced) ones first. */
  shown(kind: 'history' | 'bookmarks') {
    return [...this.buffered(kind), ...this[kind]];
  }

  async bookmark(name: string, sql: string): Promise<string> {
    if (this.busy) return '';
    this.busy = true;
    try {
      this.error = '';
      const secrets = this.secrets();
      if (
        !name.trim() ||
        name.length > 100 ||
        secrets.some((s) => s && name.includes(s)) ||
        looksSecret(name) ||
        !safeSql(sql, secrets)
      )
        return (this.error = errorText('local_secret'));
      const result = await this.store.write('bookmarks', this.scope, {
        name: name.trim(),
        sql,
      });
      if (!result.ok) return (this.error = errorText(result.code));
      return result.buffered ? 'buffered' : 'saved';
    } finally {
      this.busy = false;
    }
  }

  async remove(kind: 'history' | 'bookmarks', entry: ViewEntry): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      this.error = '';
      if (entry.pending || !entry.item) {
        this.store.buffer.remove(new Set([entry.id.replace(/^pending-/, '')]));
        return true;
      }
      const result = await this.store.deleteItem(entry.item);
      if (result.ok) {
        this[kind] = this[kind].filter((e) => e.id !== entry.id);
        return true;
      }
      // A stale version means somebody changed the entry: show the current list.
      if (result.code === 'version_conflict') await this.load();
      this.error = errorText(result.code);
      return false;
    } finally {
      this.busy = false;
    }
  }

  /** Renames or edits a bookmark; a stale version opens the conflict choice instead of overwriting. */
  async edit(entry: ViewEntry, name: string, sql: string): Promise<boolean> {
    if (this.busy || !entry.item) return false;
    this.busy = true;
    try {
      this.error = '';
      const secrets = this.secrets();
      if (
        !name.trim() ||
        looksSecret(name) ||
        secrets.some((s) => s && name.includes(s)) ||
        !safeSql(sql, secrets)
      ) {
        this.error = errorText('local_secret');
        return false;
      }
      const result = await this.store.updateItem(entry.item, { name: name.trim(), sql });
      if (result.ok) {
        this.bookmarks = this.bookmarks.map((e) => (e.id === entry.id ? view(result.value) : e));
        return true;
      }
      if (result.code === 'version_conflict') {
        const current = await this.store.getItem('bookmarks', entry.id);
        this.conflict = {
          mine: { name: name.trim(), sql },
          current: current.ok ? current.value : null,
          target: entry.item,
        };
        return false;
      }
      this.error = errorText(result.code);
      return false;
    } finally {
      this.busy = false;
    }
  }
  /** Merge choice: take the server's current version (drop mine) or save mine on top of it. */
  async resolve(choice: 'server' | 'mine'): Promise<boolean> {
    const conflict = this.conflict;
    if (!conflict || this.busy) return false;
    if (choice === 'server' || !conflict.current) {
      this.conflict = null;
      await this.load();
      return choice === 'server';
    }
    this.busy = true;
    try {
      const result = await this.store.updateItem(conflict.current, {
        name: conflict.mine.name,
        sql: conflict.mine.sql,
      });
      if (!result.ok) {
        if (result.code === 'version_conflict') {
          // Changed again while the choice was open: show the newest server version and let the user decide again.
          const fresh = await this.store.getItem('bookmarks', conflict.current.id);
          this.conflict = { ...conflict, current: fresh.ok ? fresh.value : null };
        }
        this.error = errorText(result.code);
        return false;
      }
      this.conflict = null;
      await this.load();
      return true;
    } finally {
      this.busy = false;
    }
  }
}
