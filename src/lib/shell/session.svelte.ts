// SPDX-License-Identifier: AGPL-3.0-only
// Connection and session store. Memory only: no localStorage, no IndexedDB, nothing in the URL.
import { t } from '$lib/i18n';
import { gateway } from '$lib/gateway';
import type { WritePhase } from '$lib/rows';
import type { CatalogObject, ConnectionDraft, Driver } from '$lib/workbench';

export interface SessionHooks {
  /** Called right after a new connection was accepted, before the catalog loads. */
  onConnected: (draft: ConnectionDraft) => void;
  /** Called after the catalog request of a new connection finished. */
  onCatalogSettled: () => void;
  /** Called after the session was cleared completely. */
  onCleared: () => void;
}

export class Session {
  /** Number of write requests currently sent without a final answer (features report phases). */
  writeCount = $state(0);
  get writeInFlight() {
    return this.writeCount > 0;
  }
  writeNotice = $state(false);
  connection = $state<ConnectionDraft | null>(null);
  selectedObject = $state<CatalogObject | null>(null);
  objects = $state<CatalogObject[]>([]);
  objectSearch = $state('');
  connectionOpen = $state(false);
  accessOpen = $state(false);
  backendToken = $state('');
  tokenDraft = $state('');
  connectionBusy = $state(false);
  availableDrivers = $state<Driver[] | undefined>();
  connectionMessage = $state('');
  catalogBusy = $state(false);
  catalogError = $state('');
  catalogLoaded = $state(false);
  /** Capability keys offered by the backend; feature packages fill this later. */
  capabilities = $state<ReadonlySet<string>>(new Set());
  sessionVersion = $state(0);
  signal: AbortSignal;
  private controller = new AbortController();
  private hooks: SessionHooks;

  constructor(hooks: SessionHooks) {
    this.hooks = hooks;
    this.signal = this.controller.signal;
  }

  filteredObjects = $derived(
    this.objects.filter((object) =>
      `${object.schema ?? ''}.${object.name}`
        .toLowerCase()
        .includes(this.objectSearch.toLowerCase()),
    ),
  );

  separateWriteContext() {
    if (this.writeInFlight) this.writeNotice = true;
    this.writeCount = 0;
  }
  /** Counts phases so that a second write feature cannot lift the protection of the first. */
  private applyPhase(phase: WritePhase) {
    if (phase === 'sending') this.writeCount++;
    else if (this.writeCount > 0) this.writeCount--;
    if (phase === 'unknown') this.writeNotice = true;
  }
  writeReceiver(source: CatalogObject, version: number) {
    return (phase: WritePhase) => {
      if (version !== this.sessionVersion) return;
      // Every phase counts (also after the selected object changed), so the counter cannot stick.
      void source;
      this.applyPhase(phase);
    };
  }
  /** Receiver for write features of database tabs: not bound to an object, bound to the session. */
  databaseWriteReceiver(version: number) {
    return (phase: WritePhase) => {
      if (version !== this.sessionVersion) return;
      this.applyPhase(phase);
    };
  }
  async openConnection() {
    this.connectionMessage = '';
    this.availableDrivers = undefined;
    this.connectionOpen = true;
    const version = this.sessionVersion;
    try {
      const drivers = await gateway.capabilities(this.backendToken, this.signal);
      if (version === this.sessionVersion) this.availableDrivers = drivers;
    } catch (cause) {
      if (version === this.sessionVersion)
        this.connectionMessage =
          cause instanceof Error ? cause.message : t('session.backendUnreachable');
    }
  }
  async testConnection(draft: ConnectionDraft) {
    const version = this.sessionVersion;
    this.connectionBusy = true;
    this.connectionMessage = '';
    try {
      const message = await gateway.test(draft, this.backendToken, this.signal);
      if (version === this.sessionVersion) this.connectionMessage = message;
    } catch (cause) {
      if (version === this.sessionVersion)
        this.connectionMessage = cause instanceof Error ? cause.message : t('session.testFailed');
    } finally {
      if (version === this.sessionVersion) this.connectionBusy = false;
    }
  }
  async connect(draft: ConnectionDraft) {
    const version = this.sessionVersion;
    this.connectionBusy = true;
    this.connectionMessage = '';
    try {
      await gateway.test(draft, this.backendToken, this.signal);
      if (version !== this.sessionVersion) return;
      this.separateWriteContext();
      this.connection = draft;
      this.selectedObject = null;
      this.objects = [];
      this.catalogLoaded = false;
      this.connectionOpen = false;
      this.hooks.onConnected(draft);
      await this.loadCatalog();
      this.hooks.onCatalogSettled();
    } catch (cause) {
      if (version === this.sessionVersion)
        this.connectionMessage =
          cause instanceof Error ? cause.message : t('session.connectFailed');
    } finally {
      if (version === this.sessionVersion) this.connectionBusy = false;
    }
  }
  async loadCatalog() {
    if (!this.connection) return;
    const version = this.sessionVersion;
    const sourceConnection = this.connection;
    this.catalogBusy = true;
    this.catalogError = '';
    try {
      const loaded = await gateway.catalog(this.connection, this.backendToken, this.signal);
      if (version === this.sessionVersion && this.connection === sourceConnection) {
        this.objects = loaded;
        this.catalogLoaded = true;
      }
    } catch (cause) {
      if (version === this.sessionVersion && this.connection === sourceConnection)
        this.catalogError = cause instanceof Error ? cause.message : t('session.catalogFailed');
    } finally {
      if (version === this.sessionVersion && this.connection === sourceConnection)
        this.catalogBusy = false;
    }
  }
  clearSession() {
    this.separateWriteContext();
    this.sessionVersion++;
    this.controller.abort();
    this.controller = new AbortController();
    this.signal = this.controller.signal;
    this.connection = null;
    this.selectedObject = null;
    this.backendToken = '';
    this.tokenDraft = '';
    this.objects = [];
    this.catalogLoaded = false;
    this.catalogError = '';
    this.objectSearch = '';
    this.connectionMessage = '';
    this.accessOpen = false;
    this.connectionOpen = false;
    this.connectionBusy = false;
    this.catalogBusy = false;
    this.availableDrivers = undefined;
    this.hooks.onCleared();
  }
  applyToken() {
    const nextToken = this.tokenDraft;
    if (nextToken !== this.backendToken) {
      this.clearSession();
      this.backendToken = nextToken;
    } else {
      this.tokenDraft = '';
      this.accessOpen = false;
    }
  }
  destroy() {
    this.controller.abort();
  }
}
