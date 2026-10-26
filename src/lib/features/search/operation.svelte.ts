// SPDX-License-Identifier: AGPL-3.0-only
import type { WritePhase } from '$lib/rows';
import { searchClient, searchError, errorCode, type SearchClient } from './client';
import type { Schemas, Plan, Result } from './model';
export class Operation {
  phase = $state<'idle' | 'planning' | 'planned' | 'executing' | 'finished'>('idle');
  plan = $state<Plan | null>(null);
  result = $state<Result | null>(null);
  error = $state('');
  unknown = $state(false);
  private generation = 0;
  private controller: AbortController | null = null;
  private base: Schemas['ReplaceRequest'] | null = null;
  private token = '';
  constructor(
    private deps: {
      client?: SearchClient;
      onphase: () => (phase: WritePhase) => void;
      blocked: () => boolean;
    },
  ) {}
  reset() {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.phase = 'idle';
    this.plan = null;
    this.result = null;
    this.error = '';
    this.unknown = false;
    this.base = null;
    this.token = '';
  }
  async loadPlan(body: Schemas['ReplaceRequest'], token: string) {
    if (this.phase === 'executing' || this.phase === 'planning' || this.deps.blocked()) return;
    this.reset();
    const generation = this.generation;
    this.phase = 'planning';
    const controller = new AbortController();
    this.controller = controller;
    const base = structuredClone(body);
    try {
      const plan = await (this.deps.client ?? searchClient).plan(base, token, controller.signal);
      if (generation !== this.generation) return;
      this.base = base;
      this.token = token;
      this.plan = plan;
      this.phase = 'planned';
    } catch (cause) {
      if (generation !== this.generation) return;
      this.error = searchError(cause);
      this.phase = 'idle';
    }
  }
  async execute(name: string, count: string, confirmed: boolean) {
    if (
      this.phase !== 'planned' ||
      !this.plan ||
      !this.base ||
      this.deps.blocked() ||
      !confirmed ||
      name !== this.plan.table.name ||
      count !== String(this.plan.affected_rows)
    )
      return;
    const body = {
      ...this.base,
      expected_plan_sha256: this.plan.plan_sha256,
      confirm: {
        action: 'replace' as const,
        target_name: name,
        affected_rows: this.plan.affected_rows,
      },
    };
    const generation = this.generation;
    const token = this.token;
    const receiver = this.deps.onphase();
    let sent = false;
    this.phase = 'executing';
    try {
      const result = await (this.deps.client ?? searchClient).execute(body, token, () => {
        sent = true;
        receiver('sending');
      });
      if (sent) receiver(result.outcome === 'outcome_unknown' ? 'unknown' : 'settled');
      if (generation !== this.generation) return;
      this.result = result;
      this.unknown = result.outcome === 'outcome_unknown';
      this.phase = 'finished';
    } catch (cause) {
      const unknown = errorCode(cause) === 'outcome_unknown';
      if (sent) receiver(unknown ? 'unknown' : 'settled');
      if (generation !== this.generation) return;
      this.error = searchError(cause);
      this.unknown = unknown;
      this.phase = 'finished';
    }
  }
}
