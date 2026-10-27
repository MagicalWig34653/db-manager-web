// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import { tables } from '$lib/tables';
import { emptyConnection } from '$lib/workbench';
import { importClient } from './client';
import ImportPanel from './ImportPanel.svelte';
import type { Job } from './model';

const fixture = (name: string) =>
  JSON.parse(readFileSync(`src/lib/features/import/fixtures/${name}.json`, 'utf8'));
const props = {
  connection: { ...emptyConnection(), database: 'synthetic' },
  token: 'token-a',
  tab: 'import',
  onsql: vi.fn(),
};
const description = {
  table: { schema: 'main', name: 'p12_rows' },
  kind: 'table',
  columns: [
    {
      name: 'id',
      database_type: 'INTEGER',
      nullable: false,
      pk_position: 1,
      generated: 'none',
      read_only: false,
    },
    {
      name: 'value',
      database_type: 'TEXT',
      nullable: true,
      pk_position: 0,
      generated: 'none',
      read_only: false,
    },
    {
      name: 'calc',
      database_type: 'TEXT',
      nullable: true,
      pk_position: 0,
      generated: 'stored',
      read_only: true,
    },
  ],
  primary_key: ['id'],
  transactional: 'yes',
  stable_order: true,
  storage_engine: '',
};
const id = 'a'.repeat(32);
const job = (state: 'running' | 'finished', result?: unknown, processed = 0): Job =>
  ({
    id,
    state,
    cancel_requested: false,
    progress: { processed, total: 3 },
    ...(result ? { result } : {}),
  }) as Job;

async function mount(extra: Record<string, unknown> = {}) {
  vi.spyOn(importClient, 'capabilities').mockResolvedValue(fixture('ImportCapabilities.real-http'));
  vi.spyOn(tables, 'describe').mockResolvedValue(description as never);
  const onwritephase = vi.fn();
  const view = render(ImportPanel, { ...props, onwritephase, ...extra });
  await waitFor(() => expect(screen.queryByText(/Importfähigkeiten werden geladen/)).toBeNull());
  return { view, onwritephase };
}
async function pick(name = 'dump.sql', content = 'SELECT 1;') {
  const input = screen.getByTestId('import-file') as HTMLInputElement;
  const file = new File([content], name, { type: 'text/plain' });
  await fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(screen.getByTestId('import-file-info')).toBeVisible());
  return file;
}
const object = { name: 'p12_rows', schema: 'main', type: 'table' };
afterEach(() => vi.restoreAllMocks());

it('SQL: warns before anything, needs the file name, sends once and shows every statement state', async () => {
  const execute = vi.spyOn(importClient, 'execute').mockImplementation(async (_m, _f, _t, h) => {
    h.onDispatch();
    h.onUploaded();
    return job('running');
  });
  vi.spyOn(importClient, 'status').mockResolvedValue(
    job('finished', fixture('ImportResult.real-sqlite-sql')),
  );
  const { onwritephase } = await mount();
  expect(screen.getByTestId('import-sql-warning')).toHaveTextContent(
    'führt beliebiges SQL ohne Plan aus',
  );
  expect(screen.getByTestId('import-sql-warning')).toHaveTextContent('DDL, DROP/TRUNCATE, DELETE');
  const start = screen.getByTestId('import-sql-start');
  expect(start).toBeDisabled();
  await pick('<img src=x onerror=alert(1)>.sql');
  expect(screen.getByTestId('import-file-info')).toHaveTextContent(
    '<img src=x onerror=alert(1)>.sql',
  );
  expect(document.querySelector('img[src="x"]')).toBeNull();
  await fireEvent.click(start);
  const run = await screen.findByRole('button', { name: 'SQL jetzt ausführen' });
  expect(run).toBeDisabled();
  await fireEvent.input(screen.getByLabelText(/Gib .*ein|Name/i, { selector: 'input' }), {
    target: { value: '<img src=x onerror=alert(1)>.sql' },
  });
  expect(run).toBeEnabled();
  await fireEvent.click(run);
  await fireEvent.click(run);
  await waitFor(() => expect(screen.getByTestId('import-result')).toBeVisible());
  expect(execute).toHaveBeenCalledTimes(1);
  const body = execute.mock.calls[0][0];
  expect(body).toMatchObject({ format: 'sql', confirm: { action: 'import_sql' }, mode: 'stop' });
  expect(body).not.toHaveProperty('expected_plan_sha256');
  expect(screen.getAllByTestId('import-statement')).toHaveLength(4);
  expect(screen.getByTestId('import-unknown')).toHaveTextContent('Nicht erneut senden');
  expect(screen.getByTestId('import-warnings')).toHaveTextContent('Anweisungsabschluss');
  expect(onwritephase.mock.calls.flat()).toEqual(['sending', 'unknown']);
  expect(screen.getByTestId('import-sql-start')).toBeDisabled();
});

it('SQL: renders rolled_back and not_executed statements', async () => {
  vi.spyOn(importClient, 'execute').mockImplementation(async (_m, _f, _t, h) => {
    h.onDispatch();
    h.onUploaded();
    return job('finished', fixture('ImportResult.real-sqlite-rollback'));
  });
  await mount();
  await pick();
  await fireEvent.click(screen.getByTestId('import-sql-start'));
  await fireEvent.input(await screen.findByRole('textbox', { name: /dump\.sql/ }), {
    target: { value: 'dump.sql' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'SQL jetzt ausführen' }));
  await waitFor(() => expect(screen.getByTestId('import-result')).toBeVisible());
  expect(
    screen.getAllByTestId('import-statement').some((row) => row.dataset.outcome === 'rolled_back'),
  ).toBe(true);
  expect(screen.getByTestId('import-counts')).toHaveTextContent('Ausgeführt, aber zurückgerollt');
});

