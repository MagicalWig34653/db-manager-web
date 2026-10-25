// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as validators from '$lib/contract/v8/validators.js';
import { Operation } from './operation.svelte';
import { opErrorMessage } from './client';
import { fx, respond, scripted } from './testing';

const connection = { driver: 'sqlite' as const, database: 'synthetic' };
const errorBody = (code: string) => ({ error: { code, message: 'x' } });

describe('vendored API 0.8 contract', () => {
  it('is the exact released byte copy with provenance', () => {
    const provenance = JSON.parse(readFileSync('src/lib/contract/v8/provenance.json', 'utf8'));
    const hash = createHash('sha256')
      .update(readFileSync('src/lib/contract/v8/api-v0.8.0.json'))
      .digest('hex');
    expect(hash).toBe('74aa39ed06311f2c45afc274a2412a0ac30912e3a5683ec96b812fd473a28264');
    expect(provenance.sha256).toBe(hash);
  });
  it('accepts every valid fixture and rejects every invalid one', () => {
    const names = readdirSync('src/lib/features/object-ops/fixtures').filter((n) =>
      n.endsWith('.json'),
    );
    expect(names.length).toBe(80);
    for (const file of names) {
      const [schema, ...rest] = file.replace(/\.json$/, '').split('.');
      const validate = (validators as unknown as Record<string, (v: unknown) => boolean>)[schema];
      expect(validate, `${file}: validator`).toBeTypeOf('function');
      const invalid = rest.includes('invalid') || rest[rest.length - 1]?.endsWith('invalid');
      expect(validate(fx(file.replace(/\.json$/, ''))), file).toBe(!invalid);
    }
  });
});

