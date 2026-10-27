// SPDX-License-Identifier: AGPL-3.0-only
import type { components } from '$lib/contract/v17/api-types';
import { apiDriver } from '$lib/api';
import type { Driver } from '$lib/workbench';

export type Schemas = components['schemas'];
export type Capabilities = Schemas['ServerAdminCapabilities'];
export type ReadRequest = Schemas['ServerAdminReadRequest'];
export type ReadResult = Schemas['ServerAdminReadResult'];
export type AdminValue = Schemas['ServerAdminValue'];
export type AdminProcess = Schemas['ServerAdminProcess'];
export type Kind = ReadResult['kind'];
export type Scope = 'SESSION' | 'GLOBAL';
export type Support = Schemas['ObjectOpCapability'];

export const kinds: Kind[] = ['status', 'variables', 'processes'];
export const FILTER_MAX_BYTES = 128;
export const pageSizes = [50, 100, 200] as const;
export const AUTO_REFRESH_INTERVALS = [10, 30, 60];

export const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;

/** Capability entry of the connected driver for one function. */
export function supportOf(caps: Capabilities, driver: Driver, kind: Kind): Support {
  return caps.drivers[apiDriver(driver)][kind];
}

/** GLOBAL variables exist for MySQL/MariaDB only; PostgreSQL rejects them with 422. */
export const scopesFor = (driver: Driver): Scope[] =>
  driver === 'postgresql' ? ['SESSION'] : ['SESSION', 'GLOBAL'];

/** Value shown for one status/variable row; masked rows never carry a value. */
export type ShownValue = { kind: 'masked' } | { kind: 'unknown' } | { kind: 'value'; text: string };
export function shownValue(row: AdminValue): ShownValue {
  if (row.masked) return { kind: 'masked' };
  if (row.value === null) return { kind: 'unknown' };
  return { kind: 'value', text: row.value };
}

/** Contract invariants beyond the schema; a violating answer is treated as invalid. */
export function consistent(
  result: ReadResult,
  expected: { kind: Kind; driver: Driver; offset: number; limit: number },
): boolean {
  if (result.kind !== expected.kind) return false;
  if (result.driver !== apiDriver(expected.driver)) return false;
  if (result.offset !== expected.offset) return false;
  if (expected.limit > 0 && result.limit > expected.limit) return false;
  if (expected.kind === 'processes' && result.values.length > 0) return false;
  if (expected.kind !== 'processes' && result.processes.length > 0) return false;
  if (result.values.length > result.limit || result.processes.length > result.limit) return false;
  // masked=true requires value=null: never display a value the server marked as masked.
  return result.values.every((row) => !row.masked || row.value === null);
}

/** "2026-10-27T09:15:00.123456Z" to a Date, or null when unparsable. */
export function parseTime(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Seconds as "1 h 02 min 03 s"; seconds are integers up to 2^53-1. */
export function formatSeconds(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days} d`);
  if (days || hours) parts.push(`${hours} h`);
  if (days || hours || minutes) parts.push(`${minutes} min`);
  parts.push(`${rest} s`);
  return parts.join(' ');
}
