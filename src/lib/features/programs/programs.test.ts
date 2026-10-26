// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import * as validators from '$lib/contract/v16/validators.js';
import { ApiError } from '$lib/api';
import { Operation } from './operation.svelte';
import { ProgramsClient } from './client';
import { bodyFits, driverOf, type Change } from './model';
import { plan, result } from './testing';
const base: Change = {
  connection: { driver: 'sqlite', database: 'fixture' },
  action: 'create',
  object: plan().object as Change['object'],
  input: { body: 'SELECT 42 AS value' },
};
const pending = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
function arrange() {
  const client = new ProgramsClient();
  const phases: string[] = [];
  const planner = vi.spyOn(client, 'plan').mockResolvedValue(plan());
  const execute = vi
    .spyOn(client, 'execute')
    .mockImplementation(async (_body, _token, dispatch) => {
      dispatch?.();
      return result();
    });
  const operation = new Operation({ token: () => 'token', client, onphase: (p) => phases.push(p) });
  return { client, planner, execute, operation, phases };
}
describe('program contract', () => {
  const fixtures = import.meta.glob('./fixtures/*.json', { eager: true, import: 'default' });
  for (const [path, fixture] of Object.entries(fixtures))
    it(path, () => {
      const name = path.split('/').at(-1)!.split('.')[0];
      const validate = (validators as Record<string, (value: unknown) => boolean>)[name];
      expect(validate, name).toBeTypeOf('function');
      expect(validate(fixture)).toBe(!path.includes('.invalid.'));
    });
  it('pins exact contract bytes', () => {
    const raw = readFileSync('src/lib/contract/v16/api-v0.16.0.json');
    const provenance = JSON.parse(readFileSync('src/lib/contract/v16/provenance.json', 'utf8'));
    expect(createHash('sha256').update(raw).digest('hex')).toBe(provenance.sha256);
  });
  it('checks UTF-8 bytes and maps driver variants', () => {
    expect(bodyFits('é'.repeat(131072))).toBe(true);
    expect(bodyFits('é'.repeat(131073))).toBe(false);
    expect(driverOf('mariadb')).toBe('mysql');
    expect(driverOf('postgresql')).toBe('postgres');
  });
});
describe('program operation', () => {
  it('requires plan and confirmation, snapshots input, sends once and locks after completion', async () => {
    const { operation, execute, phases } = arrange();
    await operation.execute(true, '');
    expect(execute).not.toHaveBeenCalled();
    const change = structuredClone(base);
    await operation.loadPlan(change);
    change.input!.body = 'changed';
    await operation.execute(false, '');
    expect(execute).not.toHaveBeenCalled();
    await Promise.all([operation.execute(true, ''), operation.execute(true, '')]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0].input?.body).toBe('SELECT 42 AS value');
    expect(execute.mock.calls[0][0].expected_plan_sha256).toBe(plan().plan_sha256);
    expect(phases).toEqual(['sending', 'settled']);
    expect(operation.phase).toBe('finished');
    await operation.execute(true, '');
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it.each(['drop', 'replace'] as const)(
    'requires exact typed catalog name for %s',
    async (action) => {
      const { operation, planner, execute } = arrange();
      planner.mockResolvedValue(plan({ action, destructive: true }));
      await operation.loadPlan({
        ...base,
        action,
        ...(action === 'drop' ? { input: undefined } : {}),
      });
      await operation.execute(true, 'wrong');
      expect(execute).not.toHaveBeenCalled();
      await operation.execute(true, plan().object.name);
      expect(execute).toHaveBeenCalledTimes(1);
    },
  );
  it('discards late plans after reset', async () => {
    const { operation, planner } = arrange();
    const p = pending<ReturnType<typeof plan>>();
    planner.mockReturnValue(p.promise);
    const run = operation.loadPlan(base);
    operation.reset();
    p.resolve(plan());
    await run;
    expect(operation.plan).toBeNull();
    expect(operation.phase).toBe('idle');
  });
  it('settles dispatched stale responses once without publishing them', async () => {
    const { operation, execute, phases } = arrange();
    const p = pending<ReturnType<typeof result>>();
    execute.mockImplementation((_body, _token, dispatch) => {
      dispatch?.();
      return p.promise;
    });
    await operation.loadPlan(base);
    const run = operation.execute(true, '');
    operation.reset();
    p.resolve(result());
    await run;
    expect(phases).toEqual(['sending', 'settled']);
    expect(operation.result).toBeNull();
  });
  it.each(['rejected', 'outcome_unknown'] as const)(
    'locks after %s and never retries',
    async (outcome) => {
      const { operation, execute, phases } = arrange();
      execute.mockImplementation(async (_body, _token, dispatch) => {
        dispatch?.();
        return result({ outcome });
      });
      await operation.loadPlan(base);
      await operation.execute(true, '');
      await operation.execute(true, '');
      expect(execute).toHaveBeenCalledTimes(1);
      expect(operation.phase).toBe('finished');
      expect(phases.at(-1)).toBe(outcome === 'outcome_unknown' ? 'unknown' : 'settled');
    },
  );
  it('reports unknown transport outcomes without retry', async () => {
    const { operation, execute, phases } = arrange();
    execute.mockImplementation(async (_body, _token, dispatch) => {
      dispatch?.();
      throw new ApiError('outcome_unknown', 'raw');
    });
    await operation.loadPlan(base);
    await operation.execute(true, '');
    expect(operation.unknown).toBe(true);
    expect(operation.error).not.toContain('raw');
    expect(phases).toEqual(['sending', 'unknown']);
  });
});
