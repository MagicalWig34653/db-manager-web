// SPDX-License-Identifier: AGPL-3.0-only
// State and execution of the SQL workspace; lives in the shell so it survives tab changes.
import { gateway } from '$lib/gateway';
import type { Execution } from '$lib/workbench';
import type { Session } from './session.svelte';

export class SqlRunner {
  sql = $state('');
  running = $state(false);
  error = $state('');
  cancelled = $state(false);
  execution = $state<Execution | null>(null);
  activeResult = $state(0);
  rowLimit = $state(100);
  timeoutMs = $state(10000);
  /** Registered by the mounted editor component. */
  focus: () => void = () => {};
  private controller: AbortController | undefined;

  lineCount = $derived(Math.min(Math.max(this.sql.split('\n').length, 10), 10000));
  currentResult = $derived(this.execution?.results[this.activeResult]);

  async execute(session: Session) {
    const connection = session.connection;
    if (!connection || !this.sql.trim() || this.running || session.connectionBusy) return;
    const version = session.sessionVersion;
    const requestController = new AbortController();
    this.controller = requestController;
    this.running = true;
    this.error = '';
    this.cancelled = false;
    this.execution = null;
    this.activeResult = 0;
    try {
      const result = await gateway.execute(
        connection,
        session.backendToken,
        this.sql,
        { maxRows: this.rowLimit, timeoutMs: this.timeoutMs },
        requestController.signal,
      );
      if (version === session.sessionVersion) this.execution = result;
    } catch (cause) {
      if (version !== session.sessionVersion) return;
      if (requestController.signal.aborted) this.cancelled = true;
      else
        this.error =
          cause instanceof Error ? cause.message : 'Die Abfrage konnte nicht ausgeführt werden.';
    } finally {
      if (version === session.sessionVersion) this.running = false;
    }
  }
  cancel() {
    this.controller?.abort();
  }
  /** Drops results and errors but keeps the editor text (new connection). */
  clearResults() {
    this.execution = null;
    this.error = '';
    this.cancelled = false;
  }
  /** Full reset (session cleared). */
  reset() {
    this.controller?.abort();
    this.controller = undefined;
    this.sql = '';
    this.activeResult = 0;
    this.running = false;
    this.clearResults();
  }
}
