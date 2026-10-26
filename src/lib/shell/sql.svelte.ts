// SPDX-License-Identifier: AGPL-3.0-only
// State and execution of the SQL workspace; lives in the shell so it survives tab changes.
import { recordQuery } from '$lib/features/sql-editor/storage.svelte';
import { t } from '$lib/i18n';
import { ApiError } from '$lib/api';
import { gateway } from '$lib/gateway';
import type { Execution } from '$lib/workbench';
import type { Session } from './session.svelte';

// Conservative: only a plain single SELECT/VALUES/SHOW counts as read-only for the unknown-outcome decision.
// Anything else (DDL/DML, CTEs, EXPLAIN ANALYZE, several statements, SELECT ... INTO, locking reads) may have changed data.
export function looksReadOnly(sql: string): boolean {
  const text = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim()
    .replace(/;\s*$/, '');
  if (text.includes(';') || (/['"`$]/.test(text) && /\binto\b/i.test(text))) return false;
  if (!/^(select|values|show)\b/i.test(text)) return false;
  return !/\b(into|for\s+(update|share|no\s+key)|lock\s+in\s+share)\b/i.test(text);
}

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
    if (
      !connection ||
      !this.sql.trim() ||
      this.running ||
      session.connectionBusy ||
      session.writeInFlight
    )
      return;
    recordQuery(connection, this.sql, session.backendToken);
    const version = session.sessionVersion;
    const requestController = new AbortController();
    this.controller = requestController;
    this.running = true;
    this.error = '';
    this.cancelled = false;
    this.execution = null;
    this.activeResult = 0;
    // The editor runs arbitrary SQL (/api/v1/query: DDL and DML possible) and SQL cannot be classified reliably
    // (CTE with DML, side-effect functions, several statements). So every run is a writer for navigation/unload
    // protection; only a failed or cancelled run of a plain SELECT settles cleanly, everything else is unknown.
    const report = session.databaseWriteReceiver(version);
    const readOnly = looksReadOnly(this.sql);
    let phase: 'settled' | 'unknown' = 'settled';
    report('sending');
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
      const definite =
        cause instanceof ApiError &&
        !['outcome_unknown', 'query_canceled', 'invalid_response', 'result_too_large'].includes(
          cause.code,
        );
      if (!readOnly && !definite) phase = 'unknown';
      if (version !== session.sessionVersion) return;
      if (requestController.signal.aborted) this.cancelled = true;
      else this.error = cause instanceof Error ? cause.message : t('sql.executeFailed');
    } finally {
      report(phase);
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
