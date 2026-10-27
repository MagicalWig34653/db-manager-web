// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic test data for the server administration views (no real server data).
import type { Capabilities, ReadResult, Support } from './model';

const supported: Support = { support: 'supported' };
const driver = (over: Partial<Record<'status' | 'variables' | 'processes', Support>> = {}) => ({
  status: supported,
  variables: supported,
  processes: supported,
  ...over,
});

export function capabilities(
  over: {
    sqlite?: ReturnType<typeof driver>;
    mysql?: ReturnType<typeof driver>;
    postgres?: ReturnType<typeof driver>;
  } = {},
): Capabilities {
  return {
    contract_version: '0.17.0',
    features: ['status', 'variables', 'processes'],
    drivers: {
      sqlite:
        over.sqlite ??
        driver({
          variables: { support: 'unsupported', reason: 'SQLite kennt keine Serververwaltung.' },
          processes: { support: 'unsupported', reason: 'SQLite kennt keine Prozessliste.' },
          status: { support: 'limited', reason: 'Nur die SQLite-Version.' },
        }),
      mysql: over.mysql ?? driver(),
      postgres: over.postgres ?? driver(),
    },
    max_limit: 200,
    default_limit: 100,
    max_offset: 10000,
    max_timeout_ms: 10000,
    default_timeout_ms: 5000,
    max_request_bytes: 1048576,
  };
}

export function result(
  kind: ReadResult['kind'],
  over: Partial<ReadResult> = {},
  driverName: ReadResult['driver'] = 'mysql',
): ReadResult {
  return {
    driver: driverName,
    kind,
    scope: kind === 'variables' ? 'SESSION' : '',
    sampled_at: '2026-10-27T09:15:00Z',
    values: [],
    processes: [],
    limit: 100,
    offset: 0,
    has_more: false,
    ...over,
  };
}

export const statusRows = [
  { name: 'Connections', value: '1234567890123456789', masked: false },
  { name: 'Threads_connected', value: '4', masked: false },
  { name: 'Ssl_session_cache_mode', value: null, masked: true },
];
export const hostileName = '<img src=x onerror=alert(1)>_status';