it('SQL: a failed upload that was never sent stays retryable but a network loss after dispatch is unknown', async () => {
  vi.spyOn(importClient, 'execute').mockImplementation(async (_m, _f, _t, h) => {
    h.onDispatch();
    throw new (await import('$lib/api')).ApiError('network_error', 'x');
  });
  const { onwritephase } = await mount();
  await pick();
  await fireEvent.click(screen.getByTestId('import-sql-start'));
  await fireEvent.input(await screen.findByRole('textbox', { name: /dump\.sql/ }), {
    target: { value: 'dump.sql' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'SQL jetzt ausführen' }));
  await waitFor(() => expect(screen.getByTestId('import-error')).toBeVisible());
  expect(screen.getByTestId('import-error')).toHaveTextContent('Nicht erneut senden');
  expect(onwritephase.mock.calls.flat()).toEqual(['sending', 'unknown']);
  expect(screen.getByTestId('import-new')).toBeVisible();
});

it('rejects an oversized or empty file before upload', async () => {
  await mount();
  const input = screen.getByTestId('import-file') as HTMLInputElement;
  const empty = new File([], 'empty.sql');
  await fireEvent.change(input, { target: { files: [empty] } });
  expect(await screen.findByText('Die Datei ist leer.')).toBeVisible();
  expect(screen.getByTestId('import-sql-start')).toBeDisabled();
  const big = new File(['x'], 'big.sql');
  Object.defineProperty(big, 'size', { value: 64 * 1024 * 1024 + 1 });
  await fireEvent.change(input, { target: { files: [big] } });
  expect(await screen.findByText(/größer als das erlaubte Limit/)).toBeVisible();
  expect(screen.getByTestId('import-sql-start')).toBeDisabled();
});

it('CSV: plans, blocks on errors in stop mode, executes once and spends the plan', async () => {
  const plan = fixture('ImportPlan.real-TestSQLiteImportRoundTrip');
  const bad = {
    ...plan,
    rows: 4,
    errors: [{ row: 2, column: 1, code: 'invalid_integer' }],
  };
  const planSpy = vi.spyOn(importClient, 'plan').mockResolvedValueOnce(bad).mockResolvedValue(plan);
  const execute = vi.spyOn(importClient, 'execute').mockImplementation(async (_m, _f, _t, h) => {
    h.onDispatch();
    h.onUploaded();
    return job('finished', fixture('ImportResult.real-TestSQLiteImportRoundTrip'));
  });
  const { onwritephase } = await mount({ object });
  expect(screen.getByDisplayValue('id')).toBeVisible();
  expect(screen.queryByDisplayValue('calc')).toBeNull();
  await pick('rows.csv', 'id,value\n1,a\n');
  await waitFor(() => expect(screen.getByTestId('csv-header-peek')).toBeVisible());
  await fireEvent.click(screen.getByTestId('import-plan'));
  await waitFor(() => expect(screen.getByTestId('import-plan-view')).toBeVisible());
  expect(screen.getByTestId('import-plan-issues')).toHaveTextContent('Zeile 2, Spalte 1');
  expect(screen.getByTestId('import-plan-blocked')).toBeVisible();
  expect(screen.getByTestId('import-csv-start')).toBeDisabled();
  expect(planSpy.mock.calls[0][0]).toMatchObject({
    format: 'csv',
    csv: { columns: ['id', 'value'], header: true },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Plan verwerfen und Optionen ändern' }));
  await fireEvent.click(screen.getByTestId('import-plan'));
  await waitFor(() => expect(screen.queryByTestId('import-plan-blocked')).toBeNull());
  expect(screen.getByTestId('import-preview')).toBeVisible();
  const start = screen.getByTestId('import-csv-start');
  expect(start).toBeEnabled();
  await fireEvent.click(start);
  const run = await screen.findByRole('button', { name: 'Jetzt einfügen' });
  await fireEvent.input(screen.getByRole('textbox', { name: /main\.p12_rows/ }), {
    target: { value: 'main.p12_rows' },
  });
  await fireEvent.click(run);
  await fireEvent.click(run);
  await waitFor(() => expect(screen.getByTestId('import-result')).toBeVisible());
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls[0][0]).toMatchObject({
    format: 'csv',
    expected_plan_sha256: plan.plan_sha256,
    confirm: { action: 'import_csv' },
    table: { schema: 'main', name: 'p12_rows' },
  });
  expect(screen.getByTestId('import-plan-consumed')).toBeVisible();
  expect(screen.queryByTestId('import-csv-start')).toBeNull();
  expect(onwritephase.mock.calls.flat()).toEqual(['sending', 'settled']);
  // A fresh preview is possible and necessary.
  expect(screen.getByTestId('import-plan')).toHaveTextContent('Neue Vorschau erstellen');
  expect(screen.getByTestId('import-plan')).toBeEnabled();
});

it('CSV: reports invalid options and a table that is not importable', async () => {
  await mount({ object });
  await pick('rows.csv', 'id,value\n');
  await fireEvent.input(screen.getByTestId('csv-separator'), { target: { value: '\\' } });
  expect(await screen.findByTestId('import-option-error')).toHaveTextContent('Trennzeichen');
  expect(screen.getByTestId('import-plan')).toBeDisabled();
});

it('shows a capability notice when the instance has no import', async () => {
  vi.spyOn(importClient, 'capabilities').mockRejectedValue(new Error('x'));
  render(ImportPanel, { ...props, onwritephase: vi.fn() });
  expect(
    await screen.findByText('Der Import ist auf dieser Instanz nicht verfügbar.'),
  ).toBeVisible();
  expect(screen.getByTestId('import-sql-start')).toBeDisabled();
});
