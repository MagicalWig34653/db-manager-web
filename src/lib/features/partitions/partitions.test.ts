// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api';
import provenance21 from '$lib/contract/v21/provenance.json';
import provenance22 from '$lib/contract/v22/provenance.json';
import * as validators from '$lib/contract/v22/validators.js';
import { Session } from '$lib/shell/session.svelte';
import type { ConnectionDraft } from '$lib/workbench';
import { partitionsClient } from './client';
import { boundShape, wireAction } from './model';
import PartitionsTab from './PartitionsTab.svelte';
import PrefixTab from './PrefixTab.svelte';
import StructureCard from './StructureCard.svelte';
import { fx, respond, scripted } from './testing';
import Host from './testing/Host.svelte';

const sqlite: ConnectionDraft = {
  name: '',
  driver: 'sqlite',
  database: 'synthetic',
  host: '',
  port: 0,
  username: '',
  password: '',
};
const mysql: ConnectionDraft = {
  ...sqlite,
  driver: 'mysql',
  database: 'probe',
  host: 'h',
  port: 3306,
  username: 'u',
};
const postgres: ConnectionDraft = { ...mysql, driver: 'postgresql', database: 'p' };

describe('vendored contracts', () => {
  it('v21 and v22 are byte-identical to the pinned backend files', () => {
    for (const [major, pin] of [
      [21, provenance21],
      [22, provenance22],
    ] as const) {
      const bytes = readFileSync(`src/lib/contract/v${major}/api-v0.${major}.0.json`);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(pin.sha256);
      expect(pin.source_commit).toBe('d9463ba4b07cf45d8a90ba95d17951d521c5f01e');
    }
  });
  it('every recorded backend answer validates against the slim v22 validators', () => {
    const table: [string, (v: unknown) => boolean][] = [
      ['PartitionsCapabilities.real', validators.PartitionsCapabilities],
      ['PartitionsResult.real-mysql', validators.PartitionsResult],
      ['PartitionsResult.real-postgres', validators.PartitionsResult],
      ['PrefixResult.real-sqlite', validators.PrefixResult],
      ['PrefixStructureResult.real-mysql', validators.PrefixStructureResult],
      ['PrefixStructureResult.real-postgres', validators.PrefixStructureResult],
      ['PrefixStructureResult.real-sqlite', validators.PrefixStructureResult],
      ['StructurePlan.real-mysql', validators.StructurePlan],
      ['StructurePlan.real-postgres', validators.StructurePlan],
      ['StructurePlan.real-prefix-sqlite', validators.StructurePlan],
      ['StructureResult.real-mysql', validators.StructureResult],
      ['StructureResult.real-postgres', validators.StructureResult],
    ];
    for (const [name, validate] of table) expect(validate(fx(name)), name).toBe(true);
  });
  it('rejects unknown fields and an unknown prefix status', () => {
    const bad = fx('PrefixStructureResult.real-mysql');
    bad.tables[0].status = 'maybe';
    expect(validators.PrefixStructureResult(bad)).toBe(false);
    expect(validators.StructureResult({ ...fx('StructureResult.real-mysql'), extra: 1 })).toBe(
      false,
    );
  });
  it('knows which bound fields a driver and method need', () => {
    expect(boundShape('mysql', 'RANGE')).toBe('less_than');
    expect(boundShape('postgres', 'RANGE (id)')).toBe('from_to');
    expect(boundShape('mysql', 'LIST')).toBe('values');
    expect(boundShape('postgres', 'HASH')).toBe('hash');
    expect(boundShape('mysql', 'HASH')).toBeNull();
    expect(wireAction('prefix', 'replace')).toBe('prefix_replace');
  });
});

