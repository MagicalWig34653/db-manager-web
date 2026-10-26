// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import { emptyConnection } from '$lib/workbench';
import { batchClient, type Capabilities } from './client';
import BatchPanel from './BatchPanel.svelte';

const fixture = (name: string) =>
  JSON.parse(readFileSync(`src/lib/features/sql-batch/fixtures/${name}.json`, 'utf8'));
const props = {
  connection: { ...emptyConnection(), database: 'synthetic' },
  token: 'token-a',
  tab: 'sql-stapel',
  onsql: vi.fn(),
  onwritephase: vi.fn(),
};
const run = () => screen.getByRole('button', { name: 'Bestätigt ausführen' });
async function mount(overrides = {}) {
  vi.spyOn(batchClient, 'capabilities').mockResolvedValue(
    fixture('SQLBatchCapabilities.real-sqlite-http'),
  );
  const view = render(BatchPanel, { ...props, onwritephase: vi.fn(), ...overrides });
  await waitFor(() =>
    expect(screen.queryByText('Fähigkeiten werden geladen …')).not.toBeInTheDocument(),
  );
  await fireEvent.input(screen.getByLabelText('Vollständiger SQL-Text'), {
    target: { value: 'SELECT 1;' },
  });
  return view;
}
async function confirm() {
  for (const box of screen.getAllByRole('checkbox')) await fireEvent.click(box);
}
afterEach(() => vi.restoreAllMocks());

it('requires separate write consent even for SELECT and revokes consent on edit', async () => {
  const execute = vi.spyOn(batchClient, 'execute');
  await mount();
  expect(run()).toBeDisabled();
  await fireEvent.click(screen.getAllByRole('checkbox')[0]);
  expect(run()).toBeDisabled();
  await fireEvent.click(screen.getAllByRole('checkbox')[1]);
  expect(run()).toBeEnabled();
  await fireEvent.input(screen.getByLabelText('Vollständiger SQL-Text'), {
    target: { value: 'DELETE FROM synthetic;' },
  });
  expect(run()).toBeDisabled();
  expect(execute).not.toHaveBeenCalled();
  expect(screen.getByText(/EXPLAIN ANALYZE <DML>/)).toBeVisible();
});

it('requires renewed consent after changing action or limits', async () => {
  await mount();
  await confirm();
  await fireEvent.change(screen.getByLabelText('Aktion'), { target: { value: 'explain' } });
  expect(run()).toBeDisabled();
  expect(screen.getByText(/SQLite verwendet EXPLAIN QUERY PLAN/)).toBeVisible();
  await confirm();
  await fireEvent.input(screen.getByLabelText('Zeitlimit in Millisekunden (0: 10.000)'), {
    target: { value: '1000' },
  });
  expect(run()).toBeDisabled();
});

