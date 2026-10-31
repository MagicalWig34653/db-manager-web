// SPDX-License-Identifier: AGPL-3.0-only
// State of the column -> transformation assignments of one table (W-P22). Persistence, in this order:
//  - server mode of the configuration store: `layouts` document (optimistic concurrency, per-column merge on conflict);
//  - local mode: the browser storage, only after an explicit opt-in (otherwise the assignment lives in memory until
//    the page is reloaded).
// Only the assignment is stored, never a cell value.
import { t } from '$lib/i18n';
import type { ConnectionDraft } from '$lib/workbench';
import { errorText } from '../config-store/model';
import type { Item } from '../config-store/client';
import { scopeFor } from '../config-store/identity';
import type { ConfigStore } from '../config-store/store.svelte';
import {
  documentKey,
  localDisable,
  localEnable,
  localOptedIn,
  localRead,
  localWrite,
  parseMapping,
  toDocument,
  withColumn,
  type ColumnMapping,
} from './mapping';
import type { InputId, InputProblem } from './transforms';
import { validateInput } from './transforms';

export type Storage = 'server' | 'browser' | 'session';
const session = new Map<string, ColumnMapping[]>();

export class TransformState {
  list = $state.raw<ColumnMapping[]>([]);
  phase = $state<'loading' | 'ready'>('loading');
  /** Where the next change is stored. */
  storage = $state<Storage>('session');
  saving = $state(false);
  /** Catalog text of the last storage problem; the assignment stays active for this session either way. */
  notice = $state('');
  /** Columns whose input editor was switched back to the plain text field (validation does not apply). */
  bypass = $state.raw<ReadonlySet<string>>(new Set());
  private item: Item | null = null;
  private scope = '';
  private key = '';
  private run = 0;

  constructor(
    private store: ConfigStore,
    private connection: ConnectionDraft,
    private table: { schema?: string; name: string },
  ) {}

  mappingFor(column: string): ColumnMapping | undefined {
    return this.list.find((m) => m.column === column);
  }

  async load() {
    const run = ++this.run;
    this.phase = 'loading';
    this.scope = await scopeFor(this.connection);
    this.key = await documentKey(this.connection.database, this.table.schema, this.table.name);
    await this.store.ensureReady().catch(() => {});
    let loaded: ColumnMapping[] | null = null;
    if (this.store.active) {
      this.storage = 'server';
      const doc = await this.store.getDocument('layouts', this.key, this.scope);
      if (doc.ok) {
        this.item = doc.value;
        loaded = doc.value ? parseMapping(doc.value.data) : [];
      } else this.notice = errorText(doc.code);
    } else if (localOptedIn()) {
      this.storage = 'browser';
      loaded = localRead(this.key) ?? [];
    } else this.storage = 'session';
    if (run !== this.run) return;
    this.list = loaded ?? session.get(this.scope + this.key) ?? [];
    this.phase = 'ready';
  }

  /** Stores the assignment of one column (or removes it when it has none) and persists it. */
  async set(next: ColumnMapping): Promise<boolean> {
    this.list = withColumn(this.list, next);
    return this.persist(next.column, next);
  }

  /** Browser opt-in (local mode only): enabling stores the current assignment, disabling deletes the stored data. */
  async setBrowserStorage(on: boolean): Promise<void> {
    if (this.store.active) return;
    this.notice = '';
    if (on) {
      if (!localEnable() || !localWrite(this.key, this.list)) {
        this.notice = t('transform.storageFailed');
        return void (this.storage = 'session');
      }
      this.storage = 'browser';
    } else {
      localDisable();
      this.storage = 'session';
      session.set(this.scope + this.key, this.list);
    }
  }

  private async persist(column: string, next: ColumnMapping, retry = true): Promise<boolean> {
    this.notice = '';
    if (this.storage === 'session' || (this.storage === 'browser' && !localOptedIn())) {
      this.storage = 'session';
      session.set(this.scope + this.key, this.list);
      return true;
    }
    if (this.storage === 'browser') {
      const ok = localWrite(this.key, this.list);
      if (!ok) {
        this.notice = t('transform.storageFailed');
        session.set(this.scope + this.key, this.list);
      }
      return ok;
    }
    this.saving = true;
    try {
      const result = await this.store.saveDocument(
        'layouts',
        this.key,
        toDocument(this.list),
        this.item,
        this.scope,
      );
      if (result.ok) {
        this.item = result.value;
        return true;
      }
      if (result.code === 'version_conflict' && 'conflict' in result && retry) {
        // Somebody else changed the table's assignments: keep theirs and apply only this column on top of it.
        this.item = result.conflict;
        const theirs = result.conflict ? parseMapping(result.conflict.data) : [];
        this.list = withColumn(theirs, next);
        return this.persist(column, next, false);
      }
      this.notice = errorText(result.code);
      return false;
    } finally {
      this.saving = false;
    }
  }

  setBypass(column: string, on: boolean) {
    const next = new Set(this.bypass);
    if (on) next.add(column);
    else next.delete(column);
    this.bypass = next;
  }

  /** The first validation problem of the given values in editor columns (switched-back columns are skipped). */
  inputProblem(column: string, value: string): { id: InputId; problem: InputProblem } | null {
    const m = this.mappingFor(column);
    if (!m?.input || this.bypass.has(column)) return null;
    const problem = validateInput(m.input.id, value, m.input.options, {
      driver: this.connection.driver,
    });
    return problem ? { id: m.input.id, problem } : null;
  }

  get driver() {
    return this.connection.driver;
  }
}
