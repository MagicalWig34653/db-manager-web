// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api';
import { emptyConnection } from '$lib/workbench';
import { monitorClient } from './client';
import { capabilities, result } from './testing';
import MonitorTab from './MonitorTab.svelte';

const base = { ...emptyConnection(), database: 'app', host: 'h', username: 'u' };
function mount(driver: 'mysql' | 'postgresql' | 'sqlite' = 'mysql') {
  return render(MonitorTab, {
    connection: { ...base, driver },
    token: 'tok',
    tab: 'monitor',
    onsql: () => {},
    onwritephase: () => {},
  });
}
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const sampleAt = (seconds: number, over: Record<string, string> = {}) =>
  result(
    'sample',
    [{ uptime: String(100 + seconds), questions: String(1000 + seconds * 50), ...over }],
    {
      sampled_at: new Date(Date.UTC(2026, 9, 27, 9, 0, seconds)).toISOString(),
    },
  );
async function openTab(name: string | RegExp) {
  await fireEvent.click(await screen.findByRole('tab', { name }));
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('MonitorTab', () => {
  it('shows the sample with large counters intact and the read-only statement', async () => {
    vi.spyOn(monitorClient, 'capabilities').mockResolvedValue(capabilities());
    const run = vi
      .spyOn(monitorClient, 'run')
      .mockResolvedValue(
        result('sample', [{ questions: '12345678901234567890', threads_running: '3' }]),
      );
    mount();
    const facts = await screen.findByTestId('sample-facts');
    expect(facts).toHaveTextContent('12.345.678.901.234.567.890');
    expect(screen.getByTestId('monitor-readonly')).toHaveTextContent('Nur lesend');
    expect(screen.getByTestId('monitor-meta')).toHaveTextContent('SHOW GLOBAL STATUS');
    expect(run.mock.calls[0][0]).toBe('sample');
    expect(screen.getByTestId('monitor-limited')).toHaveTextContent('Rechten');
  });

  it('computes rates from two samples and starts over after a counter reset', async () => {
    vi.spyOn(monitorClient, 'capabilities').mockResolvedValue(capabilities());
    vi.spyOn(monitorClient, 'run')
      .mockResolvedValueOnce(sampleAt(0))
      .mockResolvedValueOnce(sampleAt(10))
      .mockResolvedValueOnce(sampleAt(20, { uptime: '3', questions: '5' }));
    mount();
    await screen.findByTestId('rates-first');
    await fireEvent.click(screen.getByTestId('monitor-refresh'));
    const rate = await screen.findByTestId('rate-questions');
    expect(rate).toHaveTextContent('50 / s');
    expect(screen.getByTestId('sparkline')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Verlauf'),
    );
    await waitFor(() => expect(screen.getByTestId('monitor-refresh')).not.toBeDisabled());
    await fireEvent.click(screen.getByTestId('monitor-refresh'));
    expect(await screen.findByTestId('rates-reset')).toBeInTheDocument();
    expect(screen.queryByTestId('rate-questions')).toBeNull();
  });

  it('distinguishes an unavailable source from an error', async () => {
    vi.spyOn(monitorClient, 'capabilities').mockResolvedValue(capabilities());
    vi.spyOn(monitorClient, 'run').mockImplementation(async (action) =>
      action === 'sample'
        ? result('sample', [{ questions: '1' }])
        : result(action, [], {
            state: 'unavailable',
            source: 'none',
            reason: 'performance_schema ist deaktiviert <b>x</b>.',
          }),
    );
    const { container } = mount();
    await screen.findByTestId('sample-facts');
    await openTab('Abfrageanalyse');
    const box = await screen.findByTestId('monitor-unavailable');
    expect(box).toHaveTextContent('Quelle nicht verfügbar');
    expect(screen.getByTestId('monitor-unavailable-reason')).toHaveTextContent('<b>x</b>');
    expect(container.querySelector('b')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows login, rights and statement problems as errors, not as unavailable', async () => {
    vi.spyOn(monitorClient, 'capabilities').mockResolvedValue(capabilities());
    vi.spyOn(monitorClient, 'run').mockImplementation(async (action) => {
      if (action === 'sample') return result('sample', [{ questions: '1' }]);
      throw new ApiError('database_error', 'Anmeldung fehlgeschlagen.');
    });
    mount();
    await screen.findByTestId('sample-facts');
    await openTab('Replikation');
    expect(await screen.findByRole('alert')).toHaveTextContent('Anmeldung fehlgeschlagen');
    expect(screen.queryByTestId('monitor-unavailable')).toBeNull();
    expect(screen.queryByTestId('monitor-empty')).toBeNull();
  });

  it('warns that an empty replication list proves nothing', async () => {
    vi.spyOn(monitorClient, 'capabilities').mockResolvedValue(capabilities());
    vi.spyOn(monitorClient, 'run').mockImplementation(async (action) => result(action));
    mount();
    await openTab('Replikation');
    expect(await screen.findByTestId('monitor-empty')).toHaveTextContent('kein Beweis');
  });

  it('lists unknown values as unknown and records as text, with paging', async () => {
    vi.spyOn(monitorClient, 'capabilities').mockResolvedValue(capabilities());
    const run = vi
      .spyOn(monitorClient, 'run')
      .mockImplementation(async (action, _c, _t, query) =>
        action === 'sample'
          ? result('sample', [{ questions: '1' }])
          : result(
              action,
              [
                { digest: 'abcdef0123456789', calls: '1234', total_seconds: '2.5' },
                { digest: '1234567890123456' },
              ],
              { has_more: (query?.offset ?? 0) === 0, offset: query?.offset ?? 0 },
            ),
      );
    mount();
    await screen.findByTestId('sample-facts');
    await openTab('Abfrageanalyse');
    const table = await screen.findByTestId('monitor-table');
    expect(table).toHaveTextContent('1.234');
    expect(table).toHaveTextContent('1234567890123456'); // identifiers are never regrouped
    expect(within(table).getAllByLabelText('unbekannt').length).toBeGreaterThan(0);
    await fireEvent.click(screen.getByTestId('monitor-next'));
    await waitFor(() =>
      expect(run.mock.calls.at(-1)?.[3]).toMatchObject({ offset: 50, limit: 50 }),
    );
  });

  it('shows advisor hints with rule, threshold and observed value', async () => {
    vi.spyOn(monitorClient, 'capabilities').mockResolvedValue(capabilities());
    vi.spyOn(monitorClient, 'run').mockImplementation(async (action) =>
      action === 'advisor'
        ? result('advisor', [{ threads_running: '40' }], {
            hints: [
              {
                rule: 'w-p27/threads_running > 32',
                source: 'global_status',
                metric: 'threads_running',
                threshold: '32',
                observed: '40',
                message: 'Viele laufende Threads.',
              },
            ],
          })
        : result('sample', [{ questions: '1' }]),
    );
    mount();
    await openTab('Hinweise');
    const hints = await screen.findByTestId('monitor-hints');
    expect(hints).toHaveTextContent('Viele laufende Threads.');
    expect(hints).toHaveTextContent('Schwelle 32');
  });

  it('explains unsupported actions per driver and sends no request for them', async () => {
    vi.spyOn(monitorClient, 'capabilities').mockResolvedValue(capabilities());
    const run = vi
      .spyOn(monitorClient, 'run')
      .mockResolvedValue(result('sample', [{ version: '3.46.0' }], { driver: 'sqlite' }));
    mount('sqlite');
    await screen.findByTestId('sample-facts');
    await openTab('Replikation');
    expect(await screen.findByText('sqlite bietet replication nicht an.')).toBeInTheDocument();
    await openTab('Binärlogs');
    await screen.findByText('sqlite bietet binary-logs nicht an.');
    await openTab(/Profiling/);
    expect(screen.queryByTestId('profiling-sql')).toBeNull();
    expect(run.mock.calls.map((call) => call[0])).toEqual(['sample']);
  });

  it('opens binary log events for a chosen log and validates the start position', async () => {
    vi.spyOn(monitorClient, 'capabilities').mockResolvedValue(capabilities());
    const run = vi.spyOn(monitorClient, 'run').mockImplementation(async (action) => {
      if (action === 'binary-logs')
        return result('binary-logs', [
          { log_name: 'bin.000001', file_size: '1024', encrypted: 'No' },
          { log_name: 'bin.000002', file_size: '4096', encrypted: 'No' },
        ]);
      if (action === 'binary-events')
        return result('binary-events', [{ pos: '4', event_type: 'Format_desc', server_id: '1' }], {
          source: 'binlog_events',
        });
      return result('sample', [{ questions: '1' }]);
    });
    mount();
    await openTab('Binärlogs');
    const buttons = await screen.findAllByTestId('open-events');
    await fireEvent.click(buttons[1]);
    const events = await screen.findByTestId('binlog-events');
    await within(events).findByTestId('monitor-table');
    expect(run.mock.calls.at(-1)).toEqual([
      'binary-events',
      expect.anything(),
      'tok',
      expect.objectContaining({ log: 'bin.000002', position: 0, limit: 50 }),
      expect.anything(),
    ]);
    await fireEvent.input(screen.getByTestId('binlog-position'), { target: { value: '-1' } });
    expect(screen.getByRole('button', { name: 'Ereignisse laden' })).toBeDisabled();
  });

  it('runs EXPLAIN only after an explicit click and caps the SQL size', async () => {
    vi.spyOn(monitorClient, 'capabilities').mockResolvedValue(capabilities());
    const run = vi.spyOn(monitorClient, 'run').mockImplementation(async (action) =>
      action === 'profiling'
        ? result('profiling', [{ id: '1', type: 'ALL', rows: '10', filtered: '100.00' }], {
            source: 'explain',
          })
        : result('sample', [{ questions: '1' }]),
    );
    mount();
    await screen.findByTestId('sample-facts');
    await openTab(/Profiling/);
    const sql = await screen.findByTestId('profiling-sql');
    expect(run.mock.calls.some(([action]) => action === 'profiling')).toBe(false);
    expect(screen.getByTestId('profiling-run')).toBeDisabled();
    await fireEvent.input(sql, { target: { value: 'SELECT a FROM t LIMIT 5' } });
    await fireEvent.click(screen.getByTestId('profiling-run'));
    await screen.findByTestId('monitor-table');
    const call = run.mock.calls.find(([action]) => action === 'profiling')!;
    expect(call[3]).toMatchObject({ sql: 'SELECT a FROM t LIMIT 5' });
    await fireEvent.input(sql, { target: { value: 'x'.repeat(16385) } });
    expect(screen.getByTestId('profiling-run')).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('16384');
  });

  it('auto refresh is opt-in, never overlaps and stops on an authorization error', async () => {
    vi.spyOn(monitorClient, 'capabilities').mockResolvedValue(capabilities());
    const gate = deferred<ReturnType<typeof result>>();
    const run = vi
      .spyOn(monitorClient, 'run')
      .mockResolvedValueOnce(sampleAt(0))
      .mockReturnValueOnce(gate.promise)
      .mockRejectedValueOnce(new ApiError('unauthorized', 'Token abgewiesen.'));
    mount();
    await screen.findByTestId('sample-facts');
    const toggle = screen.getByTestId('auto-refresh-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    vi.useFakeTimers();
    await fireEvent.click(toggle);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(run).toHaveBeenCalledTimes(2);
    gate.resolve(sampleAt(10));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(run).toHaveBeenCalledTimes(3);
    expect(toggle.checked).toBe(false);
    expect(screen.getByTestId('auto-refresh-status')).toHaveTextContent('abgewiesen');
  });

  it('pauses auto refresh while the page is hidden', async () => {
    vi.spyOn(monitorClient, 'capabilities').mockResolvedValue(capabilities());
    const run = vi.spyOn(monitorClient, 'run').mockImplementation(async () => sampleAt(0));
    mount();
    await screen.findByTestId('sample-facts');
    vi.useFakeTimers();
    await fireEvent.click(screen.getByTestId('auto-refresh-toggle'));
    let visibility: DocumentVisibilityState = 'hidden';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('auto-refresh-status')).toHaveTextContent('Pausiert');
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('reports a backend without the monitor API', async () => {
    vi.spyOn(monitorClient, 'capabilities').mockRejectedValue(
      new ApiError('not_found', 'Das Backend bietet den Monitor (API 0.20) nicht an.'),
    );
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('nicht an');
  });

  it('tells the user when the backend reports the monitor as not available', async () => {
    vi.spyOn(monitorClient, 'capabilities').mockResolvedValue(capabilities({ available: false }));
    const run = vi.spyOn(monitorClient, 'run');
    mount();
    expect(
      await screen.findByText('Das Backend meldet den Monitor als nicht verfügbar.'),
    ).toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
  });
});
