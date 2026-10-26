// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import { emptyConnection } from '$lib/workbench';
import ProgramsTab from './ProgramsTab.svelte';
import { programsClient } from './client';
import { capabilities, listing, program, plan, result } from './testing';
afterEach(() => vi.restoreAllMocks());
function setup() {
  vi.spyOn(programsClient, 'capabilities').mockResolvedValue(capabilities());
  const list = vi.spyOn(programsClient, 'list').mockResolvedValue(listing());
  const detail = vi.spyOn(programsClient, 'describe').mockResolvedValue(program());
  const planner = vi.spyOn(programsClient, 'plan').mockResolvedValue(plan());
  const execute = vi
    .spyOn(programsClient, 'execute')
    .mockImplementation(async (_body, _token, dispatch) => {
      dispatch?.();
      return result();
    });
  const phases: string[] = [];
  const view = render(ProgramsTab, {
    connection: { ...emptyConnection(), database: 'fixture' },
    token: 'token',
    tab: 'programmobjekte',
    onsql: () => {},
    onwritephase: (p) => phases.push(p),
  });
  return { view, list, detail, planner, execute, phases };
}
async function ready() {
  await screen.findByTestId('program-list');
}
it('shows definitions as plain text and properties without executing routines', async () => {
  const s = setup();
  const data = program();
  data.definition = '<img src=x onerror=alert(1)>';
  data.security = 'definer';
  data.definer = { name: 'owner' };
  s.detail.mockResolvedValue(data);
  console.error('before ready');
  await ready();
  console.error('after ready');
  await fireEvent.click(screen.getByRole('button', { name: /DROP TABLE neighbor/ }));
  console.error('before detail');
  await screen.findByTestId('program-detail');
  console.error('after detail');
  expect(screen.getByText(data.definition)).toBeVisible();
  expect(document.querySelector('img')).toBeNull();
  expect(screen.getByText(/owner/)).toBeVisible();
  expect(s.execute).not.toHaveBeenCalled();
});
it('explains unsupported SQLite routines and events without list requests', async () => {
  const s = setup();
  await ready();
  const count = s.list.mock.calls.length;
  await fireEvent.change(screen.getByLabelText('Objektart'), { target: { value: 'function' } });
  await screen.findByText('Dieser Treiber unterstützt diese Objektart nicht.');
  expect(s.list).toHaveBeenCalledTimes(count);
  expect(screen.queryByRole('button', { name: 'Anlegen' })).toBeNull();
});
it('plans exact SQL then confirms once and stays locked', async () => {
  const s = setup();
  await ready();
  await fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
  await fireEvent.input(screen.getByLabelText('Name'), { target: { value: plan().object.name } });
  await fireEvent.input(screen.getByLabelText('Definitionskörper'), {
    target: { value: 'SELECT 42 AS value' },
  });
  expect(s.planner).not.toHaveBeenCalled();
  await fireEvent.click(screen.getByRole('button', { name: 'Plan anzeigen' }));
  await screen.findByTestId('program-plan');
  expect(screen.getByText(plan().statements[0])).toBeVisible();
  const button = screen.getByRole('button', { name: 'Ausführen' });
  expect(button).toBeDisabled();
  await fireEvent.click(screen.getByRole('checkbox', { name: /Exakte Anweisungen/ }));
  await fireEvent.click(button);
  await fireEvent.click(button);
  await waitFor(() => expect(s.execute).toHaveBeenCalledTimes(1));
  expect(s.phases).toEqual(['sending', 'settled']);
  expect(screen.queryByRole('button', { name: 'Ausführen' })).toBeNull();
});
it('blocks DROP until the exact typed name and clears drafts on token change', async () => {
  const s = setup();
  await ready();
  await fireEvent.click(screen.getByRole('button', { name: /DROP TABLE neighbor/ }));
  await screen.findByTestId('program-detail');
  s.planner.mockResolvedValue(plan({ action: 'drop', destructive: true }));
  await fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Plan anzeigen' }));
  await screen.findByTestId('program-plan');
  await fireEvent.click(screen.getByRole('checkbox', { name: /Exakte Anweisungen/ }));
  const typed = screen.getByLabelText(/Zur Bestätigung den Namen/);
  await fireEvent.input(typed, { target: { value: 'wrong' } });
  expect(screen.getByRole('button', { name: 'Ausführen' })).toBeDisabled();
  await fireEvent.input(typed, { target: { value: plan().object.name } });
  expect(screen.getByRole('button', { name: 'Ausführen' })).toBeEnabled();
  await s.view.rerender({ token: 'new-token' });
  await waitFor(() => expect(screen.queryByTestId('program-plan')).toBeNull());
  expect(s.execute).not.toHaveBeenCalled();
});