it('renders every statement, unknown affected count, server code and unknown status', async () => {
  vi.spyOn(batchClient, 'execute').mockImplementation(async (_a, _r, _t, _s, dispatch) => {
    dispatch();
    return fixture('SQLBatchResult.real-sqlite');
  });
  const report = vi.fn();
  await mount({ onwritephase: report });
  await confirm();
  await fireEvent.click(run());
  await waitFor(() => expect(screen.getAllByTestId('batch-statement')).toHaveLength(5));
  expect(screen.getAllByText(/unbekannt \(nicht als 0/).length).toBeGreaterThan(0);
  expect(screen.getByText(/Servercode: 19/)).toBeVisible();
  expect(report.mock.calls.flat()).toEqual(['sending', 'unknown']);
  expect(run()).toBeDisabled();
});

it('renders tagged values, duplicate names, empty text and hostile strings as plain text', async () => {
  const result = {
    statements: [
      {
        index: 1,
        outcome: 'completed' as const,
        duration_ms: 2,
        warnings: [{ code: 'notice', message: '<img src=x onerror=alert(1)>' }],
        results: [
          {
            columns: ['x', 'x', 'n'].map((name) => ({ name, database_type: 'TEXT' })),
            rows: [
              [
                { kind: 'text' as const, value: '<script>bad()</script>' },
                { kind: 'text' as const, value: '' },
                { kind: 'null' as const },
              ],
            ],
            truncated: true,
          },
        ],
      },
    ],
    duration_ms: 3,
  };
  vi.spyOn(batchClient, 'execute').mockImplementation(async (_a, _r, _t, _s, dispatch) => {
    dispatch();
    return result;
  });
  const { container } = await mount();
  await confirm();
  await fireEvent.click(run());
  await screen.findByText('<script>bad()</script>');
  expect(container.querySelector('script, img')).toBeNull();
  expect(screen.getByText('""')).toBeVisible();
  expect(screen.getByText('NULL')).toBeVisible();
  expect(screen.getByText(/Ergebnis abgeschnitten/)).toBeVisible();
});

it.each(['mysql', 'postgresql'] as const)(
  'disables simulation for %s and shows the backend reason',
  async (driver) => {
    const execute = vi.spyOn(batchClient, 'execute');
    await mount({ connection: { ...props.connection, driver } });
    await fireEvent.change(screen.getByLabelText('Aktion'), { target: { value: 'simulate' } });
    expect(screen.getByTestId('simulation-unsupported')).toHaveTextContent('nicht unterstützt');
    expect(screen.getByTestId('simulation-unsupported')).toHaveTextContent(
      driver === 'mysql' ? 'Engine-, Trigger-' : 'Sequenzen',
    );
    expect(run()).toBeDisabled();
    expect(execute).not.toHaveBeenCalled();
  },
);

it('runs SQLite simulation only through simulate and displays rollback and warnings', async () => {
  const execute = vi
    .spyOn(batchClient, 'execute')
    .mockImplementation(async (_a, _r, _t, _s, dispatch) => {
      dispatch();
      return fixture('SQLSimulationResult.real-sqlite');
    });
  await mount();
  await fireEvent.change(screen.getByLabelText('Aktion'), { target: { value: 'simulate' } });
  await fireEvent.input(screen.getByLabelText('Vollständiger SQL-Text'), {
    target: { value: 'UPDATE synthetic SET x=2;' },
  });
  await confirm();
  await fireEvent.click(run());
  await waitFor(() =>
    expect(screen.getByTestId('simulation-result')).toHaveAttribute('data-outcome', 'rolled_back'),
  );
  expect(execute.mock.calls[0][0]).toBe('simulate');
});

it('aborts and discards data and draft when the token changes', async () => {
  let resolve!: (value: { statements: []; duration_ms: number }) => void;
  let signal!: AbortSignal;
  vi.spyOn(batchClient, 'execute').mockImplementation((_a, _r, _t, s, dispatch) => {
    signal = s;
    dispatch();
    return new Promise((r) => {
      resolve = r;
    });
  });
  const report = vi.fn();
  const view = await mount({ onwritephase: report });
  await confirm();
  await fireEvent.click(run());
  expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeEnabled();
  await view.rerender({ ...props, token: 'token-b', onwritephase: report });
  expect(signal.aborted).toBe(true);
  resolve({ statements: [], duration_ms: 0 });
  await waitFor(() => expect(screen.queryByText('Dauer: 0 ms')).not.toBeInTheDocument());
  expect(screen.getByLabelText('Vollständiger SQL-Text')).toHaveValue('');
  expect(run()).toBeDisabled();
  expect(report.mock.calls.flat()).toEqual(['sending', 'unknown']);
});

it('aborts on unmount and ends the outstanding write exactly once', async () => {
  vi.spyOn(batchClient, 'execute').mockImplementation((_a, _r, _t, _s, dispatch) => {
    dispatch();
    return new Promise(() => {});
  });
  const report = vi.fn();
  const view = await mount({ onwritephase: report });
  await confirm();
  await fireEvent.click(run());
  view.unmount();
  await waitFor(() => expect(report.mock.calls.flat()).toEqual(['sending', 'unknown']));
});

it('fails closed when capabilities are absent', async () => {
  vi.spyOn(batchClient, 'capabilities').mockRejectedValue(new Error('private'));
  render(BatchPanel, props);
  await screen.findByText(/Diese Instanz bietet SQL-Stapel/);
  expect(run()).toBeDisabled();
});

it('fails closed when the driver entry is absent', async () => {
  const caps = fixture('SQLBatchCapabilities.real-sqlite-http') as Capabilities;
  caps.drivers = [];
  vi.spyOn(batchClient, 'capabilities').mockResolvedValue(caps);
  render(BatchPanel, props);
  await waitFor(() =>
    expect(screen.queryByText('Fähigkeiten werden geladen …')).not.toBeInTheDocument(),
  );
  expect(run()).toBeDisabled();
});

it.each(['database', 'table'] as const)(
  'uses the %s Session receiver and honors an existing write lock',
  async (slot) => {
    const { Session } = await import('$lib/shell/session.svelte');
    const { default: Host } = await import('./testing/Host.svelte');
    const session = new Session({ onConnected() {}, onCatalogSettled() {}, onCleared() {} });
    const object = { name: 'synthetic', schema: 'main', type: 'table' };
    const receiver =
      slot === 'table'
        ? session.writeReceiver(object, session.sessionVersion)
        : session.databaseWriteReceiver(session.sessionVersion);
    vi.spyOn(batchClient, 'capabilities').mockResolvedValue(
      fixture('SQLBatchCapabilities.real-sqlite-http'),
    );
    vi.spyOn(batchClient, 'execute').mockImplementation((_a, _r, _t, _s, dispatch) => {
      dispatch();
      return new Promise(() => {});
    });
    render(Host, {
      ...props,
      session,
      object: slot === 'table' ? object : undefined,
      onwritephase: receiver,
    });
    await waitFor(() =>
      expect(screen.queryByText('Fähigkeiten werden geladen …')).not.toBeInTheDocument(),
    );
    await fireEvent.input(screen.getByLabelText('Vollständiger SQL-Text'), {
      target: { value: 'SELECT 1;' },
    });
    await confirm();
    receiver('sending');
    await waitFor(() => expect(run()).toBeDisabled());
    receiver('settled');
    await waitFor(() => expect(run()).toBeEnabled());
    await fireEvent.click(run());
    expect(session.writeInFlight).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: /^Abbrechen$/ }));
    await waitFor(() => expect(session.writeInFlight).toBe(false));
    expect(session.writeNotice).toBe(true);
    session.destroy();
  },
);
