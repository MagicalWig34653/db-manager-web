// SPDX-License-Identifier: AGPL-3.0-only
import type { components } from '$lib/contract/v20/api-types';
import { apiDriver } from '$lib/api';
import type { Driver } from '$lib/workbench';

export type Schemas = components['schemas'];
export type Capabilities = Schemas['MonitorCapabilities'];
export type Restriction = Schemas['MonitorCapability'];
export type MonitorRequest = Schemas['MonitorRequest'];
export type MonitorResult = Schemas['MonitorResult'];
export type MonitorRecord = Schemas['MonitorRecord'];
export type MonitorHint = Schemas['MonitorHint'];
export type Action = MonitorResult['action'];

/** Views of the monitor; binary-events is reached from the binary log list. */
export type View =
  'sample' | 'advisor' | 'analysis' | 'replication' | 'binary-logs' | 'profiling' | 'engines';
export const views: View[] = [
  'sample',
  'advisor',
  'analysis',
  'replication',
  'binary-logs',
  'profiling',
  'engines',
];
/** Views that may refresh automatically (cheap, repeatable reads). */
export const autoRefreshViews: ReadonlySet<View> = new Set(['sample', 'advisor', 'replication']);
export const AUTO_REFRESH_INTERVALS = [10, 30, 60];
export const pageSizes = [25, 50, 100, 200] as const;
export const SQL_MAX_BYTES = 16384;
export const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;

/** Restriction entry of the connected driver for one action; none means no restriction is announced. */
export function restrictionOf(
  caps: Capabilities,
  driver: Driver,
  action: Action,
): Restriction | undefined {
  const key = apiDriver(driver);
  return caps.drivers.find((entry) => entry.driver === key && entry.action === action);
}

/** Contract invariants beyond the schema; a violating answer is treated as invalid. */
export function consistent(
  result: MonitorResult,
  expected: { action: Action; driver: Driver; offset: number; limit: number },
): boolean {
  if (result.action !== expected.action) return false;
  if (result.driver !== apiDriver(expected.driver)) return false;
  if (result.offset !== expected.offset) return false;
  if (expected.limit > 0 && result.limit > expected.limit) return false;
  if (result.limit > 0 && result.records.length > result.limit) return false;
  return true;
}

/** Preferred column order per action; further present fields follow alphabetically. */
const preferred: Partial<Record<Action, string[]>> = {
  sample: [
    'version',
    'uptime',
    'questions',
    'connections',
    'threads_connected',
    'threads_running',
    'slow_queries',
    'aborted_connects',
    'bytes_received',
    'bytes_sent',
    'numbackends',
    'xact_commit',
    'xact_rollback',
    'blks_read',
    'blks_hit',
    'tup_returned',
    'tup_fetched',
    'deadlocks',
    'temp_files',
    'temp_bytes',
  ],
  analysis: ['digest', 'queryid', 'calls', 'total_seconds', 'total_exec_time', 'rows_sent', 'rows'],
  replication: [
    'role',
    'pid',
    'state',
    'sync_state',
    'replica_io_running',
    'slave_io_running',
    'replica_sql_running',
    'slave_sql_running',
    'seconds_behind_source',
    'seconds_behind_master',
  ],
  'binary-logs': ['log_name', 'file_size', 'encrypted'],
  'binary-events': ['log_name', 'pos', 'event_type', 'server_id', 'end_log_pos'],
  profiling: [
    'id',
    'type',
    'node_type',
    'plan_rows',
    'rows',
    'filtered',
    'startup_cost',
    'total_cost',
    'plan_width',
  ],
  engines: ['engine', 'support', 'transactions', 'xa', 'savepoints'],
};

export function columnsFor(records: readonly MonitorRecord[], action: Action): string[] {
  const present = new Set<string>();
  for (const record of records) for (const key of Object.keys(record)) present.add(key);
  const first = (preferred[action] ?? []).filter((key) => present.has(key));
  const rest = [...present].filter((key) => !first.includes(key)).sort();
  return [...first, ...rest];
}

/** Counters whose per-second rate is derived from two consecutive samples. */
export const counterFields = [
  'questions',
  'connections',
  'slow_queries',
  'aborted_connects',
  'bytes_received',
  'bytes_sent',
  'xact_commit',
  'xact_rollback',
  'blks_read',
  'blks_hit',
  'tup_returned',
  'tup_fetched',
  'deadlocks',
  'temp_files',
  'temp_bytes',
] as const;
export type CounterField = (typeof counterFields)[number];

export interface SampleRates {
  /** Seconds between the two samples. */
  seconds: number;
  rates: Partial<Record<CounterField, number>>;
}
export type RateOutcome =
  { kind: 'rates'; value: SampleRates } | { kind: 'reset' } | { kind: 'none' };

const integer = /^-?[0-9]+$/;
const asBig = (value: string | undefined): bigint | null =>
  value !== undefined && integer.test(value) ? BigInt(value) : null;

/**
 * Rates between two samples of the same connection. A counter that went down (server restart,
 * counter reset, statistics reset) invalidates the whole interval: no negative or guessed rates.
 */
export function computeRates(
  previous: { record: MonitorRecord; at: Date },
  current: { record: MonitorRecord; at: Date },
): RateOutcome {
  const seconds = (current.at.getTime() - previous.at.getTime()) / 1000;
  if (!(seconds > 0)) return { kind: 'none' };
  const before = asBig(previous.record.uptime?.split('.')[0]);
  const after = asBig(current.record.uptime?.split('.')[0]);
  if (before !== null && after !== null && after < before) return { kind: 'reset' };
  const rates: SampleRates['rates'] = {};
  for (const field of counterFields) {
    const a = asBig(previous.record[field]);
    const b = asBig(current.record[field]);
    if (a === null || b === null) continue;
    if (b < a) return { kind: 'reset' };
    rates[field] = Number(b - a) / seconds;
  }
  return Object.keys(rates).length
    ? { kind: 'rates', value: { seconds, rates } }
    : { kind: 'none' };
}

/** Keeps the newest `max` points. */
export const pushPoint = (points: readonly number[], value: number, max = 60): number[] =>
  [...points, value].slice(-max);
