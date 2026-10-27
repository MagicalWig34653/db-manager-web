// SPDX-License-Identifier: AGPL-3.0-only
// Write buffer for the outage of the server state (503 state_unavailable): new history entries and bookmarks are kept
// in this browser and replayed through the idempotent import (client_ref) once the server answers again. Entries are
// bound to the owner (a one-way hash of the backend token, never the token): an entry is only shown and uploaded under
// the identity that wrote it. Entries with credential-like text are never stored; the buffer is bounded.
import { anySecret } from './secrets';

export const BUFFER_KEY = 'db-manager.config-buffer.v1';
export const MAX_BUFFERED = 200;
const MAX_BUFFER_BYTES = 512 * 1024;
export interface BufferedWrite {
  kind: 'history' | 'bookmarks';
  scope: string;
  client_ref: string;
  time: string;
  data: Record<string, unknown>;
  /** One-way identity of the token that wrote the entry. */
  owner: string;
}
const valid = (value: unknown): value is BufferedWrite => {
  const e = value as BufferedWrite;
  return (
    !!e &&
    (e.kind === 'history' || e.kind === 'bookmarks') &&
    typeof e.owner === 'string' &&
    /^[0-9a-f]{0,64}$/.test(e.owner) &&
    typeof e.scope === 'string' &&
    /^[A-Za-z0-9._:~-]{0,128}$/.test(e.scope) &&
    typeof e.client_ref === 'string' &&
    /^[A-Za-z0-9._:~-]{1,64}$/.test(e.client_ref) &&
    typeof e.time === 'string' &&
    Number.isFinite(Date.parse(e.time)) &&
    typeof e.data === 'object' &&
    e.data !== null &&
    typeof (e.data as { sql?: unknown }).sql === 'string' &&
    !anySecret(e.data)
  );
};

/** One-way owner id of a backend token (the token itself is never stored). */
export async function ownerOf(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`dbm-config-buffer\0${token}`),
  );
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

export class WriteBuffer {
  private all = $state<BufferedWrite[]>([]);
  storageFailed = $state(false);
  private owner = '';
  constructor(private storage: () => Storage = () => localStorage) {
    try {
      const data = JSON.parse(this.storage().getItem(BUFFER_KEY) ?? 'null');
      if (data?.version === 1 && Array.isArray(data.entries))
        this.all = data.entries.filter(valid).slice(0, MAX_BUFFERED);
    } catch {
      this.storageFailed = true;
    }
  }
  /** Entries of the current owner only; other identities' entries stay untouched and invisible. */
  get entries(): BufferedWrite[] {
    return this.all.filter((e) => e.owner === this.owner);
  }
  bind(owner: string) {
    this.owner = owner;
  }
  private save() {
    try {
      if (!this.all.length) this.storage().removeItem(BUFFER_KEY);
      else this.storage().setItem(BUFFER_KEY, JSON.stringify({ version: 1, entries: this.all }));
      this.storageFailed = false;
    } catch {
      this.storageFailed = true;
    }
  }
  /** False when nothing was kept (full, or the text looks like a credential): the caller must say so. */
  add(entry: Omit<BufferedWrite, 'owner'>): boolean {
    const full: BufferedWrite = { ...entry, owner: this.owner };
    if (!valid(full)) return false;
    if (
      this.all.some(
        (e) =>
          e.owner === this.owner && e.client_ref === entry.client_ref && e.scope === entry.scope,
      )
    )
      return true;
    const next = [...this.all, full];
    if (
      next.length > MAX_BUFFERED ||
      new TextEncoder().encode(JSON.stringify(next)).length > MAX_BUFFER_BYTES
    )
      return false;
    this.all = next;
    this.save();
    return true;
  }
  remove(refs: Set<string>) {
    this.all = this.all.filter((e) => !(e.owner === this.owner && refs.has(e.client_ref)));
    this.save();
  }
  /** Drops the owner's buffered entries of the given kinds (and scope), e.g. after "delete all". */
  removeKinds(kinds: readonly string[], scope?: string) {
    this.all = this.all.filter(
      (e) => !(e.owner === this.owner && kinds.includes(e.kind) && (!scope || e.scope === scope)),
    );
    this.save();
  }
  clear() {
    this.all = this.all.filter((e) => e.owner !== this.owner);
    this.save();
  }
}
