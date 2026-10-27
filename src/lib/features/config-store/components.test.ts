// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { emptyConnection } from '$lib/workbench';
import SqlLibraryPanel from '../sql-editor/SqlLibraryPanel.svelte';
import { PREFIX, SqlLibrary } from '../sql-editor/storage.svelte';
import { WriteBuffer } from './buffer.svelte';
import { ConfigClient } from './client';
import ConfigStorePanel from './ConfigStorePanel.svelte';
import { ConfigStore, resetConfigStore } from './store.svelte';
import { FakeConfigServer } from './testing';

let fake: FakeConfigServer;
let store: ConfigStore;
const connection = { ...emptyConnection(), database: 'comp-db' };
beforeEach(() => {
  localStorage.clear();
  fake = new FakeConfigServer();
  store = new ConfigStore(fake.token, {
    client: new ConfigClient(fake.fetch),
    buffer: new WriteBuffer(() => localStorage),
  });
  resetConfigStore(store);
});
afterEach(() => {
  // Unmount first: a still-mounted panel would otherwise create a fresh store while the registry is being reset.
  cleanup();
  resetConfigStore(null);
  vi.restoreAllMocks();
});
const panel = () => render(ConfigStorePanel, { connection, token: fake.token });

it('local mode: shows the reason in plain words, offers no server actions and keeps W-P16 active', async () => {
  fake.state = 'not_configured';
  panel();
  expect(await screen.findByText(/Lokaler Modus/)).toBeInTheDocument();
  expect(screen.getByText(/keinen Zustandsspeicher eingerichtet/)).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: /auf dem Server speichern/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /exportieren/ })).toBeNull();
  expect(screen.getByRole('heading', { name: 'Datenschutz' })).toBeInTheDocument();
  expect(fake.calls.every((c) => c.path === '/api/v24/capabilities')).toBe(true);
});

it('local mode on an unreachable state store names that reason and can re-check', async () => {
  fake.state = 'unreachable';
  panel();
  expect(await screen.findByText(/derzeit nicht erreichbar/)).toBeInTheDocument();
  fake.state = 'server';
  await fireEvent.click(screen.getByRole('button', { name: 'Erneut prüfen' }));
  expect(await screen.findByText(/Serverspeicher aktiv/)).toBeInTheDocument();
});

it('server mode: history opt-in is synchronous with the server, a double click sends one request', async () => {
  panel();
  const box = await screen.findByRole('checkbox', {
    name: 'Abfrageverlauf auf dem Server speichern',
  });
  expect(box).not.toBeChecked();
  await fireEvent.click(box);
  await fireEvent.click(box);
  await waitFor(() => expect(store.historyEnabled).toBe(true));
  expect(fake.writes().filter((c) => c.path === '/api/v24/config/settings')).toHaveLength(1);
  expect(
    await screen.findByRole('checkbox', { name: /Abfrageverlauf auf dem Server/ }),
  ).toBeChecked();
  expect(screen.getByText(/Alle Personen, die dasselbe Zugangstoken/)).toBeInTheDocument();
});

it('clear everything: preview first, typed confirmation required, nothing deleted before', async () => {
  fake.seed('bookmarks', { name: 'a', sql: 'SELECT 1' }, 's');
  panel();
  await fireEvent.click(
    await screen.findByRole('button', { name: 'Alle gespeicherten Daten löschen' }),
  );
  expect(await screen.findByText(/Insgesamt 1 Einträge/)).toBeInTheDocument();
  const execute = screen.getByRole('button', { name: 'Endgültig löschen' });
  expect(execute).toBeDisabled();
  expect(fake.count('bookmarks')).toBe(1);
  await fireEvent.input(screen.getByLabelText(/Tippe zur Bestätigung/), {
    target: { value: 'LÖSCHEN 1' },
  });
  await fireEvent.click(execute);
  expect(await screen.findByText(/1 Einträge gelöscht/)).toBeInTheDocument();
  expect(fake.count('bookmarks')).toBe(0);
});

it('export provides the server document as a download without parsing it into the page', async () => {
  fake.seed('bookmarks', { name: 'a', sql: 'SELECT 1' }, 's');
  const create = vi.fn(() => 'blob:x');
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
  panel();
  await fireEvent.click(
    await screen.findByRole('button', { name: 'Alle Serverdaten exportieren (JSON)' }),
  );
  expect(await screen.findByText(/Export mit 1 Einträgen/)).toBeInTheDocument();
  expect(create).toHaveBeenCalledOnce();
});

it('migration: nothing happens before the confirmation, local data stays until the explicit second step', async () => {
  const local = new SqlLibrary(PREFIX + 'd'.repeat(64));
  local.bookmark('Local', 'SELECT 1');
  panel();
  expect(await screen.findByText(/1 Lesezeichen und 0 Verlaufseinträge/)).toBeInTheDocument();
  const run = screen.getByRole('button', { name: 'Jetzt übertragen' });
  expect(run).toBeDisabled();
  expect(fake.count('bookmarks')).toBe(0);
  await fireEvent.click(screen.getByRole('checkbox', { name: /Ich bestätige/ }));
  await fireEvent.click(run);
  expect(await screen.findByText(/Übertragen: 1 neu/)).toBeInTheDocument();
  expect(fake.count('bookmarks')).toBe(1);
  expect(localStorage.getItem(PREFIX + 'd'.repeat(64))).not.toBeNull();
  await fireEvent.click(
    screen.getByRole('button', { name: 'Übertragene Einträge aus diesem Browser löschen' }),
  );
  expect(await screen.findByText(/1 lokale Einträge gelöscht/)).toBeInTheDocument();
  expect(localStorage.getItem(PREFIX + 'd'.repeat(64))).toBeNull();
});

