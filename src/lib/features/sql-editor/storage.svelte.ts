// SPDX-License-Identifier: AGPL-3.0-only
import type { ConnectionDraft } from '$lib/workbench';

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

const libraries = new Map<string, Promise<SqlLibrary>>();
/** Password, token, display name and TLS secrets are deliberately absent from the identity. */
export function libraryFor(connection: ConnectionDraft): Promise<SqlLibrary> {
  const identity = JSON.stringify([
    location.origin,
    connection.driver,
    connection.database,
    connection.driver === 'sqlite' ? '' : connection.host,
    connection.driver === 'sqlite' ? 0 : connection.port,
    connection.driver === 'sqlite' ? '' : connection.username,
  ]);
  let pending = libraries.get(identity);
  if (!pending) {
    pending = (async () => {
      try {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
        const hash = Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, '0'),
        ).join('');
        return new SqlLibrary(PREFIX + hash);
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

export function recordQuery(connection: ConnectionDraft, sql: string, token: string) {
  const secrets = [connection.password, token];
  void libraryFor(connection)
    .then((library) => library.record(sql, secrets))
    .catch(() => {});
}
