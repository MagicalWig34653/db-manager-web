// SPDX-License-Identifier: AGPL-3.0-only
import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';
import { afterEach, it, expect, vi } from 'vitest';
import { emptyConnection } from '$lib/workbench';
import { Session } from '$lib/shell/session.svelte';
import { maintenanceClient } from './client';
import Panel from './MaintenancePanel.svelte';
import Host from './testing/Host.svelte';
import { capabilities, item, plan, result } from './testing';
const props = {
  connection: { ...emptyConnection(), database: 'synthetic' },
  token: 'test',
  object: { name: 'orders', schema: 'main', type: 'table' as const },
  tab: 'wartung',
  onsql: () => {},
  onwritephase: vi.fn(),
};
afterEach(() => vi.restoreAllMocks());
function arrange() {
  vi.spyOn(maintenanceClient, 'capabilities').mockResolvedValue(capabilities());
  return {
    preview: vi.spyOn(maintenanceClient, 'plan').mockResolvedValue(plan()),
    execute: vi
      .spyOn(maintenanceClient, 'execute')
      .mockImplementation(async (_body, _token, dispatch) => {
        dispatch();
        return result();
      }),
  };
}
const ready = () =>
  waitFor(() => expect(screen.getByRole('button', { name: 'Plan anzeigen' })).toBeEnabled());
