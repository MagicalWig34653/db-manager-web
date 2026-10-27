// SPDX-License-Identifier: AGPL-3.0-only
import type { ConnectionDraft } from '$lib/workbench';
import { recordServerHistory } from '$lib/features/config-store/record';
import { connectionIdentity, scopeFor } from '$lib/features/config-store/identity';

export const MAX_ENTRIES = 200;
export const MAX_BYTES = 512 * 1024;
export const MAX_SQL = 100000;
export const PREFIX = 'db-manager.sql-editor.v1.';
export interface Entry {
  id: string;
  sql: string;
  name: string;
  time: string;
}
interface Data {
  version: 1;
  enabled: boolean;
  history: Entry[];
  bookmarks: Entry[];
}
const size = (value: string) => new TextEncoder().encode(value).length;
let idSequence = 0;
const newId = () =>
  typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${++idSequence}`;

// Conservative secret patterns for the opt-in history: any hit means "do not store". False positives (for example
// a column named password_hash or a function body in dollar quotes) only cost a history entry; a miss would write
// a plaintext credential to localStorage. Comments are not stripped: a keyword inside a comment is a hit as well.
const SECRET_PATTERNS: RegExp[] = [
  /pass(?:word|wd|phrase)/i, // PASSWORD, PASSWD, MASTER_PASSWORD, SOURCE_PASSWORD, PASSWORD('x'), PASSWORD $$x$$
  /\bidentified\b/i, // IDENTIFIED BY / WITH / VIA ... USING
  /secret|token|credential|api[_-]?key|bearer|private\s+key/i,
  /\bencryption\s+key|\b(?:hex|re)?key\s*(?:=|['"]|\bx')|\bkey\s+['"]|pragma\s+(?:\w+\s*\.\s*)?(?:hex|re)?key\b|cipher_/i, // PRAGMA key, ATTACH ... KEY 'x'
  /\$[A-Za-z_\u0080-\uffff]*\$/, // dollar-quoted literals can hide any value
  /\b(?:user\s+mapping|create\s+server|create\s+subscription|dblink_connect\w*)\b/i, // connection strings with embedded credentials
  /\b(?:uid|user\s*id|pwd)\s*=/i,
];

/** Reject credential statements and active credentials; never serialize a connection. */
export function safeSql(sql: string, secrets: string[] = []): boolean {
  return (
    !!sql.trim() &&
    sql.length <= MAX_SQL &&
    size(JSON.stringify(sql)) <= MAX_BYTES / 2 - 2048 &&
    !secrets.some((secret) => secret.length > 0 && sql.includes(secret)) &&
    !SECRET_PATTERNS.some((pattern) => pattern.test(sql))
  );
}
function parseEntry(value: unknown): Entry {
  const e = value as Entry;
  if (
    !e ||
    typeof e.sql !== 'string' ||
    !safeSql(e.sql) ||
    typeof e.name !== 'string' ||
    e.name.length > 100 ||
    typeof e.time !== 'string' ||
    !Number.isFinite(Date.parse(e.time))
  )
    throw new Error('Invalid entry');
  return { id: newId(), sql: e.sql, name: e.name, time: e.time };
}
function parse(text: string): Data {
  if (size(text) > MAX_BYTES) throw new Error('Size limit');
  const data = JSON.parse(text);
  if (
    data?.version !== 1 ||
    typeof data.enabled !== 'boolean' ||
    !Array.isArray(data.history) ||
    !Array.isArray(data.bookmarks) ||
    data.history.length > MAX_ENTRIES ||
    data.bookmarks.length > MAX_ENTRIES ||
    size(JSON.stringify(data.history)) > MAX_BYTES / 2 - 1024 ||
    size(JSON.stringify(data.bookmarks)) > MAX_BYTES / 2 - 1024
  )
    throw new Error('Invalid data');
  return {
    version: 1,
    enabled: data.enabled,
    history: data.enabled ? data.history.map(parseEntry) : [],
    bookmarks: data.bookmarks.map(parseEntry),
  };
}

export class SqlLibrary {
  get storageKey() {
    return this.key;
  }
  enabled = $state(false);
  history = $state<Entry[]>([]);
  bookmarks = $state<Entry[]>([]);
  storageUnavailable = $state(false);
  constructor(
    private key: string,
    private storage: () => Storage = () => localStorage,
  ) {
    try {
      const text = this.storage().getItem(key);
      if (text) {
        const data = parse(text);
        this.enabled = data.enabled;
        this.history = data.history;
        this.bookmarks = data.bookmarks;
      }
    } catch {
      this.storageUnavailable = true;
    }
  }
  private save() {
    try {
      if (!this.enabled && !this.bookmarks.length) this.storage().removeItem(this.key);
      else
        this.storage().setItem(
          this.key,
          JSON.stringify({
            version: 1,
            enabled: this.enabled,
            history: this.history,
            bookmarks: this.bookmarks,
          }),
        );
      this.storageUnavailable = false;
    } catch {
      this.storageUnavailable = true;
    }
  }
  setEnabled(value: boolean) {
    this.enabled = value;
    if (!value) this.history = [];
    this.save();
  }
  private bounded(entries: Entry[]) {
    const result = entries.slice(0, MAX_ENTRIES);
    // Reserve half the payload for each collection and JSON metadata.
    while (size(JSON.stringify(result)) > MAX_BYTES / 2 - 1024) result.pop();
    return result;
  }
  record(sql: string, secrets: string[] = []) {
    if (!this.enabled || !safeSql(sql, secrets)) return false;
    this.history = this.bounded([
      { id: newId(), sql, name: '', time: new Date().toISOString() },
      ...this.history,
    ]);
    this.save();
    return true;
  }
  bookmark(name: string, sql: string, secrets: string[] = []) {
    if (
      !name.trim() ||
      name.length > 100 ||
      secrets.some((s) => s && name.includes(s)) ||
      !safeSql(sql, secrets)
    )
      return false;
    this.bookmarks = this.bounded([
      { id: newId(), name: name.trim(), sql, time: new Date().toISOString() },
      ...this.bookmarks,
    ]);
    this.save();
    return true;
  }
  remove(kind: 'history' | 'bookmarks', id?: string) {
    this[kind] = id ? this[kind].filter((e) => e.id !== id) : [];
    this.save();
  }
  /** Removes the entries the predicate selects (used after a confirmed server migration). */
  removeWhere(kind: 'history' | 'bookmarks', predicate: (entry: Entry) => boolean) {
    this[kind] = this[kind].filter((entry) => !predicate(entry));
    this.save();
  }
  exportBookmarks() {
    return JSON.stringify(
      { version: 1, bookmarks: this.bookmarks.map(({ name, sql, time }) => ({ name, sql, time })) },
      null,
      2,
    );
  }
  importBookmarks(text: string, secrets: string[] = []) {
    if (size(text) > MAX_BYTES) throw new Error('Size limit');
    const data = JSON.parse(text);
    if (
      data?.version !== 1 ||
      !Array.isArray(data.bookmarks) ||
      data.bookmarks.length > MAX_ENTRIES
    )
      throw new Error('Invalid bookmarks');
    const entries: Entry[] = data.bookmarks.map(parseEntry);
    if (
      entries.some(
        (e) =>
          !e.name.trim() ||
          !safeSql(e.sql, secrets) ||
          secrets.some((s) => s && e.name.includes(s)),
      )
    )
      throw new Error('Unsafe entry');
    const merged = [...entries, ...this.bookmarks];
    if (merged.length > MAX_ENTRIES || size(JSON.stringify(merged)) > MAX_BYTES / 2 - 1024)
      throw new Error('Size limit');
    this.bookmarks = merged;
    this.save();
  }
}

export interface LocalSnapshot {
  key: string;
  scope: string;
  enabled: boolean;
  history: Entry[];
  bookmarks: Entry[];
}
/** All W-P16 libraries in this browser (one per connection identity); unreadable keys are skipped. */
export function readLocalLibraries(storage: Storage = localStorage): LocalSnapshot[] {
  const result: LocalSnapshot[] = [];
  try {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(PREFIX) || key.length === PREFIX.length) continue;
      try {
        const data = parse(storage.getItem(key) ?? '');
        result.push({ key, scope: key.slice(PREFIX.length), ...data });
      } catch {
        /* an invalid library is neither migrated nor deleted */
      }
    }
  } catch {
    return [];
  }
  return result;
}

const libraries = new Map<string, Promise<SqlLibrary>>();
const byKey = new Map<string, SqlLibrary>();
export function libraryFor(connection: ConnectionDraft): Promise<SqlLibrary> {
  const identity = connectionIdentity(connection);
  let pending = libraries.get(identity);
  if (!pending) {
    pending = (async () => {
      try {
        const library = new SqlLibrary(PREFIX + (await scopeFor(connection)));
        byKey.set(library.storageKey, library);
        return library;
      } catch {
        // In insecure contexts use memory only; never fall back to plaintext identifiers.
        return new SqlLibrary('', () => {
          throw new Error('Storage unavailable');
        });
      }
    })();
    libraries.set(identity, pending);
  }
  return pending;
}

/** Deletes migrated entries from the (cached) library of a storage key so that a stale instance cannot write them back. */
export function removeLocalWhere(
  key: string,
  kind: 'history' | 'bookmarks',
  predicate: (entry: Entry) => boolean,
) {
  (byKey.get(key) ?? new SqlLibrary(key)).removeWhere(kind, predicate);
}

export function recordQuery(connection: ConnectionDraft, sql: string, token: string) {
  const secrets = [connection.password, token];
  // With a reachable server store the server decides (opt-in enforced there); otherwise the local W-P16 mode runs.
  void recordServerHistory(connection, sql, token)
    .then((handled) =>
      handled ? undefined : libraryFor(connection).then((library) => library.record(sql, secrets)),
    )
    .catch(() => {});
}
