// SPDX-License-Identifier: AGPL-3.0-only
import { t } from '$lib/i18n';
import { safeSql, type Entry, type LocalSnapshot } from '../sql-editor/storage.svelte';
import { ConfigError, type Kind } from './client';

const knownCodes = new Set([
  'invalid_request',
  'unsupported_media_type',
  'request_too_large',
  'item_too_large',
  'unknown_kind',
  'not_found',
  'already_exists',
  'quota_exceeded',
  'history_disabled',
  'plan_stale',
  'version_conflict',
  'precondition_required',
  'invalid_data',
  'secret_rejected',
  'confirmation_invalid',
  'state_unreadable',
  'state_unavailable',
  'unauthorized',
  'network_error',
  'timeout',
  'outcome_unknown',
  'invalid_response',
  'insecure_origin',
  'result_too_large',
  'local_secret',
]);
/** Catalog text for a stable error code. Server messages, SQL and input are never part of it. */
export function errorText(cause: unknown): string {
  const code = cause instanceof ConfigError ? cause.code : typeof cause === 'string' ? cause : '';
  return t(`configStore.err.${knownCodes.has(code) ? code : 'error'}`);
}

export const reasonText = (reason: string) =>
  t(
    `configStore.reason.${['not_configured', 'unreachable', 'unsupported', 'ok'].includes(reason) ? reason : 'error'}`,
  );

/** Stable idempotency key of a local W-P16 entry: its id changes on every load, its content does not. */
export async function clientRef(kind: Kind, scope: string, entry: Entry): Promise<string> {
  const text = JSON.stringify([kind, scope, entry.time, entry.name, entry.sql]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export const entrySignature = (entry: Entry) => JSON.stringify([entry.time, entry.name, entry.sql]);

export interface Prepared {
  kind: 'history' | 'bookmarks';
  scope: string;
  client_ref: string;
  time: string;
  data: Record<string, unknown>;
  /** Origin in the local storage, to delete exactly confirmed entries afterwards. */
  localKey: string;
  /** Content signature of the local entry (its id changes on every load). */
  signature: string;
}
export interface MigrationPreview {
  items: Prepared[];
  history: number;
  bookmarks: number;
  /** Entries that stay local because they look like they contain credentials or are too large. */
  skipped: number;
  /** Local history exists: transferring it needs the server-side opt-in. */
  hasHistory: boolean;
}

export async function prepareMigration(
  snapshots: LocalSnapshot[],
  options: { includeHistory: boolean; secrets: string[] },
): Promise<MigrationPreview> {
  const items: Prepared[] = [];
  let skipped = 0;
  let hasHistory = false;
  for (const snapshot of snapshots) {
    // Bookmarks first, then history oldest to newest: the server keeps the newest first.
    const groups: ['bookmarks' | 'history', Entry[]][] = [
      ['bookmarks', [...snapshot.bookmarks].reverse()],
      ['history', [...snapshot.history].reverse()],
    ];
    for (const [kind, entries] of groups) {
      if (kind === 'history' && entries.length) hasHistory = true;
      if (kind === 'history' && !options.includeHistory) continue;
      for (const entry of entries) {
        if (
          !safeSql(entry.sql, options.secrets) ||
          (kind === 'bookmarks' &&
            (!entry.name.trim() || options.secrets.some((s) => s && entry.name.includes(s))))
        ) {
          skipped++;
          continue;
        }
        items.push({
          kind,
          scope: snapshot.scope,
          client_ref: await clientRef(kind, snapshot.scope, entry),
          time: entry.time,
          data:
            kind === 'history' ? { sql: entry.sql } : { name: entry.name.trim(), sql: entry.sql },
          localKey: snapshot.key,
          signature: entrySignature(entry),
        });
      }
    }
  }
  return {
    items,
    history: items.filter((i) => i.kind === 'history').length,
    bookmarks: items.filter((i) => i.kind === 'bookmarks').length,
    skipped,
    hasHistory,
  };
}

export function chunk<T>(list: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < list.length; i += Math.max(1, size)) result.push(list.slice(i, i + size));
  return result;
}

export function newRef(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `r${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