describe('ObjectOpsClient', () => {
  it('validates plans and refuses a plan for another action', async () => {
    const { client } = scripted(() => respond(fx('ObjectOpPlan.sqlite-table-drop')));
    await expect(client.plan('table_drop', { connection }, 'tok')).resolves.toMatchObject({
      action: 'table_drop',
    });
    await expect(client.plan('table_rename', { connection }, 'tok')).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
  it('sends one execute request and reports lost answers as outcome_unknown', async () => {
    const cases: (() => Response | Promise<Response>)[] = [
      () => respond(errorBody('outcome_unknown'), 503),
      () => {
        throw new TypeError('network');
      },
      () => new Response('<html>', { status: 502, headers: { 'Content-Type': 'text/html' } }),
      () => respond({ outcome: 'completed' }),
    ];
    for (const handler of cases) {
      const { client, calls } = scripted(handler);
      const failure = await client.execute('table_drop', { connection }, 'tok').catch((e) => e);
      expect(failure.code).toBe('outcome_unknown');
      expect(calls).toHaveLength(1);
    }
  });
  it('keeps definite errors definite and shows German code-based texts', async () => {
    const { client } = scripted(() => respond(errorBody('plan_mismatch'), 409));
    const failure = await client.execute('table_drop', { connection }, 'tok').catch((e) => e);
    expect(failure.code).toBe('plan_mismatch');
    expect(opErrorMessage(failure)).toContain('veraltet');
    expect(opErrorMessage({ code: 'whatever' })).toContain('Code');
  });
  it('maps a missing v8 to unsupported_feature', async () => {
    const { client } = scripted(() => respond(errorBody('x'), 404));
    await expect(client.capabilities('tok')).rejects.toMatchObject({ code: 'unsupported_feature' });
  });
});

function operation(
  handler: Parameters<typeof scripted>[0],
  action: 'table_drop' | 'database_drop' | 'table_truncate' = 'table_drop',
) {
  const { client, calls } = scripted(handler);
  const phases: string[] = [];
  const finished = vi.fn();
  const op = new Operation({
    action,
    client,
    context: () => ({ connection, token: 'tok' }),
    onphase: (p) => phases.push(p),
    onfinished: finished,
  });
  return { op, calls, phases, finished };
}
const planOrResult = (path: string) =>
  path.endsWith('/plan')
    ? respond(fx('ObjectOpPlan.sqlite-table-drop'))
    : respond(fx('ObjectOpResult.sqlite-table-drop-completed'));

describe('Operation state machine', () => {
  it('sends no execute request before a plan exists and none before confirmation input', async () => {
    const { op, calls } = operation(planOrResult);
    await op.execute('parent');
    expect(calls).toHaveLength(0);
    await op.loadPlan({ table: { name: 'parent' } });
    expect(op.phase).toBe('planned');
    expect(calls.map((c) => c.path)).toEqual(['/api/v8/tables/drop/plan']);
  });
  it('executes with the plan hash and the typed target name from the plan, exactly once', async () => {
    const { op, calls, phases } = operation(planOrResult);
    await op.loadPlan({ table: { name: 'parent' } });
    const first = op.execute('parent');
    void op.execute('parent');
    void op.execute('parent');
    await first;
    const executes = calls.filter((c) => !c.path.endsWith('/plan'));
    expect(executes).toHaveLength(1);
    expect(executes[0].body).toMatchObject({
      connection,
      table: { name: 'parent' },
      confirm: { action: 'table_drop', target_name: 'parent' },
      expected_plan_sha256: '8354c75f713ba9b66eac16fcc1f78aa9cd29b53802ad43a523cca31d48e5a644',
    });
    expect(executes[0].body?.confirm).not.toHaveProperty('acknowledge_current_database');
    expect(phases).toEqual(['sending', 'settled']);
  });
  it('locks the action after completed: a second execution needs a new plan', async () => {
    const { op, calls } = operation(planOrResult);
    await op.loadPlan({ table: { name: 'parent' } });
    await op.execute('parent');
    expect(op.phase).toBe('finished');
    expect(op.canExecute).toBe(false);
    await op.execute('parent');
    expect(calls.filter((c) => !c.path.endsWith('/plan'))).toHaveLength(1);
    await op.loadPlan({ table: { name: 'parent' } });
    expect(op.canExecute).toBe(true);
    expect(op.result).toBeNull();
  });
  it('locks after outcome_unknown without retry and reports the unknown phase', async () => {
    const { op, calls, phases, finished } = operation((path) =>
      path.endsWith('/plan')
        ? respond(fx('ObjectOpPlan.sqlite-table-drop'))
        : respond(errorBody('outcome_unknown'), 503),
    );
    await op.loadPlan({ table: { name: 'parent' } });
    await op.execute('parent');
    expect(op.unknown).toBe(true);
    expect(op.canExecute).toBe(false);
    expect(phases).toEqual(['sending', 'unknown']);
    expect(finished).toHaveBeenCalledWith(null, true);
    expect(calls.filter((c) => !c.path.endsWith('/plan'))).toHaveLength(1);
  });
  it('locks after a definite error such as plan_mismatch and after a rejected result', async () => {
    const mismatch = operation((path) =>
      path.endsWith('/plan')
        ? respond(fx('ObjectOpPlan.sqlite-table-drop'))
        : respond(errorBody('plan_mismatch'), 409),
    );
    await mismatch.op.loadPlan({ table: { name: 'parent' } });
    await mismatch.op.execute('parent');
    expect(mismatch.op.errorCode).toBe('plan_mismatch');
    expect(mismatch.op.unknown).toBe(false);
    expect(mismatch.op.canExecute).toBe(false);
    const rejected = operation((path) =>
      path.endsWith('/plan')
        ? respond(fx('ObjectOpPlan.sqlite-table-drop'))
        : respond(fx('ObjectOpResult.sqlite-table-drop-rejected')),
    );
    await rejected.op.loadPlan({ table: { name: 'parent' } });
    await rejected.op.execute('parent');
    expect(rejected.op.result?.outcome).toBe('rejected');
    expect(rejected.op.canExecute).toBe(false);
  });
  it('acknowledges the current database only when the plan asks for it and the user did', async () => {
    const plan = {
      ...fx('ObjectOpPlan.mysql-table-drop'),
      action: 'database_drop',
      confirmation: {
        action: 'database_drop',
        destructive: true,
        target_name: 'shop',
        current_database: true,
      },
    };
    const run = async (ack: boolean) => {
      const { op, calls } = operation(
        (path) =>
          path.endsWith('/plan')
            ? respond(plan)
            : respond({
                ...fx('ObjectOpResult.sqlite-table-drop-completed'),
                action: 'database_drop',
              }),
        'database_drop',
      );
      await op.loadPlan({ database: 'shop' });
      op.acknowledgeCurrent = ack;
      await op.execute('shop');
      return calls[calls.length - 1].body?.confirm as Record<string, unknown>;
    };
    expect(await run(true)).toEqual({
      action: 'database_drop',
      target_name: 'shop',
      acknowledge_current_database: true,
    });
    expect(await run(false)).toEqual({ action: 'database_drop', target_name: 'shop' });
  });
  it('omits target_name for non-destructive plans', async () => {
    const plan = fx('ObjectOpPlan.mysql-database-create');
    const { op, calls } = operation((path) =>
      path.endsWith('/plan')
        ? respond({
            ...plan,
            action: 'table_drop',
            confirmation: { ...plan.confirmation, action: 'table_drop' },
          })
        : respond(fx('ObjectOpResult.sqlite-table-drop-completed')),
    );
    await op.loadPlan({});
    await op.execute();
    expect(calls[calls.length - 1].body?.confirm).toEqual({ action: 'table_drop' });
  });
  it('discards a late answer after reset (token or connection change)', async () => {
    let release: (r: Response) => void = () => {};
    const { op, finished, phases } = operation((path) =>
      path.endsWith('/plan')
        ? respond(fx('ObjectOpPlan.sqlite-table-drop'))
        : new Promise<Response>((r) => (release = r)),
    );
    await op.loadPlan({ table: { name: 'parent' } });
    const running = op.execute('parent');
    op.reset();
    release(respond(fx('ObjectOpResult.sqlite-table-drop-completed')));
    await running;
    expect(op.phase).toBe('idle');
    expect(op.result).toBeNull();
    expect(finished).not.toHaveBeenCalled();
    expect(phases).toEqual(['sending']);
  });
  it('discards a late plan after reset', async () => {
    let release: (r: Response) => void = () => {};
    const { op } = operation(() => new Promise<Response>((r) => (release = r)));
    const loading = op.loadPlan({ table: { name: 'parent' } });
    op.reset();
    release(respond(fx('ObjectOpPlan.sqlite-table-drop')));
    await loading;
    expect(op.plan).toBeNull();
    expect(op.phase).toBe('idle');
  });
});
