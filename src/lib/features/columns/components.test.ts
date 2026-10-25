// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api';
import { emptyConnection } from '$lib/workbench';
import { tables } from '$lib/tables';
import { columnsClient } from './client';
import ColumnsTab from './ColumnsTab.svelte';
import { capabilities, description, hash, plan, result, support } from './testing';

const base = { ...emptyConnection(), database: 'shop' };
const object = { name: 'orders', type: 'table' } as const;
function mount(driver: 'sqlite' | 'mysql' | 'postgresql' = 'postgresql') {
  const phases: string[] = [];
  const view = render(ColumnsTab, {
    connection: { ...base, driver },
    token: 'tok',
    object,
    tab: 'spalten',
    onsql: () => {},
    onwritephase: (phase: string) => phases.push(phase),
  });
  return { phases, ...view };
}
afterEach(() => vi.restoreAllMocks());

function arrange(over: Parameters<typeof capabilities>[0] = {}) {
  vi.spyOn(columnsClient, 'capabilities').mockResolvedValue(capabilities(over));
  vi.spyOn(tables, 'describe').mockResolvedValue(description());
  return {
    plan: vi.spyOn(columnsClient, 'plan'),
    alter: vi.spyOn(columnsClient, 'alter'),
  };
}
async function ready() {
  await waitFor(() => expect(screen.getByTestId('column-list')).toBeVisible());
}
async function addColumn(name: string) {
  await fireEvent.click(screen.getByRole('button', { name: 'Spalte hinzufügen' }));
  await fireEvent.input(screen.getByLabelText('Name'), { target: { value: name } });
  await fireEvent.change(screen.getByLabelText('Typ'), { target: { value: 'int64' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Zur Änderungsliste hinzufügen' }));
}

describe('ColumnsTab', () => {
  it('lists columns with type, null and default; offers moving only for MySQL/MariaDB', async () => {
    arrange();
    const pg = mount('postgresql');
    await ready();
    expect(screen.getByText('varchar(80)')).toBeVisible();
    expect(screen.getByText('x')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Spalte note verschieben' })).toBeNull();
    pg.unmount();
    mount('mysql');
    await ready();
    expect(screen.getByRole('button', { name: 'Spalte note verschieben' })).toBeEnabled();
  });

  it('explains unsupported and limited SQLite actions and disables the unsupported ones', async () => {
    arrange();
    mount('sqlite');
    await ready();
    expect(screen.getByTestId('sqlite-note')).toBeVisible();
    const list = screen.getByTestId('support-list');
    expect(list).toHaveTextContent('SQLite baut Tabellen hier nicht neu auf.');
    expect(list).toHaveTextContent('NOT NULL nur mit konstantem Standardwert.');
    expect(screen.getByRole('button', { name: 'Spalte note ändern' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Spalte note umbenennen' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Spalte note entfernen' })).toBeEnabled();
  });

  it('shows a notice and loads no table when the backend lacks API 0.9', async () => {
    vi.spyOn(columnsClient, 'capabilities').mockRejectedValue(
      new ApiError('unsupported_feature', 'x'),
    );
    const describeSpy = vi.spyOn(tables, 'describe');
    mount();
    await waitFor(() =>
      expect(screen.getByText('Spaltenänderungen nicht verfügbar')).toBeVisible(),
    );
    expect(describeSpy).not.toHaveBeenCalled();
  });

  it('plans first, needs a confirmation and sends exactly one execute request', async () => {
    const spies = arrange();
    spies.plan.mockResolvedValue(plan());
    let release: (value: ReturnType<typeof result>) => void = () => {};
    spies.alter.mockImplementation(
      (_body, _token, onDispatch) =>
        new Promise((resolve) => {
          onDispatch?.();
          release = resolve;
        }),
    );
    const { phases } = mount();
    await ready();
    await addColumn('n');
    expect(spies.plan).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Plan anzeigen' }));
    await waitFor(() => expect(screen.getByTestId('columns-plan')).toBeVisible());
    expect(screen.getByText(/ADD COLUMN "n" BIGINT NULL/)).toBeVisible();
    expect(screen.getByTestId('plan-affected')).toHaveTextContent('public.orders.n');
    expect(screen.getByTestId('plan-transaction')).toHaveTextContent('Transaktion');
    const sent = spies.plan.mock.calls[0][0] as Record<string, unknown>;
    expect(sent.changes).toEqual([
      expect.objectContaining({
        action: 'add',
        definition: expect.objectContaining({ name: 'n' }),
      }),
    ]);
    const execute = screen.getByRole('button', { name: 'Ausführen' });
    expect(execute).toBeDisabled();
    expect(spies.alter).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('checkbox', { name: /geprüft/ }));
    await fireEvent.click(execute);
    await fireEvent.click(execute);
    await fireEvent.click(execute);
    expect(spies.alter).toHaveBeenCalledTimes(1);
    const body = spies.alter.mock.calls[0][0] as Record<string, unknown>;
    expect(body.confirm).toEqual({ action: 'columns_alter' });
    expect(body.expected_plan_sha256).toBe(hash);
    expect(phases).toEqual(['sending']);
    release(result());
    await waitFor(() =>
      expect(screen.getByTestId('columns-result')).toHaveTextContent('ausgeführt'),
    );
    expect(phases).toEqual(['sending', 'settled']);
    // Locked after the attempt: no execute button, only a fresh batch.
    expect(screen.queryByRole('button', { name: 'Ausführen' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Neue Änderung vorbereiten' }));
    expect(screen.queryByTestId('columns-plan')).toBeNull();
    expect(spies.alter).toHaveBeenCalledTimes(1);
  });

  it('asks for the catalog table name before a destructive plan and rejects a wrong name', async () => {
    const spies = arrange();
    spies.plan.mockResolvedValue(
      plan({ destructive: true, target_name: 'orders', warnings: ['Alle Werte werden gelöscht.'] }),
    );
    spies.alter.mockResolvedValue(result());
    mount();
    await ready();
    await fireEvent.click(screen.getByRole('button', { name: 'Spalte note entfernen' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Plan anzeigen' }));
    await waitFor(() => expect(screen.getByTestId('plan-destructive')).toBeVisible());
    expect(screen.queryByRole('checkbox', { name: /geprüft/ })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Zerstörend ausführen …' }));
    const field = await screen.findByLabelText(/orders/);
    const confirm = screen
      .getAllByRole('button', { name: 'Zerstörend ausführen …' })
      .find((button) => button.closest('[data-testid="confirm-destructive"]'))!;
    await fireEvent.input(field, { target: { value: 'order' } });
    expect(confirm).toBeDisabled();
    await fireEvent.input(field, { target: { value: 'ORDERS' } });
    expect(confirm).toBeDisabled();
    expect(spies.alter).not.toHaveBeenCalled();
    await fireEvent.input(field, { target: { value: 'orders' } });
    await fireEvent.click(confirm);
    await waitFor(() => expect(spies.alter).toHaveBeenCalledTimes(1));
    expect((spies.alter.mock.calls[0][0] as { confirm: unknown }).confirm).toEqual({
      action: 'columns_alter',
      target_name: 'orders',
    });
  });

  it('reports an unknown outcome, never retries and keeps the action locked', async () => {
    const spies = arrange();
    spies.plan.mockResolvedValue(plan());
    spies.alter.mockImplementation(async (_body, _token, onDispatch) => {
      onDispatch?.();
      throw new ApiError('outcome_unknown', 'x');
    });
    const { phases } = mount();
    await ready();
    await addColumn('n');
    await fireEvent.click(screen.getByRole('button', { name: 'Plan anzeigen' }));
    await waitFor(() => expect(screen.getByTestId('columns-plan')).toBeVisible());
    await fireEvent.click(screen.getByRole('checkbox', { name: /geprüft/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Ausführen' }));
    await waitFor(() => expect(screen.getByTestId('columns-result')).toBeVisible());
    expect(screen.getByTestId('columns-result')).toHaveTextContent('Ausgang ist unbekannt');
    expect(phases).toEqual(['sending', 'unknown']);
    expect(screen.queryByRole('button', { name: 'Ausführen' })).toBeNull();
    expect(spies.alter).toHaveBeenCalledTimes(1);
  });

  it('shows a rejected result with a German reason and no backend text', async () => {
    const spies = arrange();
    spies.plan.mockResolvedValue(plan());
    spies.alter.mockResolvedValue(
      result({
        outcome: 'rejected',
        reason: 'dependency_blocks',
        message: 'RAW SERVER TEXT',
        statements_executed: 0,
        atomic: false,
        observation: 'unavailable',
      }),
    );
    mount();
    await ready();
    await addColumn('n');
    await fireEvent.click(screen.getByRole('button', { name: 'Plan anzeigen' }));
    await waitFor(() => expect(screen.getByTestId('columns-plan')).toBeVisible());
    await fireEvent.click(screen.getByRole('checkbox', { name: /geprüft/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Ausführen' }));
    await waitFor(() => expect(screen.getByTestId('columns-result')).toBeVisible());
    expect(screen.getByTestId('columns-result')).toHaveTextContent('abhängiges Objekt');
    expect(screen.queryByText(/RAW SERVER TEXT/)).toBeNull();
  });

  it('blocks invalid drafts before any request and shows name problems', async () => {
    const spies = arrange();
    mount();
    await ready();
    await fireEvent.click(screen.getByRole('button', { name: 'Spalte hinzufügen' }));
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: ' edge ' } });
    expect(screen.getByText(/nicht mit Leerzeichen beginnen/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Zur Änderungsliste hinzufügen' })).toBeDisabled();
    expect(spies.plan).not.toHaveBeenCalled();
  });

  it('rejects a second change of the same column and a colliding new name', async () => {
    arrange();
    mount();
    await ready();
    await fireEvent.click(screen.getByRole('button', { name: 'Spalte note entfernen' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Spalte note umbenennen' }));
    await fireEvent.input(screen.getByLabelText('Neuer Name'), { target: { value: 'total' } });
    expect(screen.getByRole('button', { name: 'Zur Änderungsliste hinzufügen' })).toBeEnabled();
    await fireEvent.click(screen.getByRole('button', { name: 'Zur Änderungsliste hinzufügen' }));
    const issues = screen.getByTestId('batch-issues');
    expect(issues).toHaveTextContent('mehrfach Ziel');
    expect(issues).toHaveTextContent('bereits vergeben');
    expect(screen.getByRole('button', { name: 'Plan anzeigen' })).toBeDisabled();
  });

  it('shows plan errors in German and does not offer execution', async () => {
    const spies = arrange();
    spies.plan.mockRejectedValue(new ApiError('column_exists', 'RAW'));
    mount();
    await ready();
    await addColumn('n');
    await fireEvent.click(screen.getByRole('button', { name: 'Plan anzeigen' }));
    await waitFor(() => expect(screen.getByTestId('plan-error')).toBeVisible());
    expect(screen.getByTestId('plan-error')).toHaveTextContent('kollidiert');
    expect(screen.queryByRole('button', { name: 'Ausführen' })).toBeNull();
  });

  it('prefills a MySQL change from the catalog and requires comment and collation', async () => {
    const spies = arrange();
    spies.plan.mockResolvedValue(plan({ driver: 'mysql', destructive: true }));
    mount('mysql');
    await ready();
    await fireEvent.click(screen.getByRole('button', { name: 'Spalte note ändern' }));
    expect(screen.getByLabelText('Typ')).toHaveValue('text');
    expect(screen.getByLabelText('Länge')).toHaveValue('80');
    expect(screen.getByTestId('old-default')).toHaveTextContent('x');
    expect(screen.getByRole('button', { name: 'Zur Änderungsliste hinzufügen' })).toBeDisabled();
    expect(screen.getByTestId('replace-warning')).toBeVisible();
    await fireEvent.input(screen.getByLabelText('Kollation (erforderlich für Text)'), {
      target: { value: 'utf8mb4_bin' },
    });
    expect(screen.getByRole('button', { name: 'Zur Änderungsliste hinzufügen' })).toBeDisabled();
    await fireEvent.click(
      screen.getByRole('checkbox', { name: /Kommentar und Kollation geprüft/ }),
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Zur Änderungsliste hinzufügen' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Plan anzeigen' }));
    await waitFor(() => expect(spies.plan).toHaveBeenCalled());
    const change = (spies.plan.mock.calls[0][0] as { changes: Record<string, unknown>[] })
      .changes[0] as { definition: Record<string, unknown> };
    expect(change.definition).toMatchObject({
      comment: '',
      collation: 'utf8mb4_bin',
      type: { kind: 'text', length: 80 },
    });
  });
});

describe('ColumnsTab review rules', () => {
  it('keeps the change list after a rejected execution and discards only the plan', async () => {
    const spies = arrange();
    spies.plan.mockResolvedValue(plan());
    spies.alter.mockResolvedValue(
      result({
        outcome: 'rejected',
        reason: 'database_error',
        statements_executed: 0,
        atomic: false,
      }),
    );
    mount();
    await ready();
    await addColumn('n');
    await fireEvent.click(screen.getByRole('button', { name: 'Plan anzeigen' }));
    await waitFor(() => expect(screen.getByTestId('columns-plan')).toBeVisible());
    await fireEvent.click(screen.getByRole('checkbox', { name: /geprüft/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Ausführen' }));
    await waitFor(() => expect(screen.getByTestId('columns-result')).toBeVisible());
    await fireEvent.click(screen.getByRole('button', { name: 'Zurück zur Änderungsliste' }));
    expect(screen.queryByTestId('columns-plan')).toBeNull();
    expect(screen.getByTestId('pending-list')).toHaveTextContent('Spalte n hinzufügen');
    expect(screen.getByRole('button', { name: 'Plan anzeigen' })).toBeEnabled();
  });

  it('empties the list after a completed execution', async () => {
    const spies = arrange();
    spies.plan.mockResolvedValue(plan());
    spies.alter.mockResolvedValue(result());
    mount();
    await ready();
    await addColumn('n');
    await fireEvent.click(screen.getByRole('button', { name: 'Plan anzeigen' }));
    await waitFor(() => expect(screen.getByTestId('columns-plan')).toBeVisible());
    await fireEvent.click(screen.getByRole('checkbox', { name: /geprüft/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Ausführen' }));
    await waitFor(() => expect(screen.getByTestId('columns-result')).toBeVisible());
    await fireEvent.click(screen.getByRole('button', { name: 'Neue Änderung vorbereiten' }));
    expect(screen.getByText('Noch keine Änderungen vorgemerkt.')).toBeVisible();
  });

  it('marks non-InnoDB MySQL tables as unsupported early and disables all actions', async () => {
    vi.spyOn(columnsClient, 'capabilities').mockResolvedValue(capabilities());
    vi.spyOn(tables, 'describe').mockResolvedValue({ ...description(), storage_engine: 'MyISAM' });
    mount('mysql');
    await ready();
    expect(screen.getByText('Tabellen-Engine nicht unterstützt')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Spalte note ändern' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Spalte note entfernen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Spalte hinzufügen' })).toBeDisabled();
  });

  it('does not preselect an unrecognized type and sends no type until the user chooses', async () => {
    vi.spyOn(columnsClient, 'capabilities').mockResolvedValue(capabilities());
    const desc = description();
    desc.columns[1].database_type = 'timestamp with time zone';
    vi.spyOn(tables, 'describe').mockResolvedValue(desc);
    mount('postgresql');
    await ready();
    await fireEvent.click(screen.getByRole('button', { name: 'Spalte note ändern' }));
    expect(screen.getByLabelText('Typ')).toHaveValue('');
    expect(screen.getByTestId('old-type')).toHaveTextContent('nicht eindeutig erkannt');
    expect(screen.getByRole('button', { name: 'Zur Änderungsliste hinzufügen' })).toBeDisabled();
  });
});

describe('capability helpers', () => {
  it('support helper keeps reasons', () => {
    expect(support('limited', 'r')).toEqual({ support: 'limited', reason: 'r' });
  });
});
