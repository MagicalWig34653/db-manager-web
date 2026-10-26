// SPDX-License-Identifier: AGPL-3.0-only
import type { WritePhase } from '$lib/rows';
import { programsClient, errorMessage, errorCode, type ProgramsClient } from './client';
import type { Change, Plan, Result } from './model';
export class Operation {
  phase = $state<'idle' | 'planning' | 'planned' | 'executing' | 'finished'>('idle');
  plan = $state<Plan | null>(null);
  result = $state<Result | null>(null);
  error = $state('');
  unknown = $state(false);
  private base: Change | null = null;
  private generation = 0;
  private controller: AbortController | null = null;
  constructor(
    private deps: {
      token: () => string;
      onphase: (phase: WritePhase) => void;
      onfinished?: () => void;
      client?: ProgramsClient;
    },
  ) {}
  private get client() {
    return this.deps.client ?? programsClient;
  }
  reset() {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.phase = 'idle';
    this.plan = null;
    this.base = null;
    this.result = null;
    this.error = '';
    this.unknown = false;
  }
  async loadPlan(change: Change) {
    if (this.phase === 'planning' || this.phase === 'executing') return;
    this.reset();
    const current = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    // Snapshot all mutable form values before dispatch.
    const base = structuredClone($state.snapshot(change));
    this.phase = 'planning';
    try {
      const plan = await this.client.plan(base, this.deps.token(), controller.signal);
      if (current !== this.generation) return;
      if (
        plan.action !== base.action ||
        plan.object.name !== base.object.name ||
        plan.object.kind !== base.object.kind
      )
        throw new Error('Plan target mismatch');
      this.plan = plan;
      this.base = base;
      this.phase = 'planned';
    } catch (cause) {
      if (current !== this.generation) return;
      this.error = errorMessage(cause);
      this.phase = 'idle';
    }
  }
  async execute(confirmed: boolean, typedName: string) {
    if (!confirmed || this.phase !== 'planned' || !this.plan || !this.base) return;
    const plan = this.plan;
    if ((plan.action !== 'create' || plan.destructive) && typedName !== plan.object.name) return;
    const body = {
      ...this.base,
      expected_plan_sha256: plan.plan_sha256,
      confirm: {
        action: this.base.action,
        ...(plan.action !== 'create' || plan.destructive ? { target_name: typedName } : {}),
      },
    };
    const current = this.generation;
    this.phase = 'executing';
    let dispatched = false;
    const finish = (unknown: boolean) => {
      if (dispatched) this.deps.onphase(unknown ? 'unknown' : 'settled');
    };
    try {
      const result = await this.client.execute(body, this.deps.token(), () => {
        dispatched = true;
        this.deps.onphase('sending');
      });
      finish(result.outcome === 'outcome_unknown');
      if (current !== this.generation) return;
      this.result = result;
      this.unknown = result.outcome === 'outcome_unknown';
    } catch (cause) {
      const unknown = errorCode(cause) === 'outcome_unknown';
      finish(unknown);
      if (current !== this.generation) return;
      this.error = errorMessage(cause);
      this.unknown = unknown;
    }
    this.phase = 'finished';
    this.deps.onfinished?.();
  }
}
