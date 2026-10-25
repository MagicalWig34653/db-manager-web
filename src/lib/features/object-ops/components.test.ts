// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api';
import type { ConnectionDraft } from '$lib/workbench';
import ActionCard from './ActionCard.svelte';
import DatabaseOpsTab from './DatabaseOpsTab.svelte';
import TableOpsTab from './TableOpsTab.svelte';
import { objectOpsClient } from './client';
import { fx } from './testing';

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
  database: 'shop',
  host: 'h',
  port: 3306,
  username: 'u',
};
const dropPlan = fx('ObjectOpPlan.sqlite-table-drop');
const completed = fx('ObjectOpResult.sqlite-table-drop-completed');
let plan: ReturnType<typeof vi.spyOn>;
let execute: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  plan = vi.spyOn(objectOpsClient, 'plan').mockResolvedValue(dropPlan as never);
  execute = vi.spyOn(objectOpsClient, 'execute').mockResolvedValue(completed as never);
  vi.spyOn(objectOpsClient, 'capabilities').mockResolvedValue(
    fx('ObjectOpCapabilities.all-drivers') as never,
  );
});
afterEach(() => vi.restoreAllMocks());

const card = (patch: Record<string, unknown> = {}) =>
  render(ActionCard, {
    action: 'table_drop',
    capability: { support: 'supported' },
    connection: sqlite,
    token: 'tok',
    fields: () => ({ table: { name: 'parent' } }),
    ...patch,
  });
const planButton = () => screen.findByRole('button', { name: 'Plan anzeigen' });
const dialog = () => screen.findByTestId('confirm-destructive');

