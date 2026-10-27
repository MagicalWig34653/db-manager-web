// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, type Page } from '@playwright/test';

const capabilities = {
  contract_version: '0.11.0',
  available: true,
  formats: ['sql', 'csv', 'excel-csv', 'json'],
  charsets: ['utf-8', 'utf-8-bom'],
  drivers: ['sqlite', 'mysql', 'postgres'].map((driver) => ({
    driver,
    snapshot: driver === 'postgres' ? 'repeatable_read' : 'exclusive_local_transaction',
    sql_server: driver === 'mysql',
    state: 'limited',
    reason: 'Eingeschränkter Dump (Testtext).',
  })),
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
  drivers: ['sqlite', 'mysql', 'postgres'].map((driver) => ({
    driver,
    state: 'limited',
    views_as_tables: true,
    definer: ['omit'],
    compatibility: ['native', 'data-only'],
    data_statements: driver === 'postgres' ? ['insert'] : ['insert', 'insert-ignore', 'replace'],
    reason: 'Eingeschränkter Dump (Testtext).',
  })),
  max_bytes: 1073741824,
  max_rows: 10000000,
  max_timeout_ms: 300000,
  max_tables: 100,
  max_request_bytes: 1048576,
};
const XML_DOC =
  '<?xml version="1.0" encoding="UTF-8"?>\n<export version="1">\n<table><rows>\n</rows></table>\n<complete>true</complete></export>\n';
type Mode = 'complete' | 'incomplete' | 'busy' | 'hang' | 'xml' | 'xml-cut';
async function mockBackend(
  page: Page,
  mode: () => Mode,
  seen: { url: string; auth?: string }[] = [],
) {
  // Headless Chromium offers a save dialog nobody can answer: test the in-memory download path.
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  await page.route('**/api/v1/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/capabilities'))
      return route.fulfill({
        json: {
          contract_version: '0.1.0',
          drivers: ['sqlite'],
          credential_storage: false,
          max_rows: 10000,
          max_timeout_ms: 60000,
        },
      });
    if (url.endsWith('/connections/test')) return route.fulfill({ json: { status: 'ok' } });
    if (url.endsWith('/catalog'))
      return route.fulfill({
        json: {
          tables: [
            { name: 'orders', schema: 'main', kind: 'table' },
            { name: 'v_orders', schema: 'main', kind: 'view' },
          ],
        },
      });
    return route.fulfill({ status: 404, json: { error: { code: 'x', message: 'x' } } });
  });
  await page.route('**/api/v11/**', async (route) => {
    const request = route.request();
    seen.push({ url: request.url(), auth: request.headers().authorization });
    if (request.url().endsWith('/capabilities')) return route.fulfill({ json: capabilities });
    return route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'x' } } });
  });
  await page.route('**/api/v21/**', async (route) => {
    const request = route.request();
    seen.push({ url: request.url(), auth: request.headers().authorization });
    if (request.url().endsWith('/capabilities')) return route.fulfill({ json: capabilities21 });
    const m = mode();
    if (m === 'xml' || m === 'xml-cut')
      return route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'application/xml',
          'Content-Disposition': 'attachment; filename="export.xml"',
        },
        body: m === 'xml' ? XML_DOC : XML_DOC.replace('<complete>true</complete></export>\n', ''),
      });
    if (m === 'busy')
      return route.fulfill({ status: 503, json: { error: { code: 'export_busy', message: 'x' } } });
    if (m === 'hang') return; // never answered: the user cancels
    const body =
      m === 'complete'
        ? 'CREATE TABLE orders(a);\n-- DBMANAGER EXPORT COMPLETE\n'
        : 'CREATE TABLE orders(a);\nINSERT INTO orders VALUES (1);\n';
    return route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'application/sql',
        'Content-Disposition': 'attachment; filename="export.sql"',
      },
      body,
    });
  });
}
async function connect(page: Page) {
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /orders$/ }).first()).toBeVisible();
}
async function openExport(page: Page) {
  await page.goto('/#/db/synthetic/export');
  await expect(page.getByTestId('export-panel')).toBeVisible();
  await page.getByLabel('main.orders', { exact: true }).check();
}

