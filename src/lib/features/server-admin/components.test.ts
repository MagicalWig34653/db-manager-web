// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api';
import { emptyConnection } from '$lib/workbench';
import { serverAdminClient } from './client';
import { capabilities, hostileName, result, statusRows } from './testing';
import ServerAdminTab from './ServerAdminTab.svelte';

const base = { ...emptyConnection(), database: 'app', host: 'h', username: 'u' };
function mount(driver: 'mysql' | 'postgresql' | 'sqlite' = 'mysql') {
  const props = {
    connection: { ...base, driver },
    token: 'tok',
    tab: 'serververwaltung',
    onsql: () => {},
    onwritephase: () => {},
  };
  return render(ServerAdminTab, props);
}
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('ServerAdminTab', () => {
  it('shows status counters, marks masked values and keeps hostile names as text', async () => {
    vi.spyOn(serverAdminClient, 'capabilities').mockResolvedValue(capabilities());
    const read = vi.spyOn(serverAdminClient, 'read').mockResolvedValue(
      result('status', {
        values: [...statusRows, { name: hostileName, value: '<b>1</b>', masked: false }],
      }),
    );
    const { container } = mount();
    const table = await screen.findByTestId('admin-table-status');
    expect(read).toHaveBeenCalledWith(
      'status',
      expect.anything(),
      'tok',
      expect.objectContaining({ limit: 100, offset: 0 }),
      expect.anything(),
    );
    expect(within(table).getByText('Connections')).toBeInTheDocument();
    expect(table).toHaveTextContent('1.234.567.890.123.456.789');
    expect(within(table).getByTestId('masked-badge')).toHaveTextContent('maskiert');
    expect(screen.getByTestId('admin-masked-note')).toBeInTheDocument();
    expect(table).toHaveTextContent(hostileName);
    expect(table).toHaveTextContent('<b>1</b>');
    expect(container.querySelector('img, b')).toBeNull();
    expect(screen.getByTestId('admin-meta')).toHaveTextContent('Beobachtung begann');
  });

  it('offers no write controls (no SET, KILL or FLUSH)', async () => {
    vi.spyOn(serverAdminClient, 'capabilities').mockResolvedValue(capabilities());
    vi.spyOn(serverAdminClient, 'read').mockResolvedValue(
      result('processes', {
        processes: [{ id: '7', user: 'app', database: 'db', seconds: 3, self: false }],
      }),
    );
    mount();
    await screen.findByTestId('admin-table-status').catch(() => {});
    await fireEvent.click(await screen.findByRole('tab', { name: 'Prozesse' }));
    await screen.findByTestId('admin-table-processes');
    const labels = screen.getAllByRole('button').map((button) => button.textContent ?? '');
    expect(labels.join('|')).not.toMatch(/kill|beenden|flush|setzen|set\b/i);
    expect(screen.getByTestId('admin-readonly')).toHaveTextContent('Nur lesend');
  });

  it('marks the own connection in the process list and explains visibility', async () => {
    vi.spyOn(serverAdminClient, 'capabilities').mockResolvedValue(capabilities());
    vi.spyOn(serverAdminClient, 'read').mockImplementation(async (kind) =>
      kind === 'processes'
        ? result('processes', {
            processes: [
              { id: '7', user: 'app', database: 'db', seconds: 3, self: true },
              { id: '9', user: '<script>x</script>', database: '', seconds: 86400, self: false },
            ],
          })
        : result('status'),
    );
    const { container } = mount();
    await fireEvent.click(await screen.findByRole('tab', { name: 'Prozesse' }));
    const table = await screen.findByTestId('admin-table-processes');
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1]).getByTestId('self-badge')).toHaveTextContent('eigene Verbindung');
    expect(within(rows[2]).queryByTestId('self-badge')).toBeNull();
    expect(table).toHaveTextContent('<script>x</script>');
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByTestId('admin-visibility')).toHaveTextContent('PROCESS');
  });

  it('pages with offset, shows no total and disables paging at the ends', async () => {
    vi.spyOn(serverAdminClient, 'capabilities').mockResolvedValue(capabilities());
    const read = vi
      .spyOn(serverAdminClient, 'read')
      .mockResolvedValueOnce(result('status', { values: statusRows, has_more: true }))
      .mockResolvedValueOnce(
        result('status', { values: statusRows.slice(1), offset: 100, has_more: false }),
      );
    mount();
    await screen.findByTestId('admin-table-status');
    expect(screen.getByTestId('admin-prev')).toBeDisabled();
    await fireEvent.click(screen.getByTestId('admin-next'));
    await waitFor(() => expect(screen.getByTestId('admin-pager')).toHaveTextContent('101 bis 102'));
    expect(read.mock.calls[1][3]).toMatchObject({ offset: 100 });
    expect(screen.getByTestId('admin-next')).toBeDisabled();
    expect(screen.getByTestId('admin-pager')).toHaveTextContent('keine Gesamtzahl');
  });

  it('applies a server side filter on submit, resets paging and rejects over-long filters', async () => {
    vi.spyOn(serverAdminClient, 'capabilities').mockResolvedValue(capabilities());
    const read = vi
      .spyOn(serverAdminClient, 'read')
      .mockResolvedValue(result('status', { values: statusRows }));
    mount();
    await screen.findByTestId('admin-table-status');
    const input = screen.getByTestId('admin-filter');
    await fireEvent.input(input, { target: { value: 'ä'.repeat(65) } });
    expect(await screen.findByRole('alert')).toHaveTextContent('128 Bytes');
    expect(screen.getByRole('button', { name: 'Filter anwenden' })).toBeDisabled();
    const calls = read.mock.calls.length;
    await fireEvent.input(input, { target: { value: ' Threads ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Filter anwenden' }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(calls + 1));
    expect(read.mock.calls.at(-1)?.[3]).toMatchObject({ filter: 'Threads', offset: 0 });
  });

  it('reads variables with the chosen scope; PostgreSQL offers session scope only', async () => {
    vi.spyOn(serverAdminClient, 'capabilities').mockResolvedValue(capabilities());
    const read = vi
      .spyOn(serverAdminClient, 'read')
      .mockImplementation(async (kind) => result(kind));
    const view = mount('mysql');
    await fireEvent.click(await screen.findByRole('tab', { name: 'Variablen' }));
    const scope = await screen.findByTestId('admin-scope');
    expect(within(scope).getAllByRole('option')).toHaveLength(2);
    await fireEvent.change(scope, { target: { value: 'GLOBAL' } });
    await waitFor(() => expect(read.mock.calls.at(-1)?.[3]).toMatchObject({ scope: 'GLOBAL' }));
    view.unmount();
    mount('postgresql');
    await fireEvent.click(await screen.findByRole('tab', { name: 'Variablen' }));
    expect(within(await screen.findByTestId('admin-scope')).getAllByRole('option')).toHaveLength(1);
  });

  it('explains unsupported functions per driver without sending a request', async () => {
    vi.spyOn(serverAdminClient, 'capabilities').mockResolvedValue(capabilities());
    const read = vi.spyOn(serverAdminClient, 'read').mockResolvedValue(result('status'));
    mount('sqlite');
    await screen.findByTestId('admin-table-status').catch(() => {});
    await fireEvent.click(await screen.findByRole('tab', { name: 'Prozesse' }));
    expect(await screen.findByText('SQLite kennt keine Prozessliste.')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-pager')).toBeNull();
    expect(read.mock.calls.every(([kind]) => kind !== 'processes')).toBe(true);
  });

  it('shows rights and authorization problems as errors, never as an empty list', async () => {
    vi.spyOn(serverAdminClient, 'capabilities').mockResolvedValue(capabilities());
    vi.spyOn(serverAdminClient, 'read').mockRejectedValue(
      new ApiError('database_error', 'Die Datenbank hat die Abfrage abgelehnt.'),
    );
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('abgelehnt');
    expect(screen.queryByTestId('admin-empty')).toBeNull();
    expect(screen.queryByTestId('admin-table-status')).toBeNull();
  });

  it('says so when the backend does not offer the API', async () => {
    vi.spyOn(serverAdminClient, 'capabilities').mockRejectedValue(
      new ApiError('not_found', 'Das Backend bietet die Serververwaltung (API 0.17) nicht an.'),
    );
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('nicht an');
  });

  it('keeps old rows while refreshing and drops answers of an aborted request', async () => {
    vi.spyOn(serverAdminClient, 'capabilities').mockResolvedValue(capabilities());
    const first = deferred<ReturnType<typeof result>>();
    const read = vi
      .spyOn(serverAdminClient, 'read')
      .mockResolvedValueOnce(result('status', { values: statusRows }))
      .mockReturnValueOnce(first.promise);
    mount();
    await screen.findByTestId('admin-table-status');
    await fireEvent.click(screen.getByTestId('admin-refresh'));
    expect(screen.getByTestId('admin-refresh')).toBeDisabled();
    expect(screen.getByTestId('admin-table-status')).toBeInTheDocument();
    first.resolve(result('status', { values: [statusRows[1]] }));
    await waitFor(() => expect(screen.getByTestId('admin-refresh')).not.toBeDisabled());
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('auto refresh is off by default and polls without overlapping when switched on', async () => {
    vi.spyOn(serverAdminClient, 'capabilities').mockResolvedValue(capabilities());
    const gate = deferred<ReturnType<typeof result>>();
    const read = vi
      .spyOn(serverAdminClient, 'read')
      .mockResolvedValueOnce(result('status', { values: statusRows }))
      .mockReturnValueOnce(gate.promise)
      .mockResolvedValue(result('status', { values: statusRows }));
    mount();
    await screen.findByTestId('admin-table-status');
    const toggle = screen.getByTestId('auto-refresh-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    vi.useFakeTimers({ shouldAdvanceTime: false });
    await fireEvent.click(toggle);
    await vi.advanceTimersByTimeAsync(60_000 - 1);
    expect(read).toHaveBeenCalledTimes(2); // only one poll started, still pending: no pile-up
    gate.resolve(result('status', { values: statusRows }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(read).toHaveBeenCalledTimes(3);
    await fireEvent.click(toggle);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(read).toHaveBeenCalledTimes(3);
  });
});
