// SPDX-License-Identifier: AGPL-3.0-only
import { ApiError } from '$lib/api';
import type { WritePhase } from '$lib/rows';
import { maintenanceClient, errorCode, errorText, type MaintenanceClient } from './client';
import {
  tableKey,
  validItems,
  type Connection,
  type Item,
  type PlanResult,
  type Result,
} from './model';
interface Dependencies {
  context: () => { connection: Connection | null; token: string };
  receiver: () => (phase: WritePhase) => void;
  client?: MaintenanceClient;
  onfinished?: () => void;
}
export class Operation {
  phase = $state<'idle' | 'planning' | 'planned' | 'executing' | 'finished'>('idle');
  plan = $state<PlanResult | null>(null);
  result = $state<Result | null>(null);
  error = $state('');
  unknown = $state(false);
  private generation = 0;
  private controller: AbortController | null = null;
  private base: { connection: Connection; items: Item[] } | null = null;
  constructor(private deps: Dependencies) {}
  private get client() {
    return this.deps.client ?? maintenanceClient;
  }
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
  }
  async loadPlan(items: Item[]) {
    const { connection, token } = this.deps.context();
    if (
      !connection ||
      !validItems(items) ||
      this.phase === 'executing' ||
      this.phase === 'planning'
    )
      return;
    this.reset();
    const generation = this.generation;
    this.controller = new AbortController();
    const base = structuredClone({ connection, items });
    this.phase = 'planning';
    try {
      const plan = await this.client.plan(base, token, this.controller.signal);
      if (generation !== this.generation) return;
      if (
        plan.items.length !== items.length ||
        plan.items.some(
          (item, index) =>
            item.action !== items[index].action ||
            item.table.name !== items[index].table.name ||
            (items[index].table.schema !== undefined &&
              item.table.schema !== items[index].table.schema) ||
            (item.plan !== null && item.plan.driver !== connection.driver),
        )
      )
        throw new ApiError('invalid_response', '');
      this.base = base;
      this.plan = plan;
      this.phase = 'planned';
    } catch (error) {
      if (generation !== this.generation) return;
      this.error = errorText(error);
      this.phase = 'idle';
    }
  }
  canExecute(accepted: boolean, names: Record<number, string>) {
    return (
      accepted &&
      this.phase === 'planned' &&
      !!this.base &&
      !!this.plan?.items.some((item) => item.state === 'planned') &&
      this.plan.items.every(
        (item, index) => !item.typed_confirmation || names[index] === item.target_name,
      )
    );
  }
  async execute(accepted: boolean, names: Record<number, string>) {
    if (!this.canExecute(accepted, names) || !this.plan || !this.base) return;
    const items = this.plan.items.flatMap((item, index) =>
      item.state === 'planned' && item.plan
        ? [
            {
              ...this.base!.items[index],
              table: { ...item.table },
              expected_plan_sha256: item.plan.plan_sha256,
              confirm: {
                action: item.action,
                ...(item.typed_confirmation ? { target_name: names[index] } : {}),
              },
            },
          ]
        : [],
    );
    const body = { connection: this.base.connection, items };
    const generation = this.generation;
    const receiver = this.deps.receiver();
    const token = this.deps.context().token;
    this.phase = 'executing';
    this.error = '';
    let dispatched = false;
    let finalPhase: WritePhase = 'settled';
    try {
      const result = await this.client.execute(body, token, () => {
        dispatched = true;
        receiver('sending');
      });
      // A schema-valid but unrelated/incomplete answer cannot confirm these writes.
      if (
        result.items.length !== items.length ||
        result.items.some(
          (item, index) =>
            item.action !== items[index].action ||
            tableKey(item.table) !== tableKey(items[index].table),
        )
      )
        throw new ApiError('outcome_unknown', '');
      finalPhase = result.items.some((item) => item.outcome === 'outcome_unknown')
        ? 'unknown'
        : 'settled';
      if (generation !== this.generation) return;
      this.result = result;
      this.unknown = finalPhase === 'unknown';
    } catch (error) {
      finalPhase = errorCode(error) === 'outcome_unknown' ? 'unknown' : 'settled';
      if (generation !== this.generation) return;
      this.error = errorText(error);
      this.unknown = finalPhase === 'unknown';
    } finally {
      if (dispatched) receiver(finalPhase);
      if (generation === this.generation) {
        this.phase = 'finished';
        this.deps.onfinished?.();
      }
    }
  }
}