describe('PartitionsClient', () => {
  it('plans and executes through the v22 routes and sends nothing invalid', async () => {
    const { calls, client } = scripted((path) =>
      path.endsWith('/plan')
        ? respond(fx('StructurePlan.real-mysql'))
        : respond(fx('StructureResult.real-mysql')),
    );
    const base = {
      connection: {
        driver: 'mysql',
        database: 'probe',
        host: 'h',
        port: 3306,
        username: 'u',
        password: 'p',
        tls_mode: 'verify-full',
      },
      table: { name: 'p29_partitioned' },
      action: 'add',
      definitions: [{ name: 'p29_p1', values: ['3'] }],
    };
    const plan = await client.plan('partition', 'add', base, 'tok');
    expect(plan.action).toBe('partition_add');
    const result = await client.execute(
      'partition',
      'add',
      {
        ...base,
        confirm: { action: 'partition_add', target_name: 'p29_partitioned' },
        expected_plan_sha256: plan.plan_sha256,
      },
      'tok',
    );
    expect(result.outcome).toBe('completed');
    expect(calls.map((c) => c.path)).toEqual([
      '/api/v22/tables/partitions/plan',
      '/api/v22/tables/partitions/execute',
    ]);
    await expect(
      client.plan('partition', 'add', { ...base, method: 'SQL' }, 'tok'),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    expect(calls).toHaveLength(2);
  });
  it('turns a cut connection after dispatch into outcome_unknown and does not retry', async () => {
    const { calls, client } = scripted(() => {
      throw new TypeError('network');
    });
    const body = {
      connection: { driver: 'sqlite', database: 'x' },
      prefix: 'pp_',
      action: 'drop',
      confirm: { action: 'prefix_drop', target_name: 'pp_' },
      expected_plan_sha256: 'a'.repeat(64),
    };
    await expect(client.execute('prefix', 'drop', body, 'tok')).rejects.toMatchObject({
      code: 'outcome_unknown',
    });
    expect(calls).toHaveLength(1);
  });
  it('refuses a plan or result of a different action', async () => {
    const { client } = scripted(() => respond(fx('StructurePlan.real-mysql')));
    await expect(
      client.plan(
        'partition',
        'drop',
        {
          connection: { driver: 'sqlite', database: 'x' },
          table: { name: 't' },
          action: 'drop',
          partitions: ['p'],
        },
        'tok',
      ),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });
});

describe('StructureCard', () => {
  const plan = fx('StructurePlan.real-prefix-sqlite');
  let planSpy: ReturnType<typeof vi.spyOn>;
  let executeSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    planSpy = vi.spyOn(partitionsClient, 'plan').mockResolvedValue(plan as never);
    executeSpy = vi
      .spyOn(partitionsClient, 'execute')
      .mockResolvedValue(fx('PrefixStructureResult.real-sqlite') as never);
  });
  afterEach(() => vi.restoreAllMocks());
  const card = (patch: Record<string, unknown> = {}) =>
    render(StructureCard, {
      kind: 'prefix',
      action: 'drop',
      title: 'Alle Tabellen mit Präfix löschen',
      testId: 'prefix-drop',
      connection: sqlite,
      token: 'tok',
      fields: () => ({ prefix: 'pp_' }),
      ...patch,
    });
  const showPlan = () => screen.findByRole('button', { name: 'Plan anzeigen' });
  async function confirmTyped(name: string) {
    await fireEvent.click(await screen.findByRole('button', { name: 'Ausführen' }));
    const box = await screen.findByTestId('confirm-destructive');
    const input = within(box).getByRole('textbox');
    await fireEvent.input(input, { target: { value: name } });
    return within(box).getByRole('button', { name: 'Ausführen' });
  }

  it('shows the exact statements and needs the typed prefix; a double click sends one request', async () => {
    card();
    await fireEvent.click(await showPlan());
    expect(await screen.findByTestId('plan')).toHaveTextContent('DROP TABLE "pp_a"');
    expect(screen.getByTestId('affected')).toHaveTextContent('Tabelle pp_a');
    expect(executeSpy).not.toHaveBeenCalled();
    const run = await confirmTyped('PP_');
    expect(run).toBeDisabled();
    await fireEvent.input(within(screen.getByTestId('confirm-destructive')).getByRole('textbox'), {
      target: { value: 'pp_' },
    });
    await fireEvent.click(run);
    await fireEvent.click(run);
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect((executeSpy.mock.calls[0][3] as unknown as string) ?? 'tok').toBeDefined();
    const body = executeSpy.mock.calls[0][2] as Record<string, unknown>;
    expect(body.confirm).toEqual({ action: 'prefix_drop', target_name: 'pp_' });
    expect(body.expected_plan_sha256).toBe(plan.plan_sha256);
  });
  it('shows a rejected batch with every table as not applied', async () => {
    card();
    await fireEvent.click(await showPlan());
    await (await confirmTyped('pp_')).click();
    const result = await screen.findByTestId('result');
    expect(result).toHaveAttribute('data-outcome', 'rejected');
    const rows = within(screen.getByTestId('table-results')).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveAttribute('data-status', 'not_applied');
    expect(result).toHaveTextContent('nichts dauerhaft geändert');
  });
  it('shows applied / unknown per table after a partial MySQL batch and offers no retry', async () => {
    executeSpy.mockResolvedValue(fx('PrefixStructureResult.real-mysql') as never);
    card();
    await fireEvent.click(await showPlan());
    await (await confirmTyped('pp_')).click();
    const result = await screen.findByTestId('result');
    expect(result).toHaveAttribute('data-outcome', 'outcome_unknown');
    expect(screen.getByTestId('unknown-hint')).toHaveTextContent('Ausgang ist unbekannt');
    const rows = within(screen.getByTestId('table-results')).getAllByRole('row');
    expect(rows[1]).toHaveAttribute('data-status', 'applied');
    expect(rows[2]).toHaveAttribute('data-status', 'unknown');
    expect(screen.queryByRole('button', { name: /Ausführen|Wiederholen|erneut/i })).toBeNull();
    // A new run needs a freshly loaded plan.
    await fireEvent.click(screen.getByRole('button', { name: 'Neuer Plan' }));
    expect(planSpy).toHaveBeenCalledTimes(1);
  });
  it('reports a cut connection as unknown without retry', async () => {
    executeSpy.mockRejectedValue(new ApiError('outcome_unknown', 'x'));
    card();
    await fireEvent.click(await showPlan());
    await (await confirmTyped('pp_')).click();
    expect(await screen.findByTestId('op-unknown')).toHaveTextContent('Ausgang ist unbekannt');
    expect(executeSpy).toHaveBeenCalledTimes(1);
  });
  it('non-destructive plans need the confirmation checkbox instead of a typed name', async () => {
    planSpy.mockResolvedValue({
      ...plan,
      action: 'prefix_copy',
      confirmation: { ...plan.confirmation, action: 'prefix_copy', destructive: false },
    } as never);
    card({ action: 'copy', testId: 'prefix-copy' });
    await fireEvent.click(await showPlan());
    const run = await screen.findByRole('button', { name: 'Ausführen' });
    expect(run).toBeDisabled();
    await fireEvent.click(screen.getByRole('checkbox'));
    await fireEvent.click(run);
    expect((executeSpy.mock.calls[0][2] as { confirm: unknown }).confirm).toEqual({
      action: 'prefix_copy',
    });
  });
  it('renders hostile names as text, never as markup', async () => {
    const hostile = '<img src=x onerror=alert(1)>"; DROP TABLE x;--';
    planSpy.mockResolvedValue({
      ...plan,
      statements: [`DROP TABLE "${hostile}"`],
      affected_objects: [`table:${hostile}`],
      confirmation: { ...plan.confirmation, target_name: hostile },
    } as never);
    const view = card();
    await fireEvent.click(await showPlan());
    await screen.findByTestId('plan');
    expect(view.container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('affected')).toHaveTextContent(hostile);
    expect(document.body.querySelector('img')).toBeNull();
  });
  it('discards a plan answer after a token change', async () => {
    let release: (v: unknown) => void = () => {};
    planSpy.mockReturnValue(new Promise((r) => (release = r)) as never);
    const view = card();
    await fireEvent.click(await showPlan());
    await view.rerender({ token: 'other' });
    release(plan);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Plan anzeigen' })).toBeEnabled(),
    );
    expect(screen.queryByTestId('plan')).toBeNull();
  });
  it('reports write phases to the shell and blocks while another write is in flight', async () => {
    const phases: string[] = [];
    executeSpy.mockImplementation((async (
      _k: unknown,
      _a: unknown,
      _b: unknown,
      _t: unknown,
      dispatch?: () => void,
    ) => {
      dispatch?.();
      return fx('PrefixStructureResult.real-sqlite');
    }) as never);
    const hooks = { onConnected: () => {}, onCatalogSettled: () => {}, onCleared: () => {} };
    const session = new Session(hooks);
    render(Host, {
      session,
      kind: 'prefix',
      action: 'drop',
      title: 'x',
      testId: 'prefix-drop',
      connection: sqlite,
      token: 'tok',
      fields: () => ({ prefix: 'pp_' }),
      onwritephase: (p: string) => {
        phases.push(p);
      },
    });
    await fireEvent.click(await showPlan());
    const run = await screen.findByRole('button', { name: 'Ausführen' });
    session.writeCount = 1;
    await waitFor(() => expect(run).toBeDisabled());
    session.writeCount = 0;
    await waitFor(() => expect(run).toBeEnabled());
    await fireEvent.click(run);
    const box = await screen.findByTestId('confirm-destructive');
    await fireEvent.input(within(box).getByRole('textbox'), { target: { value: 'pp_' } });
    await fireEvent.click(within(box).getByRole('button', { name: 'Ausführen' }));
    await screen.findByTestId('result');
    expect(phases).toEqual(['sending', 'settled']);
  });
});