describe('ActionCard (destructive flow)', () => {
  it('shows the plan with statements, warnings and dependencies before anything is executed', async () => {
    card();
    await fireEvent.click(await planButton());
    const view = await screen.findByTestId('plan-table_drop');
    expect(view).toHaveTextContent('DROP TABLE "parent"');
    expect(view).toHaveTextContent('Fremdschlüssel');
    expect(screen.getByTestId('dependencies')).toHaveTextContent('verhindert die Aktion');
    expect(screen.getByTestId('dependencies')).toHaveTextContent('Textsuche, nicht sicher');
    expect(screen.getByTestId('affected')).toHaveTextContent('table:parent');
    expect(execute).not.toHaveBeenCalled();
  });
  it('keeps execution disabled for a wrong typed name and sends one request for the right one', async () => {
    card();
    await fireEvent.click(await planButton());
    await fireEvent.click(await screen.findByRole('button', { name: 'Ausführen' }));
    const box = await dialog();
    const input = within(box).getByRole('textbox');
    const confirmButton = within(box).getByRole('button', { name: 'Ausführen' });
    await fireEvent.input(input, { target: { value: 'Parent' } });
    expect(confirmButton).toBeDisabled();
    await fireEvent.click(confirmButton);
    expect(execute).not.toHaveBeenCalled();
    await fireEvent.input(input, { target: { value: 'parent' } });
    await fireEvent.click(confirmButton);
    await fireEvent.click(confirmButton);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('result-table_drop')).toHaveAttribute(
      'data-outcome',
      'completed',
    );
    expect((execute.mock.calls[0][1] as { confirm: unknown }).confirm).toEqual({
      action: 'table_drop',
      target_name: 'parent',
    });
  });
  it('locks after completion and requires a new plan', async () => {
    card();
    await fireEvent.click(await planButton());
    await fireEvent.click(await screen.findByRole('button', { name: 'Ausführen' }));
    const box = await dialog();
    await fireEvent.input(within(box).getByRole('textbox'), { target: { value: 'parent' } });
    await fireEvent.click(within(box).getByRole('button', { name: 'Ausführen' }));
    await screen.findByTestId('result-table_drop');
    expect(screen.queryByRole('button', { name: 'Ausführen' })).toBeNull();
    expect(screen.getByText(/gesperrt/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Neuen Plan vorbereiten' }));
    expect(plan).toHaveBeenCalledTimes(1);
    await fireEvent.click(await planButton());
    expect(plan).toHaveBeenCalledTimes(2);
  });
  it('shows rejected reasons in German and the unknown outcome without retry', async () => {
    execute.mockResolvedValue(fx('ObjectOpResult.sqlite-table-drop-rejected') as never);
    const view = card();
    await fireEvent.click(await planButton());
    await fireEvent.click(await screen.findByRole('button', { name: 'Ausführen' }));
    let box = await dialog();
    await fireEvent.input(within(box).getByRole('textbox'), { target: { value: 'parent' } });
    await fireEvent.click(within(box).getByRole('button', { name: 'Ausführen' }));
    const result = await screen.findByTestId('result-table_drop');
    expect(result).toHaveAttribute('data-outcome', 'rejected');
    expect(result).toHaveTextContent('Es wurde nichts verändert');
    view.unmount();
    execute.mockRejectedValue(new ApiError('outcome_unknown', 'x'));
    card();
    await fireEvent.click(await planButton());
    await fireEvent.click(await screen.findByRole('button', { name: 'Ausführen' }));
    box = await dialog();
    await fireEvent.input(within(box).getByRole('textbox'), { target: { value: 'parent' } });
    await fireEvent.click(within(box).getByRole('button', { name: 'Ausführen' }));
    expect(await screen.findByTestId('op-unknown')).toHaveTextContent('Nicht erneut senden');
    expect(screen.queryByRole('button', { name: /erneut senden|Wiederholen/i })).toBeNull();
  });
  it('requires the extra acknowledgement for the connection database', async () => {
    plan.mockResolvedValue({
      ...dropPlan,
      action: 'database_drop',
      confirmation: {
        action: 'database_drop',
        destructive: true,
        target_name: 'shop',
        current_database: true,
      },
    } as never);
    execute.mockResolvedValue({ ...completed, action: 'database_drop' } as never);
    card({ action: 'database_drop', connection: mysql, fields: () => ({ database: 'shop' }) });
    await fireEvent.click(await planButton());
    const run = await screen.findByRole('button', { name: 'Ausführen' });
    expect(run).toBeDisabled();
    await fireEvent.click(screen.getByRole('checkbox', { name: /aktuell verbundene Datenbank/ }));
    expect(run).toBeEnabled();
    await fireEvent.click(run);
    const box = await dialog();
    await fireEvent.input(within(box).getByRole('textbox'), { target: { value: 'shop' } });
    await fireEvent.click(within(box).getByRole('button', { name: 'Ausführen' }));
    await screen.findByTestId('result-database_drop');
    expect((execute.mock.calls[0][1] as { confirm: unknown }).confirm).toEqual({
      action: 'database_drop',
      target_name: 'shop',
      acknowledge_current_database: true,
    });
  });
  it('explains unsupported actions with the backend reason instead of a form', () => {
    card({ capability: { support: 'unsupported', reason: 'Grund vom Backend.' } });
    expect(screen.getByText('Grund vom Backend.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Plan anzeigen' })).toBeNull();
  });
  it('shows the limitation of limited actions next to the form', async () => {
    card({ capability: { support: 'limited', reason: 'Nur eingeschränkt.' } });
    expect(await screen.findByTestId('limited-note')).toHaveTextContent('Nur eingeschränkt.');
  });
  it('discards a plan answer after a token change', async () => {
    let release: (v: unknown) => void = () => {};
    plan.mockReturnValue(new Promise((r) => (release = r)) as never);
    const view = card();
    await fireEvent.click(await planButton());
    await view.rerender({ token: 'other' });
    release(dropPlan);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Plan anzeigen' })).toBeEnabled(),
    );
    expect(screen.queryByTestId('plan-table_drop')).toBeNull();
  });
  it('reports write phases to the shell', async () => {
    const phases: string[] = [];
    execute.mockImplementation((async (
      _a: unknown,
      _b: unknown,
      _t: unknown,
      dispatch?: () => void,
    ) => {
      dispatch?.();
      return completed;
    }) as never);
    card({ onwritephase: (p: string) => phases.push(p) });
    await fireEvent.click(await planButton());
    await fireEvent.click(await screen.findByRole('button', { name: 'Ausführen' }));
    const box = await dialog();
    await fireEvent.input(within(box).getByRole('textbox'), { target: { value: 'parent' } });
    await fireEvent.click(within(box).getByRole('button', { name: 'Ausführen' }));
    await screen.findByTestId('result-table_drop');
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
  it('database tab: SQLite shows every database action as unsupported with the reason', async () => {
    render(DatabaseOpsTab, props());
    expect(await screen.findAllByText(/verwaltete Kennungen/)).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Plan anzeigen' })).toBeNull();
  });
  it('database tab: MySQL offers the three forms and builds structured fields', async () => {
    render(DatabaseOpsTab, props({ connection: mysql }));
    const create = await screen.findByTestId('op-database_create');
    await fireEvent.input(within(create).getByLabelText('Datenbankname'), {
      target: { value: 'p07 odd`db"x' },
    });
    await fireEvent.click(within(create).getByRole('button', { name: 'Plan anzeigen' }));
    await waitFor(() => expect(plan).toHaveBeenCalled());
    expect(plan.mock.calls[0][0]).toBe('database_create');
    expect(plan.mock.calls[0][1]).toMatchObject({ database: 'p07 odd`db"x' });
    expect(plan.mock.calls[0][1]).not.toHaveProperty('collation');
  });
  it('table tab: tables get five actions, views only a note', async () => {
    const view = render(TableOpsTab, props({ object: { name: 'v', type: 'view' } }));
    expect(await screen.findByText(/Sicht/)).toBeInTheDocument();
    expect(screen.queryByTestId('op-table_drop')).toBeNull();
    view.unmount();
    render(TableOpsTab, props({ object: { name: 'orders', schema: 'main', type: 'table' } }));
    for (const action of ['table_rename', 'table_copy', 'table_truncate', 'table_drop'])
      expect(await screen.findByTestId(`op-${action}`)).toBeInTheDocument();
    const rename = screen.getByTestId('op-table_rename');
    expect(within(rename).getByRole('button', { name: 'Plan anzeigen' })).toBeDisabled();
    await fireEvent.input(within(rename).getByLabelText('Neuer Name'), {
      target: { value: 'orders2' },
    });
    await fireEvent.click(within(rename).getByRole('button', { name: 'Plan anzeigen' }));
    await waitFor(() => expect(plan).toHaveBeenCalled());
    expect(plan.mock.calls[0][1]).toMatchObject({
      table: { schema: 'main', name: 'orders' },
      new_name: 'orders2',
    });
  });
});
