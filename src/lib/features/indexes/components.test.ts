// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import { emptyConnection } from '$lib/workbench';
import { tables } from '$lib/tables';
import { structure } from '$lib/structure';
import { ApiError } from '$lib/api';
import { indexesClient } from './client';
import IndexesTab from './IndexesTab.svelte';
import { capabilities, description, metadata, plan, result } from './testing';
afterEach(() => vi.restoreAllMocks());
function arrange() {
  vi.spyOn(indexesClient, 'capabilities').mockResolvedValue(capabilities());
  vi.spyOn(tables, 'describe').mockResolvedValue(description());
  vi.spyOn(structure, 'read').mockResolvedValue(metadata());
  return {
    plan: vi.spyOn(indexesClient, 'plan').mockResolvedValue(plan()),
    alter: vi.spyOn(indexesClient, 'alter').mockResolvedValue(result()),
  };
}
function mount(driver: 'sqlite' | 'mysql' | 'postgresql' = 'sqlite') {
  const phases = vi.fn();
  return {
    phases,
    ...render(IndexesTab, {
      connection: { ...emptyConnection(), driver, database: 'synthetic' },
      token: 't',
      object: { name: 'orders', type: 'table' },
      tab: 'indizes',
      onsql: () => {},
      onwritephase: phases,
    }),
  };
}
async function ready() {
  await waitFor(() => expect(screen.getByTestId('index-list')).toBeVisible());
}
async function define() {
  await fireEvent.input(screen.getByLabelText('Neuer Index- oder Constraintname'), {
    target: { value: 'idx_new' },
  });
  await fireEvent.change(screen.getByLabelText('Spalte 1'), { target: { value: 'note' } });
}
it('renders metadata as text and explains SQLite limits', async () => {
  arrange();
  mount();
  await ready();
  expect(screen.getByTestId('index-list')).toHaveTextContent('idx <img src=x>');
  expect(document.querySelector('img')).toBeNull();
  expect(screen.getByTestId('index-list')).toHaveTextContent('7');
  expect(screen.getByTestId('foreign-key-list')).toHaveTextContent('CASCADE');
  expect(screen.getByTestId('sqlite-indexes-note')).toHaveTextContent('kein Tabellenneuaufbau');
  expect(screen.getByRole('option', { name: 'Primärschlüssel setzen / ersetzen' })).toBeDisabled();
});
it('plans first, confirms and locks after exactly one dispatch', async () => {
  const spies = arrange();
  let release: (value: ReturnType<typeof result>) => void = () => {};
  spies.alter.mockImplementation(async (_b, _t, d) => {
    d?.();
    return new Promise((r) => (release = r));
  });
  const { phases } = mount();
  await ready();
  await define();
  expect(spies.plan).not.toHaveBeenCalled();
  await fireEvent.click(screen.getByRole('button', { name: 'Plan anzeigen' }));
  await waitFor(() => expect(screen.getByTestId('indexes-plan')).toBeVisible());
  expect(screen.getByRole('button', { name: 'Ausführen' })).toBeDisabled();
  await fireEvent.click(screen.getByLabelText('Ich habe die Vorschau und Warnungen geprüft.'));
  const button = screen.getByRole('button', { name: 'Ausführen' });
  await fireEvent.click(button);
  await fireEvent.click(button);
  expect(spies.alter).toHaveBeenCalledTimes(1);
  release(result());
  await waitFor(() => expect(screen.getByTestId('indexes-result')).toBeVisible());
  expect(phases.mock.calls.map((c) => c[0])).toEqual(['sending', 'settled']);
  expect(screen.queryByRole('button', { name: 'Ausführen' })).toBeNull();
});
it('uses the target table from the plan for typed deletion confirmation', async () => {
  const spies = arrange();
  spies.plan.mockResolvedValue(plan({ destructive: true, target_name: 'catalog table' }));
  mount();
  await ready();
  await fireEvent.change(screen.getByLabelText('Aktion'), { target: { value: 'index_drop' } });
  await fireEvent.change(screen.getByLabelText('Bestehender Name aus dem Katalog'), {
    target: { value: 'idx <img src=x>' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Plan anzeigen' }));
  await waitFor(() => expect(screen.getByTestId('indexes-plan')).toBeVisible());
  await fireEvent.click(screen.getByRole('button', { name: 'Änderung mit Namen bestätigen' }));
  const field = await screen.findByLabelText(/catalog table/);
  await fireEvent.input(field, { target: { value: 'idx <img src=x>' } });
  expect(spies.alter).not.toHaveBeenCalled();
  const dialog = screen.getByRole('dialog');
  expect(dialog.querySelector('button[type="button"]:disabled')).not.toBeNull();
});
it('keeps metadata readable when API 0.13 is unavailable', async () => {
  arrange();
  vi.mocked(indexesClient.capabilities).mockRejectedValue(
    new ApiError('unsupported_feature', 'private'),
  );
  mount();
  await ready();
  expect(screen.getByRole('alert')).toHaveTextContent('API 0.13');
  expect(screen.queryByLabelText('Aktion')).toBeNull();
});
it('clears drafts and discards late plans on token change', async () => {
  const spies = arrange();
  let release: (value: ReturnType<typeof plan>) => void = () => {};
  spies.plan.mockImplementation(() => new Promise((r) => (release = r)));
  const view = mount();
  await ready();
  await define();
  await fireEvent.click(screen.getByRole('button', { name: 'Plan anzeigen' }));
  await view.rerender({ token: 'new' });
  release(plan());
  await waitFor(() =>
    expect(screen.getByLabelText('Neuer Index- oder Constraintname')).toHaveValue(''),
  );
  expect(screen.queryByTestId('indexes-plan')).toBeNull();
});
