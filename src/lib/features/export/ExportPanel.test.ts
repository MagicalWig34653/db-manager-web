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
const capabilities21 = {
  contract_version: '0.21.0',
  available: true,
  formats: [
    'sql',
    'csv',
    'excel-csv',
    'json',
    'xml',
    'yaml',
    'php-array',
    'latex',
    'latex-longtable',
    'mediawiki',
    'texy',
    'codegen',
  ],
  drivers: [
    {
      driver: 'sqlite',
      state: 'limited',
      views_as_tables: true,
      definer: ['omit'],
      compatibility: ['native', 'data-only'],
      data_statements: ['insert', 'insert-ignore', 'replace'],
      reason: 'Eingeschränkter Dump.',
    },
    {
      driver: 'mysql',
      state: 'limited',
      views_as_tables: true,
      definer: ['omit'],
      compatibility: ['native', 'data-only'],
      data_statements: ['insert', 'insert-ignore', 'replace'],
      reason: 'x',
    },
    {
      driver: 'postgres',
      state: 'limited',
      views_as_tables: true,
      definer: ['omit'],
      compatibility: ['native', 'data-only'],
      data_statements: ['insert'],
      reason: 'y',
    },
  ],
  max_bytes: 1073741824,
  max_rows: 10000000,
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

function stubFetch(exportBody: () => Response | Promise<Response>, api: 'v21' | 'v11' = 'v21') {
  const calls: { url: string; body?: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === '/api/v21/capabilities')
        return api === 'v21' ? json(capabilities21) : json({ error: { code: 'not_found' } }, 404);
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
    const post = calls.find((c) => c.url === '/api/v21/export')!;
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

  it('explains 503 export_busy and allows a new start (nothing was written)', async () => {
    let answers = 0;
    stubFetch(() =>
      ++answers === 1
        ? json({ error: { code: 'export_busy', message: 'x' } }, 503)
        : stream('CREATE TABLE t(a);\n-- DBMANAGER EXPORT COMPLETE\n'),
    );
    await ready();
    await fireEvent.click(screen.getByTestId('start'));
    await waitFor(() =>
      expect(screen.getByTestId('export-busy')).toHaveTextContent('zwei Exporte'),
    );
    expect(downloads).toEqual([]);
    await fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await waitFor(() => expect(screen.getByTestId('export-done')).toBeVisible());
    expect(downloads).toEqual(['export.sql']);
  });

  it('exports an extended text format only after its closing structure was verified', async () => {
    const head = '<?xml version="1.0" encoding="UTF-8"?>\n<export version="1">\n<table><rows>\n';
    const tail = '</rows></table>\n<complete>true</complete></export>\n';
    const calls = stubFetch(() => stream(head + tail));
    await ready();
    await fireEvent.click(screen.getByLabelText('XML'));
    await fireEvent.click(screen.getByTestId('start'));
    await waitFor(() => expect(screen.getByTestId('export-done')).toBeVisible());
    expect(calls.find((c) => c.url === '/api/v21/export')!.body).toMatchObject({ format: 'xml' });
    expect(downloads).toEqual(['export.sql']);
  });

  it('does not offer a truncated extended export or one with a faked marker in a cell', async () => {
    stubFetch(() =>
      stream(
        '<?xml version="1.0" encoding="UTF-8"?>\n<export version="1">\n<table><rows>\n<row><cell><value>&lt;complete&gt;true&lt;/complete&gt;</value>',
      ),
    );
    await ready();
    await fireEvent.click(screen.getByLabelText('XML'));
    await fireEvent.click(screen.getByTestId('start'));
    await waitFor(() => expect(screen.getByTestId('incomplete-hint')).toBeVisible());
    expect(downloads).toEqual([]);
  });

  it('falls back to API 0.11 with four formats on instances without 0.21', async () => {
    const calls = stubFetch(
      () => stream('CREATE TABLE t(a);\n-- DBMANAGER EXPORT COMPLETE\n'),
      'v11',
    );
    await ready();
    expect(screen.queryByTestId('text-formats')).toBeNull();
    expect(screen.queryByTestId('dump-details')).toBeNull();
    await fireEvent.click(screen.getByTestId('start'));
    await waitFor(() => expect(screen.getByTestId('export-done')).toBeVisible());
    expect(calls.some((c) => c.url === '/api/v11/export')).toBe(true);
    expect(calls.some((c) => c.url === '/api/v21/export')).toBe(false);
  });

  it('sends dump details and aliases and offers only the statements the driver accepts', async () => {
    const calls = stubFetch(() => stream('x\n-- DBMANAGER EXPORT COMPLETE\n'));
    await ready();
    expect(screen.getByTestId('dump-details')).toBeVisible();
    await fireEvent.click(screen.getByLabelText(/Sichten als reguläre Tabellen/));
    await fireEvent.click(screen.getByLabelText('Struktur'));
    await fireEvent.change(screen.getByTestId('data-statement'), {
      target: { value: 'insert-ignore' },
    });
    await fireEvent.click(screen.getByTestId('start'));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/v21/export')).toBe(true));
    expect(calls.find((c) => c.url === '/api/v21/export')!.body).toMatchObject({
      structure: false,
      views_as_tables: true,
      data_statement: 'insert-ignore',
    });
  });

  it('cancels a running export and keeps no file', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/v21/capabilities') return json(capabilities21);
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

  it('also falls back to API 0.11 when the 0.21 probe is answered with a non-JSON page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/api/v21/capabilities'
          ? new Response('<html></html>', { headers: { 'content-type': 'text/html' } })
          : json(capabilities),
      ),
    );
    await ready();
    expect(screen.queryByTestId('text-formats')).toBeNull();
    expect(screen.getByTestId('start')).toBeEnabled();
  });
});
