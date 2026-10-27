// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { formatDecimal } from '$lib/format';
import { setLocale } from '$lib/i18n';
import {
  columnsFor,
  computeRates,
  consistent,
  pushPoint,
  restrictionOf,
  type MonitorRecord,
} from './model';
import { capabilities, result } from './testing';

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 27, 9, 0, seconds));
const sample = (over: MonitorRecord): { record: MonitorRecord; at: Date } => ({
  record: { uptime: '100', questions: '1000', bytes_sent: '5000', ...over },
  at: at(0),
});

describe('computeRates', () => {
  it('derives per-second rates with exact integer deltas', () => {
    const outcome = computeRates(sample({}), {
      record: { uptime: '110', questions: '1500', bytes_sent: '6000' },
      at: at(10),
    });
    expect(outcome).toEqual({
      kind: 'rates',
      value: { seconds: 10, rates: { questions: 50, bytes_sent: 100 } },
    });
  });
  it('keeps precision beyond 2^53 for the delta', () => {
    const outcome = computeRates(
      { record: { questions: '9007199254740993' }, at: at(0) },
      { record: { questions: '9007199254741003' }, at: at(10) },
    );
    expect(outcome).toMatchObject({ kind: 'rates', value: { rates: { questions: 1 } } });
  });
  it('detects restarts and counter resets instead of showing negative rates', () => {
    expect(
      computeRates(sample({}), { record: { uptime: '5', questions: '9' }, at: at(10) }),
    ).toEqual({ kind: 'reset' });
    expect(
      computeRates(sample({}), { record: { uptime: '200', questions: '900' }, at: at(10) }),
    ).toEqual({ kind: 'reset' });
  });
  it('yields nothing without time progress or comparable counters', () => {
    expect(computeRates(sample({}), { record: sample({}).record, at: at(0) })).toEqual({
      kind: 'none',
    });
    expect(
      computeRates(
        { record: { version: '3.1' }, at: at(0) },
        { record: { version: '3.1' }, at: at(5) },
      ),
    ).toEqual({ kind: 'none' });
  });
});

describe('helpers', () => {
  it('orders columns by preference, then alphabetically', () => {
    expect(
      columnsFor(
        [{ rows: '1', digest: 'abcdef0123456789', calls: '2', zeta: 'x' } as MonitorRecord],
        'analysis',
      ),
    ).toEqual(['digest', 'calls', 'rows', 'zeta']);
  });
  it('finds the restriction of the connected driver', () => {
    const caps = capabilities();
    expect(restrictionOf(caps, 'sqlite', 'replication')?.support).toBe('unsupported');
    expect(restrictionOf(caps, 'mysql', 'replication')?.support).toBe('limited');
  });
  it('rejects answers for another action, driver or offset', () => {
    const expected = { action: 'sample' as const, driver: 'mysql' as const, offset: 0, limit: 0 };
    expect(consistent(result('sample'), expected)).toBe(true);
    expect(consistent(result('engines'), expected)).toBe(false);
    expect(consistent(result('sample', [], { driver: 'postgres' }), expected)).toBe(false);
    expect(consistent(result('sample', [], { offset: 50 }), expected)).toBe(false);
  });
  it('keeps a bounded history', () => {
    let points: number[] = [];
    for (let i = 0; i < 100; i++) points = pushPoint(points, i);
    expect(points).toHaveLength(60);
    expect(points.at(-1)).toBe(99);
  });
  it('groups decimal strings without losing digits', () => {
    setLocale('en');
    expect(formatDecimal('12345678901234567890')).toBe('12,345,678,901,234,567,890');
    expect(formatDecimal('-1234.50')).toBe('-1,234.50');
    expect(formatDecimal('not a number')).toBe('not a number');
    setLocale('de');
    expect(formatDecimal('1234.5')).toBe('1.234,5');
  });
});
