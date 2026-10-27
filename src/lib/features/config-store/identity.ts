// SPDX-License-Identifier: AGPL-3.0-only
import type { ConnectionDraft } from '$lib/workbench';

/** Password, token, display name and TLS secrets are deliberately absent from the identity. */
export function connectionIdentity(connection: ConnectionDraft): string {
  return JSON.stringify([
    location.origin,
    connection.driver,
    connection.database,
    connection.driver === 'sqlite' ? '' : connection.host,
    connection.driver === 'sqlite' ? 0 : connection.port,
    connection.driver === 'sqlite' ? '' : connection.username,
  ]);
}
/** SHA-256 hex of the identity: the opaque `scope` of the server store and the suffix of the W-P16 storage key. */
export async function scopeFor(connection: ConnectionDraft): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(connectionIdentity(connection)),
  );
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
