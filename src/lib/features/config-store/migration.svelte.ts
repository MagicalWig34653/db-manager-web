// SPDX-License-Identifier: AGPL-3.0-only
// Migration of the browser-local W-P16 data (history, bookmarks) into the server store through the idempotent batch
// import. Nothing runs without an explicit confirmation, nothing local is deleted automatically, and local entries are
// removed only for entries the server confirmed (created/exists/updated) and only on a second explicit action.
import type { WritePhase } from '$lib/rows';
import { readLocalLibraries, removeLocalWhere } from '../sql-editor/storage.svelte';
import type { ConfigStore } from './store.svelte';
import { chunk, errorText, prepareMigration, type MigrationPreview, type Prepared } from './model';

export interface MigrationSummary {
  created: number;
  exists: number;
  updated: number;
  rejected: number;
  /** Rejection reason code → count (codes only, never input). */
  reasons: Record<string, number>;
}

export class Migration {
  phase = $state<'idle' | 'ready' | 'running' | 'done' | 'failed' | 'deleted'>('idle');
  preview = $state<MigrationPreview | null>(null);
  includeHistory = $state(false);
  confirmed = $state(false);
  summary = $state<MigrationSummary | null>(null);
  error = $state('');
  deletedCount = $state(0);
  private accepted: Prepared[] = [];
  private snapshotsFor = () => readLocalLibraries();

  constructor(
    private store: ConfigStore,
    private receiver: () => (phase: WritePhase) => void,
    private secrets: () => string[],
    snapshots?: typeof readLocalLibraries,
  ) {
    if (snapshots) this.snapshotsFor = () => snapshots();
  }

  /** Counts what would be transferred (no network). */
  async refreshPreview() {
    if (this.phase === 'running') return;
    this.preview = await prepareMigration(this.snapshotsFor(), {
      includeHistory: this.includeHistory,
      secrets: this.secrets(),
    });
    if (this.phase === 'idle' || this.phase === 'ready')
      this.phase = this.preview.items.length || this.preview.hasHistory ? 'ready' : 'idle';
  }

  get canRun() {
    return (
      this.phase !== 'running' &&
      this.confirmed &&
      !!this.preview &&
      this.preview.items.length > 0 &&
      this.store.active &&
      !this.store.degraded
    );
  }

  async run() {
    if (!this.canRun || !this.preview) return;
    // Synchronous before the first await: a second click sees `running` and does nothing.
    this.phase = 'running';
    this.error = '';
    this.summary = null;
    this.accepted = [];
    const receive = this.receiver();
    receive('sending');
    const summary: MigrationSummary = {
      created: 0,
      exists: 0,
      updated: 0,
      rejected: 0,
      reasons: {},
    };
    try {
      if (this.preview.items.some((i) => i.kind === 'history') && !this.store.historyEnabled) {
        const optIn = await this.store.setHistoryEnabled(true);
        if (!optIn.ok) throw optIn;
      }
      const size = this.store.caps?.max_import_items ?? 100;
      for (const batch of chunk(this.preview.items, size)) {
        const result = await this.store.importBatch(
          batch.map((p) => ({
            kind: p.kind,
            scope: p.scope,
            client_ref: p.client_ref,
            time: p.time,
            data: p.data,
          })),
        );
        if (!result.ok) throw result;
        for (const line of result.value.results) {
          const entry = batch[line.index];
          if (!entry) continue;
          if (line.status === 'rejected') {
            summary.rejected++;
            summary.reasons[line.reason || 'rejected'] =
              (summary.reasons[line.reason || 'rejected'] ?? 0) + 1;
          } else {
            summary[line.status]++;
            this.accepted.push(entry);
          }
        }
        this.summary = { ...summary };
      }
      this.summary = summary;
      this.phase = 'done';
      this.store.revision++;
    } catch (cause) {
      const code = (cause as { code?: string })?.code ?? 'error';
      this.error = errorText(code);
      this.phase = 'failed';
      this.summary = summary;
    } finally {
      receive('settled');
    }
  }

  /** Optional, separate action: removes exactly the entries the server confirmed from this browser. */
  deleteLocal() {
    if (this.phase !== 'done' || !this.accepted.length) return;
    const groups = new Map<string, Prepared[]>();
    for (const entry of this.accepted) {
      const key = `${entry.localKey}\0${entry.kind}`;
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
    for (const entries of groups.values()) {
      const signatures = new Set(entries.map((e) => e.signature));
      removeLocalWhere(entries[0].localKey, entries[0].kind, (local) =>
        signatures.has(JSON.stringify([local.time, local.name, local.sql])),
      );
    }
    this.deletedCount = this.accepted.length;
    this.accepted = [];
    this.phase = 'deleted';
    this.preview = null;
  }
}
