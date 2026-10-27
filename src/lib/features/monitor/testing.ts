// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic test data for the monitor views (no real server data).
import type { Action, Capabilities, MonitorRecord, MonitorResult, Restriction } from './model';

const actions: Action[] = [
  'sample',
  'analysis',
  'advisor',
  'replication',
  'binary-logs',
  'binary-events',
  'profiling',
  'engines',
];
const drivers: Restriction['driver'][] = ['sqlite', 'mysql', 'postgres'];

/** The contract lists every driver/action pair (24 entries) as limited or unsupported. */
export function capabilities(
  over: Partial<Capabilities> = {},
  unsupported: ReadonlySet<string> = new Set(
    actions.filter((a) => a !== 'sample' && a !== 'engines').map((a) => `sqlite:${a}`),
  ),
): Capabilities {
  const entries: Restriction[] = drivers.flatMap((driver) =>
    actions.map((action) =>
      unsupported.has(`${driver}:${action}`)
        ? {
            driver,
            action,
            support: 'unsupported' as const,
            reason: `${driver} bietet ${action} nicht an.`,
          }
        : {
            driver,
            action,
            support: 'limited' as const,
            reason: 'Hängt von den Rechten der Verbindung ab.',
          },
    ),
  );
  return {
    contract_version: '0.20.0',
    available: true,
    read_only: true,
    max_limit: 200,
    max_offset: 10000,
    max_timeout_ms: 30000,
    max_response_bytes: 8388608,
    drivers: entries,
    ...over,
  };
}

export function result(
  action: Action,
  records: MonitorRecord[] = [],
  over: Partial<MonitorResult> = {},
): MonitorResult {
  return {
    driver: 'mysql',
    action,
    state: 'available',
    reason: '',
    source: 'global_status',
    sampled_at: '2026-10-27T09:15:00Z',
    duration_ms: 3,
    records,
    hints: [],
    limit: 50,
    offset: 0,
    has_more: false,
    truncated: false,
    ...over,
  };
}
