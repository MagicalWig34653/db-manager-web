// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import { emptyConnection } from '$lib/workbench';
import SqlLibraryPanel from './SqlLibraryPanel.svelte';
import { libraryFor } from './storage.svelte';
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it('saves and restores literal SQL without executing it, filters history and disables restore while running', async () => {
  const connection = { ...emptyConnection(), database: 'component-one' };
  const restore = vi.fn();
  const view = render(SqlLibraryPanel, {
    connection,
    token: '',
    value: "SELECT '<img src=x>'",
    onrestore: restore,
  });
  const enabled = await screen.findByRole('checkbox', { name: 'Verlauf speichern' });
  expect(enabled).not.toBeChecked();
  await fireEvent.input(screen.getByLabelText('Name des Lesezeichens'), {
    target: { value: 'Example' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Als Lesezeichen speichern' }));
  expect(restore).not.toHaveBeenCalled();
  expect(screen.getByText("SELECT '<img src=x>'")).toBeInTheDocument();
  expect(document.querySelector('.sql-library img')).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: 'In Editor übernehmen' }));
  expect(restore).toHaveBeenCalledExactlyOnceWith("SELECT '<img src=x>'");
  await view.rerender({ connection, token: '', value: '', onrestore: restore, disabled: true });
  expect(screen.getByRole('button', { name: 'In Editor übernehmen' })).toBeDisabled();
  await fireEvent.change(await screen.findByRole('checkbox', { name: 'Verlauf speichern' }), {
    target: { checked: true },
  });
  const library = await libraryFor(connection);
  expect(library.enabled).toBe(true);
  library.record('SELECT 7');
  library.record('SELECT 8');
  await fireEvent.input(screen.getByLabelText('Verlauf durchsuchen'), {
    target: { value: 'SELECT 8' },
  });
  expect(screen.getByText('SELECT 8')).toBeInTheDocument();
  expect(screen.queryByText('SELECT 7')).toBeNull();
  await fireEvent.change(screen.getByRole('checkbox', { name: 'Verlauf speichern' }), {
    target: { checked: false },
  });
  expect(library.history).toEqual([]);
});

it('keeps the panel usable with storage unavailable and resets on connection changes', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Denied');
  });
  const connection = { ...emptyConnection(), database: 'component-denied' };
  const view = render(SqlLibraryPanel, {
    connection,
    token: '',
    value: 'SELECT 1',
    onrestore: vi.fn(),
  });
  await screen.findByText(/Browserspeicher nicht verfügbar/);
  await fireEvent.input(screen.getByLabelText('Name des Lesezeichens'), {
    target: { value: 'Temporary' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Als Lesezeichen speichern' }));
  expect(screen.getByText('Temporary')).toBeInTheDocument();
  await view.rerender({
    connection: { ...connection, database: 'component-other' },
    token: '',
    value: '',
    onrestore: vi.fn(),
  });
  await waitFor(() => expect(screen.queryByText('Temporary')).toBeNull());
});
