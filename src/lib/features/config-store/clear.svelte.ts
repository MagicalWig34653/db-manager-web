// SPDX-License-Identifier: AGPL-3.0-only
// Mass deletion in the server store: plan (counts, bytes, hash, required confirmation) then execute with the typed
// confirmation. The server refuses a changed plan (409 plan_stale) and a wrong confirmation (422); nothing is
// deleted by a plan.
import type { WritePhase } from '$lib/rows';
import type { Kind, Schemas } from './client';
import { errorText } from './model';
import type { ConfigStore } from './store.svelte';

export class ClearFlow {
  phase = $state<'idle' | 'planning' | 'planned' | 'executing' | 'done' | 'failed'>('idle');
  plan = $state<Schemas['ConfigClearPlan'] | null>(null);
  result = $state<Schemas['ConfigClearResult'] | null>(null);
  typed = $state('');
  error = $state('');
  /** The answer to the delete request was lost: reload the data before trusting any state. */
  unknown = $state(false);
  private kinds: Kind[] = [];
  private scope: string | undefined;

  constructor(
    private store: ConfigStore,
    private receiver: () => (phase: WritePhase) => void,
  ) {}

  reset() {
    this.phase = 'idle';
    this.plan = null;
    this.result = null;
    this.typed = '';
    this.error = '';
    this.unknown = false;
  }

  async loadPlan(kinds: Kind[], scope?: string) {
    if (this.phase === 'planning' || this.phase === 'executing') return;
    this.reset();
    this.phase = 'planning';
    this.kinds = [...kinds];
    this.scope = scope;
    const result = await this.store.clearPlan(this.kinds, scope);
    if (!result.ok) {
      this.error = errorText(result.code);
      this.phase = 'failed';
      return;
    }
    this.plan = result.value;
    this.phase = 'planned';
  }

  get canExecute() {
    return (
      this.phase === 'planned' &&
      !!this.plan &&
      this.plan.total_items > 0 &&
      this.typed === this.plan.confirmation
    );
  }

  async execute() {
    if (!this.canExecute || !this.plan) return;
    const plan = this.plan;
    this.phase = 'executing';
    this.error = '';
    const receive = this.receiver();
    receive('sending');
    const result = await this.store.clearExecute({
      kinds: this.kinds,
      ...(this.scope === undefined ? {} : { scope: this.scope }),
      plan_hash: plan.plan_hash,
      confirmation: this.typed,
    });
    if (result.ok) {
      receive('settled');
      this.result = result.value;
      this.phase = 'done';
      return;
    }
    this.unknown = result.code === 'outcome_unknown';
    receive(this.unknown ? 'unknown' : 'settled');
    this.error = errorText(result.code);
    // A changed plan needs a fresh preview; everything else lets the user retry the same plan.
    this.phase = result.code === 'plan_stale' ? 'failed' : 'planned';
    if (result.code === 'plan_stale') this.plan = null;
  }
}
