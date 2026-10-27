// SPDX-License-Identifier: AGPL-3.0-only
import { ApiError } from '$lib/api';
import type { WritePhase } from '$lib/rows';
import { t } from '$lib/i18n';
import { bulkClient, errorCode, errorText, isRejection, type BulkClient } from './client';
import { executeRequest, planMatches, type BulkResult, type Plan, type PlanRequest } from './model';

export type Phase = 'idle' | 'planning' | 'planned' | 'executing' | 'finished' | 'unknown';

/**
 * Plan -> confirm -> execute for one selection. The execute request is sent at most once per plan: the moment it
 * leaves the browser the plan counts as spent (the server consumes the hash as well, also when the outcome is unknown).
 */
export class BulkOperation {
  phase = $state<Phase>('idle');
  plan = $state.raw<Plan | null>(null);
  result = $state.raw<BulkResult | null>(null);
  error = $state('');
  errorCode = $state('');
  consumed = $state(false);
  /** The plan is gone for good (conflict, spent hash): a new preview is required, rows may need a reload. */
  stale = $state(false);
  unknown = $state(false);

  private generation = 0;
  private controller: AbortController | null = null;
  private base: PlanRequest | null = null;
  private reported = false;

  constructor(
    private deps: {
      client?: Pick<BulkClient, 'plan' | 'execute'>;
      primaryKey: () => string[];
    },
  ) {}

  private get client() {
    return this.deps.client ?? bulkClient;
  }
  get busy() {
    return this.phase === 'planning' || this.phase === 'executing';
  }

  reset(report?: (phase: WritePhase) => void) {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    if (this.reported) {
      this.reported = false;
      report?.('unknown');
    }
    this.phase = 'idle';
    this.plan = null;
    this.result = null;
    this.error = '';
    this.errorCode = '';
    this.consumed = false;
    this.stale = false;
    this.unknown = false;
    this.base = null;
  }

  async makePlan(request: PlanRequest, token: string) {
    if (this.busy) return;
    this.reset();
    const mine = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.phase = 'planning';
    try {
      const plan = await this.client.plan(structuredClone(request), token, controller.signal);
      if (mine !== this.generation) return;
      if (!planMatches(request, plan, this.deps.primaryKey()))
        throw new ApiError('invalid_response', t('bulk.err.invalidResponse'));
      this.base = structuredClone(request);
      this.plan = plan;
      this.phase = 'planned';
    } catch (cause) {
      if (mine !== this.generation) return;
      this.phase = 'idle';
      if (controller.signal.aborted) return;
      this.errorCode = errorCode(cause);
      this.error = errorText(cause);
      this.stale = ['plan_conflict', 'row_conflict'].includes(this.errorCode);
    }
  }

  async execute(token: string, report: (phase: WritePhase) => void) {
    // Synchronous guards: a double activation or a replay of a spent plan never reaches the network.
    if (this.phase !== 'planned' || this.consumed || !this.plan || !this.base) return;
    const mine = ++this.generation;
    const request = executeRequest(this.base, this.plan);
    const controller = new AbortController();
    this.controller = controller;
    this.phase = 'executing';
    this.error = '';
    this.errorCode = '';
    let dispatched = false;
    try {
      const result = await this.client.execute(request, token, controller.signal, () => {
        dispatched = true;
        this.consumed = true;
        this.reported = true;
        report('sending');
      });
      if (mine !== this.generation) return;
      this.result = result;
      this.unknown = result.outcome === 'outcome_unknown';
      this.stale = result.outcome === 'rejected';
      this.errorCode = result.reason ?? '';
      this.phase = 'finished';
      this.settle(report, this.unknown ? 'unknown' : 'settled');
    } catch (cause) {
      if (mine !== this.generation) return;
      const unknown = dispatched && !isRejection(cause);
      this.errorCode = errorCode(cause);
      if (unknown) {
        this.unknown = true;
        this.error = t('bulk.unknown');
        this.phase = 'unknown';
        this.settle(report, 'unknown');
      } else {
        this.error = errorText(cause);
        this.stale = dispatched || ['plan_conflict', 'row_conflict'].includes(this.errorCode);
        this.phase = 'finished';
        this.settle(report, 'settled');
      }
    }
  }

  private settle(report: (phase: WritePhase) => void, phase: 'settled' | 'unknown') {
    if (!this.reported) return;
    this.reported = false;
    report(phase);
  }

  /** Abort a preview. A sent execute request cannot be taken back, so this does nothing for it. */
  cancelPlan() {
    if (this.phase === 'planning') this.controller?.abort();
  }
}