test('a complete export is saved as download, token only in the header', async ({ page }) => {
  const seen: { url: string; auth?: string }[] = [];
  await mockBackend(page, () => 'complete', seen);
  await page.goto('/');
  await connect(page);
  await openExport(page);
  await expect(page.getByTestId('preview')).toContainText('SQL-Dump');
  const download = page.waitForEvent('download');
  await page.getByTestId('start').click();
  expect((await download).suggestedFilename()).toBe('export.sql');
  await expect(page.getByTestId('export-done')).toBeVisible();
  expect(seen.every((s) => !/token|password/i.test(s.url))).toBe(true);
  expect(page.url()).not.toMatch(/password|token|SELECT/i);
});

test('a 200 stream without closing marker is reported as faulty and never downloaded', async ({
  page,
}) => {
  await mockBackend(page, () => 'incomplete');
  await page.goto('/');
  await connect(page);
  await openExport(page);
  let downloaded = false;
  page.on('download', () => (downloaded = true));
  await page.getByTestId('start').click();
  await expect(page.getByRole('alert')).toContainText('unvollständig');
  await expect(page.getByTestId('incomplete-hint')).toBeVisible();
  await expect(page.getByTestId('export-done')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(downloaded).toBe(false);
});

test('export_busy is explained and a running export can be canceled', async ({ page }) => {
  let mode: Mode = 'busy';
  await mockBackend(page, () => mode);
  await page.goto('/');
  await connect(page);
  await openExport(page);
  await page.getByTestId('start').click();
  await expect(page.getByTestId('export-busy')).toContainText('zwei Exporte');
  mode = 'hang';
  await page.getByRole('button', { name: 'Erneut versuchen' }).click();
  await expect(page.getByTestId('cancel')).toBeVisible();
  await page.getByTestId('cancel').click();
  await expect(page.getByTestId('export-canceled')).toBeVisible();
  await expect(page.getByTestId('start')).toBeVisible();
});

test('320 px: export wizard does not scroll horizontally', async ({ page }) => {
  await mockBackend(page, () => 'complete');
  await page.goto('/');
  await connect(page);
  await openExport(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await expect(page.getByTestId('preview')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('an extended text format downloads only with its verified closing structure', async ({
  page,
}) => {
  let mode: Mode = 'xml-cut';
  const seen: { url: string; auth?: string }[] = [];
  await mockBackend(page, () => mode, seen);
  await page.goto('/');
  await connect(page);
  await openExport(page);
  await page.getByLabel('XML', { exact: true }).check();
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.getByTestId('start').click();
  await expect(page.getByTestId('incomplete-hint')).toBeVisible();
  await page.waitForTimeout(300);
  expect(downloads).toBe(0);
  mode = 'xml';
  const download = page.waitForEvent('download');
  await page.getByTestId('start').click();
  expect((await download).suggestedFilename()).toBe('export.xml');
  await expect(page.getByTestId('export-done')).toBeVisible();
  expect(seen.filter((s) => s.url.endsWith('/api/v21/export'))).toHaveLength(2);
});

test('a double click on start sends exactly one export request', async ({ page }) => {
  const seen: { url: string; auth?: string }[] = [];
  await mockBackend(page, () => 'hang', seen);
  await page.goto('/');
  await connect(page);
  await openExport(page);
  await page.getByTestId('start').dblclick();
  await expect(page.getByTestId('cancel')).toBeVisible();
  expect(seen.filter((s) => s.url.endsWith('/export'))).toHaveLength(1);
  await page.getByTestId('cancel').click();
  await expect(page.getByTestId('export-canceled')).toBeVisible();
});

test('320 px: the extended dump details and text formats fit without horizontal scroll', async ({
  page,
}) => {
  await mockBackend(page, () => 'complete');
  await page.goto('/');
  await connect(page);
  await openExport(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await expect(page.getByTestId('dump-details')).toBeVisible();
  await expect(page.getByTestId('text-formats')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