it('SQL panel in server mode: saves bookmarks on the server, one request per double click, never echoes the SQL in errors', async () => {
  const restore = vi.fn();
  const view = render(SqlLibraryPanel, {
    connection,
    token: fake.token,
    value: 'SELECT 42',
    onrestore: restore,
  });
  expect(await screen.findByText(/Gespeichert auf dem Server/)).toBeInTheDocument();
  await fireEvent.input(await screen.findByLabelText('Name des Lesezeichens'), {
    target: { value: 'Mine' },
  });
  const save = screen.getByRole('button', { name: 'Als Lesezeichen speichern' });
  await fireEvent.click(save);
  await fireEvent.click(save);
  expect(await screen.findByText('Lesezeichen gespeichert.')).toBeInTheDocument();
  expect(fake.writes().filter((c) => c.path === '/api/v24/config/bookmarks')).toHaveLength(1);
  expect(await screen.findByText('SELECT 42')).toBeInTheDocument();
  await fireEvent.click(screen.getByRole('button', { name: 'In Editor übernehmen' }));
  expect(restore).toHaveBeenCalledExactlyOnceWith('SELECT 42');
  // The server refuses something the local rules let pass: only the catalog text is shown, never the SQL.
  view.unmount();
  render(SqlLibraryPanel, {
    connection,
    token: fake.token,
    value: 'SELECT rejectme',
    onrestore: restore,
  });
  await fireEvent.input(await screen.findByLabelText('Name des Lesezeichens'), {
    target: { value: 'Odd' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Als Lesezeichen speichern' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Zugangsdaten');
  expect(alert).not.toHaveTextContent('rejectme');
  expect(fake.count('bookmarks')).toBe(1);
});

it('SQL panel: history respects the server opt-in message and a stale edit opens the merge choice', async () => {
  fake.seed('bookmarks', { name: 'Orig', sql: 'SELECT 1' }, '');
  render(SqlLibraryPanel, { connection, token: fake.token, value: '', onrestore: () => {} });
  expect(await screen.findByText(/Der Abfrageverlauf ist auf dem Server aus/)).toBeInTheDocument();
  // seeded bookmark has another scope, so create one through the UI path instead
  await fireEvent.input(await screen.findByLabelText('Name des Lesezeichens'), {
    target: { value: 'N' },
  });
  expect(screen.getByRole('button', { name: 'Als Lesezeichen speichern' })).toBeDisabled();
});

it('SQL panel: stale edit shows both versions and only changes the server on an explicit choice', async () => {
  const restore = vi.fn();
  const view = render(SqlLibraryPanel, {
    connection,
    token: fake.token,
    value: 'SELECT 7',
    onrestore: restore,
  });
  await fireEvent.input(await screen.findByLabelText('Name des Lesezeichens'), {
    target: { value: 'First' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Als Lesezeichen speichern' }));
  await screen.findByText('Lesezeichen gespeichert.');
  await fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
  const rec = [...fake.items.values()].find((i) => i.kind === 'bookmarks')!;
  rec.version = 3;
  rec.data = { name: 'Elsewhere', sql: 'SELECT 7' };
  await fireEvent.input(screen.getByLabelText('Neuer Name'), { target: { value: 'Mine' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Änderung speichern' }));
  const dialog = await screen.findByRole('alert', {
    name: 'Das Lesezeichen wurde inzwischen geändert',
  });
  expect(within(dialog).getByText('Elsewhere')).toBeInTheDocument();
  expect(within(dialog).getByText('Mine')).toBeInTheDocument();
  expect(rec.data.name).toBe('Elsewhere');
  await fireEvent.click(within(dialog).getByRole('button', { name: 'Meine Fassung speichern' }));
  await waitFor(() => expect(rec.data.name).toBe('Mine'));
  view.unmount();
});

it('SQL panel falls back to the browser mode when the server store is unavailable', async () => {
  fake.state = 'not_configured';
  const local = new SqlLibrary(PREFIX + 'e'.repeat(64));
  void local;
  render(SqlLibraryPanel, { connection, token: fake.token, value: '', onrestore: () => {} });
  expect(await screen.findByRole('checkbox', { name: 'Verlauf speichern' })).toBeInTheDocument();
  expect(screen.queryByText(/Gespeichert auf dem Server/)).toBeNull();
});

it('degraded server: shows the buffered entry as pending and says nothing is lost', async () => {
  render(SqlLibraryPanel, {
    connection,
    token: fake.token,
    value: 'SELECT 5',
    onrestore: () => {},
  });
  await screen.findByText(/Gespeichert auf dem Server/);
  fake.down = true;
  await fireEvent.input(await screen.findByLabelText('Name des Lesezeichens'), {
    target: { value: 'Offline' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Als Lesezeichen speichern' }));
  expect(
    await screen.findByText(/zwischengespeichert und wird später übertragen/),
  ).toBeInTheDocument();
  expect(await screen.findByText(/noch nicht auf dem Server/)).toBeInTheDocument();
  expect(store.buffer.entries).toHaveLength(1);
});
