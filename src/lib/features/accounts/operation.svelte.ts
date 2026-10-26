// SPDX-License-Identifier: AGPL-3.0-only
import type { WritePhase } from '$lib/rows';
import { accountsClient, errorCode, errorMessage, type AccountsClient } from './client';
import { validSecret, type Action, type Schemas } from './model';

export interface Context {
  connection: Schemas['Connection'] | null;
  token: string;
}
export interface OperationDeps {
  context: () => Context;
  receiver: () => (phase: WritePhase) => void;
  blocked?: () => boolean;
  client?: AccountsClient;
  onfinished?: () => void;
}
export class Operation {
  phase = $state<'idle' | 'planning' | 'planned' | 'executing' | 'finished'>('idle');
  plan = $state<Schemas['AccountPlan'] | null>(null);
  result = $state<Schemas['AccountResult'] | null>(null);
  error = $state('');
  unknown = $state(false);
  private base: Record<string, unknown> | null = null;
  private generation = 0;
  private controller: AbortController | null = null;
  private token = '';
  constructor(private deps: OperationDeps) {}
  private get client() {
    return this.deps.client ?? accountsClient;
  }
  reset() {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.phase = 'idle';
    this.plan = null;
    this.result = null;
    this.base = null;
    this.error = '';
    this.unknown = false;
    this.token = '';
  }
  async loadPlan(action: Action, fields: Record<string, unknown>) {
    if (this.phase === 'executing' || this.phase === 'planning' || this.deps.blocked?.()) return;
    const { connection, token } = this.deps.context();
    if (!connection) return;
    this.reset();
    const generation = this.generation;
    const controller = (this.controller = new AbortController());
    // Never accept a secret in a plan snapshot, including when called outside the UI.
    if ('secret' in fields || 'connection' in fields) return;
    const base = JSON.parse(JSON.stringify({ connection, ...fields })) as Record<string, unknown>;
    this.phase = 'planning';
    try {
      const plan = await this.client.plan(action, base, token, controller.signal);
      if (generation !== this.generation || controller.signal.aborted) return;
      this.base = base;
      this.token = token;
      this.plan = plan;
      this.phase = 'planned';
    } catch (cause) {
      if (generation !== this.generation || controller.signal.aborted) return;
      this.error = errorMessage(cause);
      this.phase = 'idle';
    }
  }
  canExecute(confirmed: boolean, typedName: string, acknowledgeSelf: boolean, secret = '') {
    const plan = this.plan;
    return (
      this.phase === 'planned' &&
      !!this.base &&
      !!plan &&
      !this.deps.blocked?.() &&
      confirmed &&
      (!plan.destructive || typedName === plan.confirmation.target_name) &&
      (!plan.self || acknowledgeSelf) &&
      (!plan.requires_secret || validSecret(secret))
    );
  }
  async execute(confirmed: boolean, typedName: string, acknowledgeSelf: boolean, secret = '') {
    if (!this.canExecute(confirmed, typedName, acknowledgeSelf, secret) || !this.plan || !this.base)
      return;
    const plan = this.plan;
    const generation = this.generation;
    const token = this.token;
    const receive = this.deps.receiver();
    const body: Record<string, unknown> = {
      ...this.base,
      expected_plan_sha256: plan.plan_sha256,
      confirm: {
        action: plan.action,
        ...(plan.destructive ? { target_name: typedName } : {}),
        ...(plan.self ? { acknowledge_self: acknowledgeSelf } : {}),
      },
      ...(plan.requires_secret ? { secret } : {}),
    };
    secret = '';
    this.phase = 'executing';
    this.error = '';
    let dispatched = false;
    try {
      const result = await this.client.execute(plan.action, body, token, () => {
        dispatched = true;
        receive('sending');
      });
      receiveEnd(result.outcome === 'outcome_unknown' ? 'unknown' : 'settled');
      if (generation !== this.generation) return;
      this.result = result;
      this.unknown = result.outcome === 'outcome_unknown';
      this.phase = 'finished';
      this.deps.onfinished?.();
    } catch (cause) {
      const unknown = errorCode(cause) === 'outcome_unknown';
      receiveEnd(unknown ? 'unknown' : 'settled');
      if (generation !== this.generation) return;
      this.error = errorMessage(cause);
      this.unknown = unknown;
      this.phase = 'finished';
      this.deps.onfinished?.();
    } finally {
      delete body.secret;
      if (generation === this.generation) {
        this.base = null;
        this.token = '';
      }
    }
    function receiveEnd(phase: WritePhase) {
      if (dispatched) {
        dispatched = false;
        receive(phase);
      }
    }
  }
}
