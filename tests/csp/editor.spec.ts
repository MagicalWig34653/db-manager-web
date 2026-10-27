// SPDX-License-Identifier: AGPL-3.0-only
// The CodeMirror editor must work under the production CSP: no inline <style>, no eval, lazy chunk from 'self'.
import { test, expect } from '@playwright/test';

declare global {
  interface Window {
    cspViolations: string[];
  }
}

test('CodeMirror editor, search panel and completion raise no CSP violation', async ({ page }) => {
  await page.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) =>
      window.cspViolations.push(`${event.violatedDirective}: ${event.blockedURI}`),
    );
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
        json: { tables: [{ schema: 'main', name: 'customers', kind: 'table' }] },
      });
    return route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'x' } } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.locator('.cm-editor')).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'SQL-Abfrage', exact: true });
  await editor.pressSequentially('select * from cus');
  await expect(page.getByRole('listbox').getByRole('option', { name: /customers/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Suchen und ersetzen' }).click();
  await expect(page.locator('.cm-search')).toBeVisible();
  await page.getByRole('button', { name: 'Formatieren', exact: true }).click();
  expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
});
