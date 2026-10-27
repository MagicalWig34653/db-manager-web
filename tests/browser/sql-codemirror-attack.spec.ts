// SPDX-License-Identifier: AGPL-3.0-only
// Independent review (W-P16) attack specs. test.fail() marks a CONFIRMED defect (assertion = correct behavior).
import { test, expect, type Page } from '@playwright/test';
import { editorText } from './editor';
import { browse, description, v2Caps } from '../../src/lib/features/bulk/testing';

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

// Trojan Source: bidi override/isolate characters and zero-width characters must be visibly marked.
test('bidi and control characters in pasted SQL are visibly marked (Trojan Source)', async ({
  page,
}) => {
  await setup(page);
  await box(page).fill('select ‮1⁦ , ​2\u0001');
  await expect(page.locator('.cm-editor .cm-specialChar').first()).toBeVisible({ timeout: 2000 });
  expect(await page.locator('.cm-editor .cm-specialChar').count()).toBeGreaterThanOrEqual(4);
});

test('hostile variable values never reach history, bookmarks or storage', async ({ page }) => {
  const queries = await setup(page);
  await page.getByRole('checkbox', { name: 'Verlauf speichern' }).check();
  await box(page).fill('select :v');
  await box(page).press('ControlOrMeta+Enter');
  const dialog = page.getByRole('dialog', { name: 'Variablen ausfüllen' });
  await dialog.getByLabel('Wert für :v').fill("TOPSECRET' OR 1=1 --");
  await dialog.getByRole('button', { name: 'Ausführen', exact: true }).click();
  await expect.poll(() => queries).toEqual(["select 'TOPSECRET'' OR 1=1 --'"]);
  const dump = await page.evaluate(() =>
    JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage), document.cookie]),
  );
  expect(dump).not.toContain('TOPSECRET');
  expect(await editorText(box(page))).toBe('select :v');
});

test('editor is read-only while a query runs and refuses input', async ({ page }) => {
  await setup(page);
  await page.route('**/api/v1/query', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route
      .fulfill({ json: { duration_ms: 1, results: [{ columns: [], rows: [], truncated: false }] } })
      .catch(() => {});
  });
  await box(page).fill('select 1');
  await page.getByRole('button', { name: 'Abfrage ausführen' }).click();
  await expect(box(page)).toHaveAttribute('contenteditable', 'false');
  await expect(page.getByRole('button', { name: 'Formatieren', exact: true })).toBeDisabled();
});
