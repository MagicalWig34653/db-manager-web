// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api';
import { emptyConnection } from '$lib/workbench';
import { tables } from '$lib/tables';
import { overviewClient } from '$lib/features/overview/client';
import { searchClient } from './client';
import SearchTab from './SearchTab.svelte';
import ReplaceTab from './ReplaceTab.svelte';
import Highlight from './Highlight.svelte';
import { capabilities, description, plan, objectInfo, table } from './testing';
const base = { ...emptyConnection(), database: 'synthetic' };
const props = () => ({
  connection: base,
  token: 't',
  object: { ...table, type: 'table' },
  tab: 'ersetzen',
  onsql: () => {},
  onwritephase: vi.fn(),
});
afterEach(() => vi.restoreAllMocks());
function arrange() {
  vi.spyOn(searchClient, 'capabilities').mockResolvedValue(capabilities());
  vi.spyOn(tables, 'describe').mockResolvedValue(description());
  vi.spyOn(overviewClient, 'objects').mockResolvedValue({
    driver: 'sqlite',
    schema: 'main',
    offset: 0,
    limit: 100,
    has_more: false,
    objects: [{ ...objectInfo, rows: { value: 2, state: 'exact' } }],
    total: 1,
    exact_requested: false,
    exact_incomplete: false,
  });
  return {
    plan: vi.spyOn(searchClient, 'plan').mockResolvedValue(plan()),
    execute: vi
      .spyOn(searchClient, 'execute')
      .mockImplementation(async (_body, _token, dispatch) => {
        dispatch();
        return { outcome: 'completed', affected_rows: 1 };
      }),
  };
}
async function fillPlan() {
  await waitFor(() => expect(screen.getByLabelText('Spalte')).toBeEnabled());
  await fireEvent.change(screen.getByLabelText('Spalte'), { target: { value: 'note' } });
  await fireEvent.input(screen.getByLabelText('Suchtext'), { target: { value: 'fox' } });
  await fireEvent.input(screen.getByLabelText('Ersatztext (darf leer sein)'), {
    target: { value: 'cat' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Plan anzeigen' }));
  await waitFor(() => expect(screen.getByTestId('replace-plan')).toBeVisible());
}
describe('replacement UI', () => {
  it('shows before/after and requires exact confirmation; stays locked after a double click', async () => {
    const mocks = arrange();
    const p = props();
    render(ReplaceTab, p);
    await fillPlan();
    expect(screen.getByText('fox', { selector: 'td' })).toBeVisible();
    expect(screen.getByText('cat', { selector: 'td' })).toBeVisible();
    expect(mocks.execute).not.toHaveBeenCalled();
    const execute = screen.getByRole('button', { name: 'Ersetzung ausführen' });
    expect(execute).toBeDisabled();
    await fireEvent.input(screen.getByLabelText('Tabellenname zur Bestätigung'), {
      target: { value: 'wrong' },
    });
    await fireEvent.input(screen.getByLabelText('Zeilenzahl zur Bestätigung'), {
      target: { value: '1' },
    });
    await fireEvent.click(screen.getByRole('checkbox'));
    expect(execute).toBeDisabled();
    await fireEvent.input(screen.getByLabelText('Tabellenname zur Bestätigung'), {
      target: { value: 'orders' },
    });
    await fireEvent.click(execute);
    await fireEvent.click(execute);
    await waitFor(() =>
      expect(screen.getByTestId('replace-result')).toHaveTextContent('abgeschlossen'),
    );
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(execute).toBeDisabled();
    expect(p.onwritephase.mock.calls.map((call) => call[0])).toEqual(['sending', 'settled']);
    await fireEvent.click(screen.getByRole('button', { name: 'Neuen Plan vorbereiten' }));
    expect(screen.getByLabelText('Suchtext')).toHaveValue('fox');
    expect(screen.queryByTestId('replace-plan')).toBeNull();
  });
  it('clears sensitive drafts and discards a late plan after token change', async () => {
    const mocks = arrange();
    let resolve!: (value: ReturnType<typeof plan>) => void;
    mocks.plan.mockReturnValue(new Promise((done) => (resolve = done)));
    const p = props();
    const view = render(ReplaceTab, p);
    await waitFor(() => expect(screen.getByLabelText('Spalte')).toBeEnabled());
    await fireEvent.change(screen.getByLabelText('Spalte'), { target: { value: 'note' } });
    await fireEvent.input(screen.getByLabelText('Suchtext'), { target: { value: 'secret' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Plan anzeigen' }));
    await view.rerender({ ...p, token: 'new' });
    resolve(plan());
    await waitFor(() => expect(screen.getByLabelText('Suchtext')).toHaveValue(''));
    expect(screen.queryByTestId('replace-plan')).toBeNull();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('explains absent API and does not load table metadata', async () => {
    arrange();
    vi.mocked(searchClient.capabilities).mockRejectedValue(new ApiError('not_found', 'raw'));
    render(ReplaceTab, props());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('API 0.14'));
    expect(tables.describe).not.toHaveBeenCalled();
  });
  it('disables regex for SQLite and replacement on nontransactional tables', async () => {
    arrange();
    vi.mocked(tables.describe).mockResolvedValue({ ...description(), transactional: 'no' });
    render(ReplaceTab, props());
    await waitFor(() => expect(screen.getByText(/transaktionale Basistabelle/)).toBeVisible());
    expect(screen.getByRole('option', { name: 'Regex' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Plan anzeigen' })).toBeDisabled();
  });
});
describe('database search UI', () => {
  it('uses only selected catalog columns and shows a lower bound and safe literal highlights', async () => {
    arrange();
    const search = vi.spyOn(searchClient, 'search').mockResolvedValue({
      tables: [
        {
          table,
          columns: ['note'],
          count: 1,
          count_exact: false,
          rows: [[{ kind: 'text', value: '<img src=x onerror=alert(1)> fox' }]],
        },
      ],
    });
    const view = render(SearchTab, { ...props(), tab: 'suche' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'main.orders' })).toBeVisible());
    await fireEvent.click(screen.getByRole('button', { name: 'main.orders' }));
    await waitFor(() => expect(screen.getByLabelText('other')).toBeVisible());
    expect(screen.queryByLabelText('raw')).toBeNull();
    await fireEvent.click(screen.getByLabelText('other'));
    await fireEvent.input(screen.getByLabelText('Suchtext'), { target: { value: 'fox' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Suchen' }));
    await waitFor(() =>
      expect(screen.getByTestId('search-result')).toHaveTextContent('Mindestens 1'),
    );
    expect(search.mock.calls[0][0].targets).toEqual([{ table, columns: ['note'] }]);
    expect(view.container.querySelector('img')).toBeNull();
    expect(view.container.querySelector('mark')).toHaveTextContent('fox');
  });
  it('aborts a read and discards a late result', async () => {
    arrange();
    let resolve!: (value: { tables: [] }) => void;
    const search = vi
      .spyOn(searchClient, 'search')
      .mockReturnValue(new Promise((done) => (resolve = done)));
    render(SearchTab, { ...props(), tab: 'suche' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'main.orders' })).toBeVisible());
    await fireEvent.click(screen.getByRole('button', { name: 'main.orders' }));
    await waitFor(() => expect(screen.getByLabelText('note')).toBeVisible());
    await fireEvent.input(screen.getByLabelText('Suchtext'), { target: { value: 'fox' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Suchen' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(search.mock.calls[0][2]!.aborted).toBe(true);
    resolve({ tables: [] });
    expect(screen.queryByTestId('search-result')).toBeNull();
  });
  it('never executes server regex as JavaScript or parses HTML', () => {
    const view = render(Highlight, {
      value: '<svg onload=alert(1)>',
      term: '(a+)+$',
      mode: 'regex',
    });
    expect(view.container.querySelector('svg')).toBeNull();
    expect(view.container.textContent).toBe('<svg onload=alert(1)>');
  });
});
