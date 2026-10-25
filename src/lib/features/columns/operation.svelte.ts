// SPDX-License-Identifier: AGPL-3.0-only
// Plan -> confirm -> exactly one execute request. After any execute attempt the operation is
// locked: another execution needs a freshly loaded plan and a new confirmation (replay
// convention of API 0.9).
import type { components } from '$lib/contract/v9/api-types';
import type { WritePhase } from '$lib/rows';
import { columnsClient, columnsErrorMessage, errorCode, type ColumnsClient } from './client';
import type { ColumnsPlan, ColumnsResult } from './model';

export type Phase = 'idle' | 'planning' | 'planned' | 'executing' | 'finished';
export interface OperationContext {
  connection: components['schemas']['Connection'] | null;
  token: string;
  table: components['schemas']['TableRef'] | null;
}
export interface OperationDeps {
  context: () => OperationContext;
  onphase?: (phase: WritePhase) => void;
  /** After an execute answer that is still relevant (completed, rejected or unknown). */
  onfinished?: (result: ColumnsResult | null, unknown: boolean) => void;
  client?: ColumnsClient;
}

export class Operation {
  phase = $state<Phase>('idle');
  plan = $state<ColumnsPlan | null>(null);
  result = $state<ColumnsResult | null>(null);
  error = $state('');
  errorCode = $state('');
  /** The outcome of the execute request is unknown (never retry). */
  unknown = $state(false);
  private base: Record<string, unknown> | null = null;
  private generation = 0;
  private controller: AbortController | null = null;

  constructor(private deps: OperationDeps) {}
  private get client() {
    return this.deps.client ?? columnsClient;
  }

  /** Discards plan, result and every pending answer (also on token/connection/table change). */
  reset() {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.phase = 'idle';
    this.plan = null;
    this.result = null;
    this.error = '';
    this.errorCode = '';
    this.unknown = false;
    this.base = null;
  }

  async loadPlan(changes: unknown[]) {
    const { connection, token, table } = this.deps.context();
    if (!connection || !table || this.phase === 'planning' || this.phase === 'executing') return;
    this.reset();
    const current = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.phase = 'planning';
    const base = { connection, table, changes };
    try {
      const plan = await this.client.plan(base, token, controller.signal);
      if (current !== this.generation) return;
      this.base = base;
      this.plan = plan;
      this.phase = 'planned';
    } catch (cause) {
      if (current !== this.generation || controller.signal.aborted) return;
      this.error = columnsErrorMessage(cause);
      this.errorCode = errorCode(cause);
      this.phase = 'idle';
    }
  }

  /** Back to editing: the shown plan no longer applies. */
  discardPlan() {
    if (this.phase === 'executing' || this.phase === 'planning') return;
    this.reset();
  }

  get canExecute() {
    return this.phase === 'planned' && !!this.plan && !!this.base;
  }

  /** Sends exactly one request. The phase flips before the first await (double click safe). */
  async execute(typedName?: string) {
    if (!this.canExecute || !this.plan || !this.base) return;
    const plan = this.plan;
    const { token } = this.deps.context();
    const confirm: Record<string, unknown> = { action: 'columns_alter' };
    if (plan.destructive) confirm.target_name = typedName ?? '';
    const body = { ...this.base, confirm, expected_plan_sha256: plan.plan_sha256 };
    const current = this.generation;
    this.phase = 'executing';
    this.error = '';
    let dispatched = false;
    // Every dispatched write reports exactly one final phase, even when its answer is stale.
    const end = (phase: WritePhase) => {
      if (dispatched) this.deps.onphase?.(phase);
    };
    try {
      const result = await this.client.alter(body, token, () => {
        dispatched = true;
        this.deps.onphase?.('sending');
      });
      end(result.outcome === 'outcome_unknown' ? 'unknown' : 'settled');
      if (current !== this.generation) return;
      this.result = result;
      this.unknown = result.outcome === 'outcome_unknown';
      this.phase = 'finished';
      this.deps.onfinished?.(result, this.unknown);
    } catch (cause) {
      const code = errorCode(cause);
      end(code === 'outcome_unknown' ? 'unknown' : 'settled');
      if (current !== this.generation) return;
      this.error = columnsErrorMessage(cause);
      this.errorCode = code;
      this.unknown = code === 'outcome_unknown';
      this.phase = 'finished';
      this.deps.onfinished?.(null, this.unknown);
    }
  }
}