async function preview() {
  await ready();
  await fireEvent.click(screen.getByRole('button', { name: 'Plan anzeigen' }));
  await waitFor(() => expect(screen.getByTestId('maintenance-plan')).toBeVisible());
}
it('renders unsupported reasons, previews warnings as text and locks after one execution', async () => {
  const spies = arrange();
  const value = plan();
  value.items[0].plan!.warnings = ['<img src=x onerror=alert(1)>'];
  spies.preview.mockResolvedValue(value);
  const phases: string[] = [];
  const { container } = render(Panel, { ...props, onwritephase: (phase) => phases.push(phase) });
  await preview();
  expect(screen.getByTestId('maintenance-capabilities')).toHaveTextContent('Nicht unterstützt');
  expect(screen.getByTestId('maintenance-plan')).toHaveTextContent('<img src=x onerror=alert(1)>');
  expect(container.querySelector('img')).toBeNull();
  expect(screen.getByRole('button', { name: 'Ausführen' })).toBeDisabled();
  await fireEvent.click(screen.getByRole('checkbox', { name: /geprüft/ }));
  const execute = screen.getByRole('button', { name: 'Ausführen' });
  await fireEvent.click(execute);
  await fireEvent.click(execute);
  await waitFor(() =>
    expect(screen.getByTestId('maintenance-result')).toHaveTextContent('Abgeschlossen'),
  );
  expect(spies.execute).toHaveBeenCalledTimes(1);
  expect(phases).toEqual(['sending', 'settled']);
  expect(screen.queryByRole('button', { name: 'Ausführen' })).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: 'Neue Wartung vorbereiten' }));
  expect(screen.queryByTestId('maintenance-plan')).toBeNull();
});
it('requires the exact catalog name and clears confirmation on token changes', async () => {
  const spies = arrange();
  spies.preview.mockResolvedValue(plan([item], true));
  const view = render(Panel, props);
  await preview();
  await fireEvent.click(screen.getByRole('checkbox', { name: /geprüft/ }));
  const input = screen.getByLabelText('Tabellenname exakt eingeben: orders');
  await fireEvent.input(input, { target: { value: 'Orders' } });
  expect(screen.getByRole('button', { name: 'Ausführen' })).toBeDisabled();
  await fireEvent.input(input, { target: { value: 'orders' } });
  expect(screen.getByRole('button', { name: 'Ausführen' })).toBeEnabled();
  await view.rerender({ ...props, token: 'changed' });
  await ready();
  expect(screen.queryByRole('button', { name: 'Ausführen' })).toBeNull();
  expect(spies.execute).not.toHaveBeenCalled();
});
it('offers vacuum options only for vacuum and sends them into the plan', async () => {
  const spies = arrange();
  render(Panel, { ...props, connection: { ...props.connection, driver: 'postgresql' } });
  await ready();
  expect(screen.queryByLabelText(/FULL:/)).toBeNull();
  await fireEvent.change(screen.getByLabelText('Wartungsaktion'), { target: { value: 'vacuum' } });
  await fireEvent.click(screen.getByRole('checkbox', { name: /FULL:/ }));
  await fireEvent.click(screen.getByRole('checkbox', { name: /Zusätzlich/ }));
  await fireEvent.click(screen.getByRole('button', { name: 'Plan anzeigen' }));
  expect(spies.preview).toHaveBeenCalledWith(
    expect.objectContaining({
      items: [{ table: item.table, action: 'vacuum', full: true, analyze: true }],
    }),
    'test',
    expect.any(AbortSignal),
  );
});
it('disables plans while another write runs and enforces the batch limit without views', async () => {
  arrange();
  const session = new Session({
    onConnected: () => {},
    onCatalogSettled: () => {},
    onCleared: () => {},
  });
  session.objects = Array.from({ length: 51 }, (_, i) => ({ name: `table-${i}`, type: 'table' }));
  session.objects.push({ name: 'view', type: 'view' });
  render(Host, { ...props, object: undefined, session });
  await waitFor(() => expect(screen.getByTestId('maintenance-capabilities')).toBeVisible());
  expect(screen.queryByRole('checkbox', { name: 'view' })).toBeNull();
  for (let i = 0; i < 50; i++)
    await fireEvent.click(screen.getByRole('checkbox', { name: `table-${i}` }));
  expect(screen.getByRole('checkbox', { name: 'table-50' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Plan anzeigen' })).toBeEnabled();
  session.writeCount = 1;
  await waitFor(() => expect(screen.getByRole('button', { name: 'Plan anzeigen' })).toBeDisabled());
});
it('shows per-table rejected and unknown messages, partial status and a lossless checksum', async () => {
  const spies = arrange();
  const items = [
    { ...item },
    { ...item, table: { name: 'second' } },
    { ...item, table: { name: 'third' } },
  ];
  spies.preview.mockResolvedValue(plan(items));
  const answer = result(items);
  answer.partial = true;
  answer.items[0] = { ...answer.items[0], action: 'checksum', checksum: '18446744073709551615' };
  // All request and response actions must match, including this checksum item.
  // Use checksum for the entire homogeneous UI batch.
  items.forEach((item) => {
    item.action = 'checksum';
  });
  spies.preview.mockResolvedValue(plan(items));
  answer.items.forEach((item) => {
    item.action = 'checksum';
  });
  answer.items[1] = { ...answer.items[1], outcome: 'rejected', reason: 'checksum_unavailable' };
  answer.items[2] = {
    ...answer.items[2],
    outcome: 'outcome_unknown',
    reason: 'execution_unconfirmed',
  };
  spies.execute.mockImplementation(async (_body, _token, dispatch) => {
    dispatch();
    return answer;
  });
  const session = new Session({
    onConnected: () => {},
    onCatalogSettled: () => {},
    onCleared: () => {},
  });
  session.objects = items.map((item) => ({ ...item.table, type: 'table' }));
  render(Host, {
    ...props,
    connection: { ...props.connection, driver: 'mysql' },
    object: undefined,
    session,
  });
  await waitFor(() => expect(screen.getByTestId('maintenance-capabilities')).toBeVisible());
  for (const table of items)
    await fireEvent.click(
      screen.getByRole('checkbox', {
        name: table.table.name === 'orders' ? 'main.orders' : table.table.name,
      }),
    );
  // Synthetic plans use sqlite; align their driver with this MySQL UI.
  const batch = plan(items);
  batch.items.forEach((item) => {
    item.plan!.driver = 'mysql';
  });
  spies.preview.mockResolvedValue(batch);
  await fireEvent.change(screen.getByLabelText('Wartungsaktion'), {
    target: { value: 'checksum' },
  });
  await preview();
  await fireEvent.click(screen.getByRole('checkbox', { name: /geprüft/ }));
  await fireEvent.click(screen.getByRole('button', { name: 'Ausführen' }));
  await waitFor(() =>
    expect(screen.getByTestId('maintenance-result')).toHaveTextContent('Teilerfolg'),
  );
  expect(screen.getByTestId('maintenance-result')).toHaveTextContent('18446744073709551615');
  expect(screen.getByTestId('maintenance-result')).toHaveTextContent('keine Prüfsumme');
  expect(
    screen.getAllByRole('alert').some((node) => node.textContent?.includes('Nicht erneut senden')),
  ).toBe(true);
});
