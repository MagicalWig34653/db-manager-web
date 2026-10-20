// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from '@playwright/test';
declare global {
  interface Window {
    cspViolations: string[];
  }
}

test('production validators enforce the contract under a CSP without inline scripts or eval', async ({
  page,
}) => {
  let invalidReply = false;
  await page.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) =>
      window.cspViolations.push(event.violatedDirective),
    );
  });
  await page.route('**/', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        'content-security-policy':
          "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; connect-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    });
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
    if (url.endsWith('/catalog')) return route.fulfill({ json: { tables: [] } });
    if (url.endsWith('/query'))
      return route.fulfill({
        json: {
          duration_ms: 1,
          results: [
            {
              columns: [{ name: 'value', database_type: 'INTEGER' }],
              rows: [
                [
                  invalidReply
                    ? { kind: 'integer', value: 42 }
                    : { kind: 'integer', value: '9007199254740993123456789' },
                ],
              ],
              truncated: false,
            },
          ],
        },
      });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Backend-Zugang' }).click();
  await page.getByLabel('Zugriffstoken').fill('synthetic-token');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'SQL-Abfrage', exact: true }).fill('SELECT 1;');
  await page.getByRole('button', { name: 'Abfrage ausführen' }).click();
  await expect(page.getByText('9007199254740993123456789', { exact: true })).toBeVisible();
  invalidReply = true;
  await page.getByRole('button', { name: 'Abfrage ausführen' }).click();
  await expect(
    page.getByText('Das Backend hat eine ungültige Antwort geliefert.', { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
});
