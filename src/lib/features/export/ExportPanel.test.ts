// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyConnection } from '$lib/workbench';
import ExportPanel from './ExportPanel.svelte';

const capabilities = {
  contract_version: '0.11.0',
  available: true,
  formats: ['sql', 'csv', 'excel-csv', 'json'],
  charsets: ['utf-8', 'utf-8-bom'],
  drivers: [
    {
      driver: 'sqlite',
      snapshot: 'exclusive_local_transaction',
      sql_server: false,
      state: 'limited',
      reason: 'Eingeschränkter Dump.',
    },
    {
      driver: 'mysql',
      snapshot: 'repeatable_read_innodb_only',
      sql_server: true,
      state: 'limited',
      reason: 'x',
    },
    {
      driver: 'postgres',
      snapshot: 'repeatable_read',
      sql_server: false,
      state: 'limited',
      reason: 'y',
    },
  ],
  default_max_bytes: 67108864,
  max_bytes: 1073741824,
  default_max_rows: 1000000,
  max_rows: 10000000,
  default_timeout_ms: 60000,
  max_timeout_ms: 300000,
  max_tables: 100,
  max_request_bytes: 1048576,
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const props = {
  connection: { ...emptyConnection(), database: 'synthetic' },
  token: 'tok',
  tab: 'export',
  onsql: () => {},
  onwritephase: () => {},
};
const table = { name: 'orders', schema: 'main', type: 'table' };
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

let downloads: string[];
beforeEach(() => {
  downloads = [];
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push(this.download);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(exportBody: () => Response | Promise<Response>) {
  const calls: { url: string; body?: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/capabilities')) return json(capabilities);
      return exportBody();
    }),
  );
  return calls;
}
const stream = (text: string) =>
  new Response(text, { headers: { 'Content-Disposition': 'attachment; filename="export.sql"' } });

async function ready() {
  render(ExportPanel, { ...props, object: table });
  await waitFor(() => expect(screen.getByTestId('driver-reason')).toBeVisible());
}

describe('ExportPanel', () => {
  it('shows a preview of the effective settings and starts disabled without a selection', async () => {
    stubFetch(() => stream(''));
    render(ExportPanel, props);
    await waitFor(() =>
      expect(screen.getByTestId('driver-reason')).toHaveTextContent('Eingeschränkter Dump.'),
    );
    expect(screen.getByTestId('start')).toBeDisabled();
    expect(screen.getByTestId('problems')).toHaveTextContent('Tabelle');
    expect(screen.getByTestId('memory-hint')).toBeVisible();
  });

  it('offers the download only after a complete stream', async () => {
    const calls = stubFetch(() => stream('CREATE TABLE t(a);\n-- DBMANAGER EXPORT COMPLETE\n'));
    await ready();
    expect(screen.getByTestId('preview')).toHaveTextContent('SQL-Dump');
    await fireEvent.click(screen.getByTestId('start'));
    await waitFor(() => expect(screen.getByTestId('export-done')).toBeVisible());
    expect(downloads).toEqual(['export.sql']);
    const post = calls.find((c) => c.url === '/api/v11/export')!;
    expect(post.body).toMatchObject({
      scope: 'tables',
      tables: [{ schema: 'main', name: 'orders' }],
    });
    expect(JSON.stringify(calls)).not.toContain('tok');
  });

  it('reports a 200 stream without closing marker as faulty and offers no file', async () => {
    stubFetch(() => stream('CREATE TABLE t(a);\nINSERT INTO t VALUES (1);\n'));
    await ready();
    await fireEvent.click(screen.getByTestId('start'));
    await waitFor(() => expect(screen.getByTestId('incomplete-hint')).toBeVisible());
    expect(screen.getByRole('alert')).toHaveTextContent('unvollständig');
    expect(screen.queryByTestId('export-done')).toBeNull();
    expect(downloads).toEqual([]);
  });

  it('explains 503 export_busy', async () => {
    stubFetch(() => json({ error: { code: 'export_busy', message: 'x' } }, 503));
    await ready();
    await fireEvent.click(screen.getByTestId('start'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('zwei Exporte'));
    expect(downloads).toEqual([]);
  });

  it('cancels a running export and keeps no file', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/capabilities')) return json(capabilities);
        signal = init?.signal as AbortSignal;
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new TextEncoder().encode('CREATE'));
          },
        });
        return new Response(body, {
          headers: { 'Content-Disposition': 'attachment; filename="export.sql"' },
        });
      }),
    );
    await ready();
    await fireEvent.click(screen.getByTestId('start'));
    await waitFor(() => expect(screen.getByTestId('cancel')).toBeVisible());
    await flush();
    await fireEvent.click(screen.getByTestId('cancel'));
    await waitFor(() => expect(screen.getByTestId('export-canceled')).toBeVisible());
    expect(signal?.aborted).toBe(true);
    expect(downloads).toEqual([]);
  });

  it('aborts and discards a late answer when the token changes', async () => {
    let finish!: (r: Response) => void;
    stubFetch(() => new Promise<Response>((resolve) => (finish = resolve)));
    const view = render(ExportPanel, { ...props, object: table });
    await waitFor(() => expect(screen.getByTestId('driver-reason')).toBeVisible());
    await fireEvent.click(screen.getByTestId('start'));
    await waitFor(() => expect(screen.getByTestId('cancel')).toBeVisible());
    await view.rerender({ ...props, object: table, token: 'other' });
    finish(stream('CREATE TABLE t(a);\n-- DBMANAGER EXPORT COMPLETE\n'));
    await flush();
    expect(screen.queryByTestId('export-done')).toBeNull();
    expect(downloads).toEqual([]);
    expect(screen.getByTestId('export-status')).toHaveAttribute('data-phase', 'idle');
  });

  it('opens only one save dialog on a double click and explains a rejected query', async () => {
    const picker = vi.fn(() => new Promise(() => undefined));
    vi.stubGlobal('showSaveFilePicker', picker);
    (window as unknown as Record<string, unknown>).showSaveFilePicker = picker;
    stubFetch(() => stream(''));
    await ready();
    const start = screen.getByTestId('start');
    await fireEvent.click(start);
    await fireEvent.click(start);
    expect(picker).toHaveBeenCalledTimes(1);
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });

  it('names the reason when a write query is rejected', async () => {
    stubFetch(() => json({ error: { code: 'invalid_export', message: 'x' } }, 400));
    await ready();
    await fireEvent.click(screen.getByLabelText('Ergebnis einer Abfrage'));
    await fireEvent.input(screen.getByTestId('query-sql'), { target: { value: 'delete from t' } });
    await fireEvent.click(screen.getByTestId('start'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('nur lesende'));
  });
});
