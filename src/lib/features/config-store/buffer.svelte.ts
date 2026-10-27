// SPDX-License-Identifier: AGPL-3.0-only
// Write buffer for the outage of the server state (503 state_unavailable): new history entries and bookmarks are kept
// in this browser and replayed through the idempotent import (client_ref) once the server answers again. Entries were
// checked for credentials before they were buffered; the buffer is bounded and never holds anything else.
export const BUFFER_KEY = 'db-manager.config-buffer.v1';
export const MAX_BUFFERED = 200;
const MAX_BUFFER_BYTES = 512 * 1024;
export interface BufferedWrite {
  kind: 'history' | 'bookmarks';
  scope: string;
  client_ref: string;
  time: string;
  data: Record<string, unknown>;
}
const valid = (value: unknown): value is BufferedWrite => {
  const e = value as BufferedWrite;
  return (
    !!e &&
    (e.kind === 'history' || e.kind === 'bookmarks') &&
    typeof e.scope === 'string' &&
    /^[A-Za-z0-9._:~-]{0,128}$/.test(e.scope) &&
    typeof e.client_ref === 'string' &&
    /^[A-Za-z0-9._:~-]{1,64}$/.test(e.client_ref) &&
    typeof e.time === 'string' &&
    typeof e.data === 'object' &&
    e.data !== null &&
    typeof (e.data as { sql?: unknown }).sql === 'string'
  );
};

export class WriteBuffer {
  entries = $state<BufferedWrite[]>([]);
  storageFailed = $state(false);
  constructor(private storage: () => Storage = () => localStorage) {
    try {
      const data = JSON.parse(this.storage().getItem(BUFFER_KEY) ?? 'null');
      if (data?.version === 1 && Array.isArray(data.entries))
        this.entries = data.entries.filter(valid).slice(0, MAX_BUFFERED);
    } catch {
      this.storageFailed = true;
    }
  }
  private save() {
    try {
      if (!this.entries.length) this.storage().removeItem(BUFFER_KEY);
      else
        this.storage().setItem(BUFFER_KEY, JSON.stringify({ version: 1, entries: this.entries }));
      this.storageFailed = false;
    } catch {
      this.storageFailed = true;
    }
  }
  /** False when the buffer is full: the caller must tell the user the write was not kept. */
  add(entry: BufferedWrite): boolean {
    if (this.entries.some((e) => e.client_ref === entry.client_ref && e.scope === entry.scope))
      return true;
    const next = [...this.entries, entry];
    if (
      next.length > MAX_BUFFERED ||
      new TextEncoder().encode(JSON.stringify(next)).length > MAX_BUFFER_BYTES
    )
      return false;
    this.entries = next;
    this.save();
    return true;
  }
  remove(refs: Set<string>) {
    this.entries = this.entries.filter((e) => !refs.has(e.client_ref));
    this.save();
  }
  clear() {
    this.entries = [];
    this.save();
  }
}
