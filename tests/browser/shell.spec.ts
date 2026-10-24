// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, type Page } from '@playwright/test';

const capabilities = {
  contract_version: '0.1.0',
  drivers: ['sqlite'],
  credential_storage: false,
  max_rows: 10000,
  max_timeout_ms: 60000,
};
async function mockBackend(
  page: Page,
  tables: unknown[] = [{ name: 'orders', schema: 'main', kind: 'table' }],
) {
  await page.route('**/api/v1/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/capabilities')) return route.fulfill({ json: capabilities });
    if (url.endsWith('/connections/test')) return route.fulfill({ json: { status: 'ok' } });
    if (url.endsWith('/catalog')) return route.fulfill({ json: { tables } });
    return route.fulfill({ status: 404, json: { error: { code: 'x', message: 'x' } } });
  });
  await page.route('**/api/v2/**', (route) =>
    route.fulfill({
      status: 500,
      json: { error: { code: 'x', message: 'Synthetischer Fehler.' } },
    }),
  );
}
async function connect(page: Page) {
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
}

test('deep link restores the table once connected and the URL carries no secrets', async ({
  page,
}) => {
  await mockBackend(page);
  await page.goto('/#/db/synthetic/schema/main/tabelle/orders/daten');
  await expect(page.getByText('keine passende Verbindung offen')).toBeVisible();
  await connect(page);
  await expect(page.getByRole('heading', { name: 'Tabellenansicht' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Tabellenarbeitsplatz' })).toBeVisible();
  expect(page.url()).toContain('#/db/synthetic/schema/main/tabelle/orders/daten');
  expect(page.url()).not.toMatch(/password|token|SELECT/i);
});

test('invalid hashes fall back to the SQL workspace and browser back restores the view', async ({
  page,
}) => {
  await mockBackend(page);
  await page.goto('/#/db/%E0%A4%A/sql');
  await expect(page.getByRole('heading', { name: 'SQL-Arbeitsbereich' })).toBeVisible();
  await page.goto('/#/server/uebersicht');
  await expect(page.getByRole('heading', { name: 'Serverübersicht' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'SQL-Arbeitsbereich' })).toBeVisible();
  await page.goto('/#/server/gibtesnicht');
  await expect(page.getByText('Dieser Reiter ist nicht verfügbar.')).toBeVisible();
});

test('table link for an unknown object explains instead of failing', async ({ page }) => {
  await mockBackend(page, []);
  await page.goto('/#/db/synthetic/tabelle/missing/daten');
  await connect(page);
  await expect(
    page.getByText('Das Objekt „missing“ wurde im Katalog nicht gefunden.'),
  ).toBeVisible();
});

test('320 px layout has no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await mockBackend(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'SQL-Arbeitsbereich' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.goto('/#/server/uebersicht');
  await expect(page.getByRole('heading', { name: 'Serverübersicht' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: 'node_modules/.cache/playwright-results/shell-320.png',
    fullPage: true,
  });
});
