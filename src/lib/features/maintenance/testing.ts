// SPDX-License-Identifier: AGPL-3.0-only
import type { Capabilities, Item, PlanResult, Result } from './model';
import { actions } from './model';
export const item: Item = { table: { schema: 'main', name: 'orders' }, action: 'analyze' };
export const hash = 'a'.repeat(64);
export function capabilities(): Capabilities {
  const driver = (allowed: string[]) =>
    Object.fromEntries(
      actions.map((action) => [
        action,
        {
          support: allowed.includes(action) ? 'limited' : 'unsupported',
          reason: allowed.includes(action)
            ? 'Rechte und Tabellenart werden geprüft.'
            : 'Diese Aktion ist für diesen Treiber gesperrt.',
        },
      ]),
    ) as Capabilities['drivers']['sqlite'];
  return {
    contract_version: '0.10.0',
    available: true,
    drivers: {
      sqlite: driver(['check', 'analyze']),
      mysql: driver(['analyze', 'optimize', 'repair', 'check', 'checksum']),
      postgres: driver(['analyze', 'vacuum', 'reindex']),
    },
    max_items: 50,
    default_timeout_ms: 10000,
    max_timeout_ms: 60000,
    max_request_bytes: 1048576,
  };
}
export function plan(items: Item[] = [item], typed = false): PlanResult {
  return {
    items: items.map((item) => ({
      table: item.table,
      action: item.action,
      state: 'planned',
      reason: '',
      typed_confirmation: typed,
      target_name: item.table.name,
      plan: {
        driver: 'sqlite',
        statements: [`ANALYZE "main"."${item.table.name}"`],
        warnings: ['Laufzeit ungewiss; Sperren möglich.'],
        affected_objects: [`main.${item.table.name}`],
        plan_sha256: hash,
      },
    })),
  };
}
export function result(items: Item[] = [item]): Result {
  return {
    items: items.map((item) => ({
      table: item.table,
      action: item.action,
      outcome: 'completed',
      reason: '',
      checksum: null,
      duration_ms: 2,
    })),
    partial: false,
  };
}
