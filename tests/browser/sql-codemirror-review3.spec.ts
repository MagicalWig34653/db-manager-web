// SPDX-License-Identifier: AGPL-3.0-only
// Third review (W-P16): batch warning checkbox, M-1 race/readonly, M-2 false positives.
import { test, expect, type Page } from '@playwright/test';
import { editorText } from './editor';
import { browse, description, v2Caps } from '../../src/lib/features/bulk/testing';
import capabilities from '../../src/lib/features/sql-batch/fixtures/SQLBatchCapabilities.real-sqlite-http.json' with { type: 'json' };
import stopResult from '../../src/lib/features/sql-batch/fixtures/SQLBatchResult.real-sqlite.json' with { type: 'json' };

async function open(page: Page, pending = false) {
  const calls: Record<string, unknown>[] = [];
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/capabilities')
      return route.fulfill({
        json: {
          contract_version: '0.1.0',
          drivers: ['sqlite'],
          credential_storage: false,
          max_rows: 10000,
          max_timeout_ms: 60000,
        },
      });
    if (path === '/api/v1/connections/test') return route.fulfill({ json: { status: 'ok' } });
    if (path === '/api/v1/catalog')
      return route.fulfill({
        json: { tables: [{ name: 'synthetic', schema: 'main', kind: 'table' }] },
      });
    if (path === '/api/v12/capabilities') return route.fulfill({ json: capabilities });
    if (path.startsWith('/api/v12/sql/')) {
      calls.push(route.request().postDataJSON());
      if (pending) await gate;
      return route.fulfill({ json: stopResult }).catch(() => {});
    }
    return route.fulfill({
      status: 404,
      json: { error: { code: 'not_found', message: 'synthetic' } },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'SQL-Stapel', exact: true }).click();
  await expect(page.getByTestId('batch-driver-reason')).toBeVisible();
  return { calls, release };
}

async function setup(page: Page): Promise<string[]> {
  const queries: string[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === '/api/v1/capabilities')
      return json({
        contract_version: '0.1.0',
        drivers: ['sqlite'],
        credential_storage: false,
        max_rows: 10000,
        max_timeout_ms: 60000,
      });
    if (path === '/api/v1/connections/test') return json({ status: 'ok' });
    if (path === '/api/v1/catalog')
      return json({ tables: [{ name: 'items', schema: 'main', kind: 'table' }] });
    if (path === '/api/v1/query') {
      queries.push(route.request().postDataJSON().sql);
      return json({ duration_ms: 1, results: [{ columns: [], rows: [], truncated: false }] });
    }
    if (path === '/api/v2/capabilities') return json(v2Caps);
    if (path === '/api/v2/tables/describe') return json(description());
    if (path === '/api/v2/tables/browse') return json(browse());
    return json({ error: { code: 'not_found', message: 'x' } }, 404);
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.locator('.cm-editor')).toBeVisible();
  return queries;
}
const box = (page: Page) => page.getByRole('textbox', { name: 'SQL-Abfrage', exact: true });
const warning = (page: Page) =>
  page.getByRole('alert').filter({ hasText: 'Unsichtbare oder umkehrende Zeichen' });
const BIDI = 'select ‮1, 2';

const BATCH_BIDI = 'SELECT \u202e1;';

test('SQL batch: hidden characters need an extra confirmation before "Bestätigt ausführen"', async ({
  page,
}) => {
  const { calls } = await open(page);
  await page.getByTestId('batch-sql').fill(BATCH_BIDI);
  const run = page.getByRole('button', { name: 'Bestätigt ausführen' });
  const boxes = page.getByTestId('sql-batch-panel').getByRole('checkbox');
  const total = await boxes.count();
  expect(total).toBeGreaterThanOrEqual(3);
  // all but the hidden-character confirmation checked: still disabled
  for (let i = 0; i < total - 1; i++) await boxes.nth(i).check();
  await expect(run).toBeDisabled();
  await boxes.nth(total - 1).check();
  await expect(run).toBeEnabled();
  // editing the text so that no hidden character remains withdraws the extra requirement and resets it
  await page.getByTestId('batch-sql').fill('SELECT 1;');
  await expect(boxes).toHaveCount(total - 1);
  // putting a hidden character back requires a fresh confirmation
  await page.getByTestId('batch-sql').fill(BATCH_BIDI);
  await expect(run).toBeDisabled();
  expect(calls).toEqual([]);
});

test('M-1: editor is read-only while the warning stands; fast repeated Ctrl+Enter makes one warning and one query; history is the executed text', async ({
  page,
}) => {
  const queries = await setup(page);
  await page.getByRole('checkbox', { name: 'Verlauf speichern' }).check();
  await box(page).fill(BIDI);
  await expect(async () => {
    await box(page).press('ControlOrMeta+Enter');
    await expect(warning(page)).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10000 });
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
  // typing is refused
  await page.locator('.cm-content').click();
  await page.keyboard.type('zzz');
  expect(await editorText(box(page))).not.toContain('zzz');
  // repeated shortcuts while the warning stands never run anything
  for (let i = 0; i < 5; i++) await page.keyboard.press('ControlOrMeta+Enter');
  expect(queries).toEqual([]);
  await expect(warning(page)).toHaveCount(1);
  // restoring another statement from the library discards the warning
  await warning(page).getByRole('button', { name: 'Trotzdem ausführen' }).dblclick();
  await expect.poll(() => queries.length).toBe(1);
  await page.waitForTimeout(300);
  expect(queries).toEqual([BIDI]);
  const history = await page.locator('.sql-library pre').allTextContents();
  expect(history).toEqual([BIDI]);
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true');
});

test('M-1 race: Ctrl+Enter held down while the warning is shown and Cancel then edit still works', async ({
  page,
}) => {
  const queries = await setup(page);
  await box(page).fill(BIDI);
  await expect(async () => {
    await box(page).press('ControlOrMeta+Enter');
    await expect(warning(page)).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10000 });
  await warning(page).getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true');
  await box(page).fill('select 7');
  await box(page).press('ControlOrMeta+Enter');
  await expect.poll(() => queries).toEqual(['select 7']);
  await expect(warning(page)).toHaveCount(0);
});

// M-2 false positives: ordinary non-ASCII text must not trigger the warning.
for (const text of [
  'Zeichen äöüß é ñ',
  '日本語 한국어 العربية עברית',
  'smile 😀 and \u00e9',
  'tab\there',
  'crlf\r\nline',
  'quote ’ “x” – —',
]) {
  test(`M-2 no warning for ordinary text ${JSON.stringify(text)}`, async ({ page }) => {
    const queries = await setup(page);
    await box(page).fill(`select '${text.replace(/\r?\n/g, ' ')}'`);
    await expect(async () => {
      await box(page).press('ControlOrMeta+Enter');
      await expect.poll(() => queries.length, { timeout: 500 }).toBe(1);
    }).toPass({ timeout: 10000 });
    await expect(warning(page)).toHaveCount(0);
  });
}
