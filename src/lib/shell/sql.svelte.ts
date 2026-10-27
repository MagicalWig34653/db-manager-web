// SPDX-License-Identifier: AGPL-3.0-only
// State and execution of the SQL workspace; lives in the shell so it survives tab changes.
import { HIDDEN_CHARACTERS } from '$lib/features/sql-editor/hidden';
import { recordQuery } from '$lib/features/sql-editor/storage.svelte';
import {
  placeholderNames,
  substitute,
  VariableError,
  type VariableInput,
} from '$lib/features/sql-editor/variables';
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

export { HIDDEN_CHARACTERS };

export class SqlRunner {
  sql = $state('');
  running = $state(false);
  error = $state('');
  cancelled = $state(false);
  execution = $state<Execution | null>(null);
  activeResult = $state(0);
  rowLimit = $state(100);
  timeoutMs = $state(10000);
  /** Placeholder names (":name") waiting for values; the variable dialog is shown while this is set. */
  variablePrompt = $state<string[] | null>(null);
  /** Last entered values, kept in memory only for this page load (never stored, never part of history). */
  variableValues = $state<Record<string, VariableInput>>({});
  /** Statement waiting for the user's confirmation because it contains hidden or direction-changing characters. */
  hiddenPending = $state<string | null>(null);
  /** Registered by the mounted editor component. */
  focus: () => void = () => {};
  private controller: AbortController | undefined;

  lineCount = $derived(Math.min(Math.max(this.sql.split('\n').length, 10), 10000));
  currentResult = $derived(this.execution?.results[this.activeResult]);

  /**
   * `text` is the already resolved SQL (placeholders replaced or deliberately sent unchanged). Without it the
   * editor text is checked for ":name" placeholders first and the variable dialog is requested instead of running.
   */
  async execute(session: Session, text?: string, confirmedHidden = false) {
    const connection = session.connection;
    if (
      !connection ||
      !this.sql.trim() ||
      this.running ||
      session.connectionBusy ||
      session.writeInFlight
    )
      return;
    if (text === undefined) {
      const names = placeholderNames(this.sql, connection.driver);
      if (names.length > 0) {
        this.variablePrompt = names;
        return;
      }
    }
    const statement = text ?? this.sql;
    // Bidi, zero-width and control characters can make SQL read differently from what it does: ask first.
    if (!confirmedHidden && HIDDEN_CHARACTERS.test(statement)) {
      this.hiddenPending = statement;
      return;
    }
    this.hiddenPending = null;
    // History and bookmarks store the editor text with its placeholders, never the substituted values.
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
    const readOnly = looksReadOnly(statement);
    let phase: 'settled' | 'unknown' = 'settled';
    report('sending');
    try {
      const result = await gateway.execute(
        connection,
        session.backendToken,
        statement,
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
  /** Replaces placeholders with the entered values (client-side text replacement) and runs the result. */
  async runWithValues(session: Session, values: Record<string, VariableInput>) {
    const connection = session.connection;
    if (!connection) return;
    let resolved: string;
    try {
      resolved = substitute(this.sql, connection.driver, values);
    } catch (cause) {
      if (cause instanceof VariableError) return cause;
      throw cause;
    }
    this.variableValues = { ...values };
    this.variablePrompt = null;
    await this.execute(session, resolved);
  }
  /** Runs the editor text exactly as written, ":name" included. */
  async runUnchanged(session: Session) {
    this.variablePrompt = null;
    await this.execute(session, this.sql);
  }
  async runHiddenConfirmed(session: Session) {
    const statement = this.hiddenPending;
    this.hiddenPending = null;
    if (statement !== null) await this.execute(session, statement, true);
  }
  cancelPrompt() {
    this.variablePrompt = null;
    this.hiddenPending = null;
  }
  cancel() {
    this.controller?.abort();
  }
  /** Drops results and errors but keeps the editor text (new connection). */
  clearResults() {
    this.variablePrompt = null;
    this.hiddenPending = null;
    this.execution = null;
    this.error = '';
    this.cancelled = false;
  }
  /** Full reset (session cleared). */
  reset() {
    this.controller?.abort();
    this.controller = undefined;
    this.sql = '';
    this.variablePrompt = null;
    this.variableValues = {};
    this.activeResult = 0;
    this.running = false;
    this.clearResults();
  }
}
