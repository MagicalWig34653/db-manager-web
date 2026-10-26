// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page) {
  let queries = 0;
  await page.route('**/api/v1/**', (route) => {
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
    if (url.endsWith('/catalog')) return route.fulfill({ json: { tables: [] } });
    if (url.endsWith('/query')) {
      queries++;
      return route.fulfill({
        json: { duration_ms: 1, results: [{ columns: [], rows: [], truncated: false }] },
      });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto('/');
  return () => queries;
}
async function connect(page: Page, database = 'synthetic') {
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill(database);
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Verlauf speichern' })).toBeVisible();
}

test('opt-in history, shortcut, search, restore without execution, reload and source isolation', async ({
  page,
}) => {
  const queries = await setup(page);
  await connect(page);
  const editor = page.getByRole('textbox', { name: 'SQL-Abfrage' });
  await editor.fill('SELECT 101');
  await editor.press('Control+Enter');
  await expect.poll(queries).toBe(1);
  await expect(page.locator('.sql-library pre')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Verlauf speichern' }).check();
  await editor.fill('SELECT 202');
  await editor.press('Control+Enter');
  await expect.poll(queries).toBe(2);
  await expect(page.locator('.sql-library pre')).toHaveText(['SELECT 202']);
  await page.getByLabel('Verlauf durchsuchen').fill('missing');
  await expect(page.locator('.sql-library pre')).toHaveCount(0);
  await page.getByLabel('Verlauf durchsuchen').fill('202');
  await editor.fill('SELECT 303');
  await page.getByRole('button', { name: 'In Editor übernehmen' }).click();
  await expect(editor).toHaveValue('SELECT 202');
  expect(queries()).toBe(2);
  await page.reload();
  await connect(page);
  await expect(page.getByRole('checkbox', { name: 'Verlauf speichern' })).toBeChecked();
  await expect(page.locator('.sql-library pre')).toHaveText(['SELECT 202']);
  expect(queries()).toBe(2);
  await connect(page, 'other-source');
  await expect(page.getByRole('checkbox', { name: 'Verlauf speichern' })).not.toBeChecked();
  await expect(page.locator('.sql-library pre')).toHaveCount(0);
});

test('bookmark import, export and deletion do not execute SQL; 320 px and Tab remain usable', async ({
  page,
}) => {
  const queries = await setup(page);
  await connect(page);
  await page.setViewportSize({ width: 320, height: 700 });
  const editor = page.locator('#sql-editor');
  await editor.fill('SELECT 1\n');
  await editor.press('End');
  await editor.press('Tab');
  await expect(editor).toHaveValue('SELECT 1\n  ');
  await page.getByLabel('Lesezeichen aus JSON importieren').setInputFiles({
    name: 'bookmarks.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        version: 1,
        bookmarks: [{ name: '<b>Example</b>', sql: 'SELECT 42', time: '2026-10-25T10:00:00Z' }],
      }),
    ),
  });
  await expect(page.getByText('<b>Example</b>', { exact: true })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Lesezeichen als JSON exportieren' }).click();
  expect((await downloaded).suggestedFilename()).toBe('sql-lesezeichen.json');
  await page.getByRole('button', { name: 'In Editor übernehmen' }).click();
  await expect(editor).toHaveValue('SELECT 42');
  expect(queries()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Alle Lesezeichen löschen' }).click();
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith('db-manager.sql-editor.v1.')),
    ),
  ).toEqual([]);
});

test('storage denied keeps SQL editing and local in-memory bookmarks functional', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('Denied');
      },
    });
  });
  const queries = await setup(page);
  await connect(page);
  await expect(page.getByText(/Browserspeicher nicht verfügbar/)).toBeVisible();
  await page.locator('#sql-editor').fill('SELECT 1');
  await page.getByLabel('Name des Lesezeichens').fill('Temporary');
  await page.getByRole('button', { name: 'Als Lesezeichen speichern' }).click();
  await expect(page.getByText('Temporary', { exact: true })).toBeVisible();
  expect(queries()).toBe(0);
});