describe('tabs', () => {
  const props = (patch: Record<string, unknown> = {}) => ({
    connection: sqlite,
    token: 'tok',
    tab: 'x',
    onsql: () => {},
    onwritephase: () => {},
    ...patch,
  });
  const capabilities = fx('PartitionsCapabilities.real');
  afterEach(() => vi.restoreAllMocks());

  it('SQLite: partitions are clearly not supported, no form and no request besides the capabilities', async () => {
    vi.spyOn(partitionsClient, 'capabilities').mockResolvedValue(capabilities);
    const list = vi.spyOn(partitionsClient, 'listPartitions');
    render(PartitionsTab, props({ object: { name: 'orders', schema: 'main', type: 'table' } }));
    expect(await screen.findByTestId('partitions-unsupported')).toHaveTextContent(
      'nicht unterstützt',
    );
    expect(screen.queryByTestId('partition-action')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Plan anzeigen' })).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });
  it('MySQL: lists the partitions, hides unsupported actions behind their reason, plans an add', async () => {
    vi.spyOn(partitionsClient, 'capabilities').mockResolvedValue(capabilities);
    vi.spyOn(partitionsClient, 'listPartitions').mockResolvedValue(
      fx('PartitionsResult.real-mysql'),
    );
    const plan = vi
      .spyOn(partitionsClient, 'plan')
      .mockResolvedValue(fx('StructurePlan.real-mysql') as never);
    render(
      PartitionsTab,
      props({
        connection: mysql,
        object: { name: 'p29_partitioned', schema: 'probe', type: 'table' },
      }),
    );
    expect(await screen.findByTestId('list-method')).toHaveTextContent('RANGE');
    expect(screen.getByTestId('partition-list')).toHaveTextContent('p29_p0');
    const select = screen.getByTestId('partition-action');
    await fireEvent.change(select, { target: { value: 'attach' } });
    expect(await screen.findByTestId('action-unsupported')).toHaveTextContent('PostgreSQL');
    await fireEvent.change(select, { target: { value: 'add' } });
    const card = await screen.findByTestId('partition-add');
    expect(within(card).getByRole('button', { name: 'Plan anzeigen' })).toBeDisabled();
    await fireEvent.input(within(card).getByLabelText('Name der Partition 1'), {
      target: { value: 'p_new' },
    });
    await fireEvent.input(within(card).getByLabelText('Kleiner als (Wert oder MAXVALUE)'), {
      target: { value: '30' },
    });
    await fireEvent.click(within(card).getByRole('button', { name: 'Plan anzeigen' }));
    await waitFor(() => expect(plan).toHaveBeenCalled());
    expect(plan.mock.calls[0][2]).toMatchObject({
      action: 'add',
      table: { schema: 'probe', name: 'p29_partitioned' },
      definitions: [{ name: 'p_new', less_than: '30' }],
    });
  });
  it('PostgreSQL: names selected children by their qualified catalog name', async () => {
    vi.spyOn(partitionsClient, 'capabilities').mockResolvedValue(capabilities);
    vi.spyOn(partitionsClient, 'listPartitions').mockResolvedValue(
      fx('PartitionsResult.real-postgres'),
    );
    const plan = vi.spyOn(partitionsClient, 'plan').mockResolvedValue({
      ...fx('StructurePlan.real-postgres'),
      action: 'partition_detach',
    } as never);
    render(
      PartitionsTab,
      props({
        connection: postgres,
        object: { name: 'p29_partitioned', schema: 'public', type: 'table' },
      }),
    );
    await screen.findByTestId('list-method');
    await fireEvent.change(screen.getByTestId('partition-action'), { target: { value: 'detach' } });
    const card = await screen.findByTestId('partition-detach');
    await fireEvent.click(within(card).getByRole('checkbox', { name: /public.p29_p0/ }));
    await fireEvent.click(within(card).getByRole('button', { name: 'Plan anzeigen' }));
    await waitFor(() => expect(plan).toHaveBeenCalled());
    expect(plan.mock.calls[0][2]).toMatchObject({
      action: 'detach',
      partitions: ['public.p29_p0'],
    });
  });
  it('prefix tab: lists matches, builds the batch request and shows the capability reason when off', async () => {
    vi.spyOn(partitionsClient, 'capabilities').mockResolvedValue(capabilities);
    const matches = vi
      .spyOn(partitionsClient, 'listPrefix')
      .mockResolvedValue(fx('PrefixResult.real-sqlite'));
    const plan = vi
      .spyOn(partitionsClient, 'plan')
      .mockResolvedValue(fx('StructurePlan.real-prefix-sqlite') as never);
    render(PrefixTab, props());
    const input = await screen.findByTestId('prefix-input');
    await fireEvent.input(input, { target: { value: 'pp_' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Treffer anzeigen' }));
    expect(await screen.findByTestId('match-list')).toHaveTextContent('main.pp_a');
    expect(matches.mock.calls[0][0]).toMatchObject({ prefix: 'pp_' });
    await fireEvent.change(screen.getByTestId('prefix-action'), { target: { value: 'replace' } });
    const card = await screen.findByTestId('prefix-replace');
    expect(within(card).getByRole('button', { name: 'Plan anzeigen' })).toBeDisabled();
    await fireEvent.input(screen.getByTestId('new-prefix-input'), { target: { value: 'qq_' } });
    await fireEvent.click(within(card).getByRole('button', { name: 'Plan anzeigen' }));
    await waitFor(() => expect(plan).toHaveBeenCalled());
    expect(plan.mock.calls[0][2]).toMatchObject({
      action: 'replace',
      prefix: 'pp_',
      new_prefix: 'qq_',
    });
  });
  it('explains an instance without API 0.22 instead of showing forms', async () => {
    vi.spyOn(partitionsClient, 'capabilities').mockRejectedValue(
      new ApiError('unsupported_feature', 'x'),
    );
    render(PrefixTab, props());
    expect(await screen.findByText(/API 0.22/)).toBeInTheDocument();
    expect(screen.queryByTestId('prefix-input')).toBeNull();
  });
});
