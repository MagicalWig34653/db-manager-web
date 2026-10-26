// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, type Page } from '@playwright/test';
import {
  capabilities,
  listing,
  program,
  plan,
  result,
} from '../../src/lib/features/programs/testing';
async function open(page: Page, hang = false) {
  const writes: unknown[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json =
      path === '/api/v1/capabilities'
        ? {
            contract_version: '0.1.0',
            drivers: ['sqlite', 'mysql', 'postgres'],
            credential_storage: false,
            max_rows: 10000,
            max_timeout_ms: 60000,
          }
        : path === '/api/v1/connections/test'
          ? { status: 'ok' }
          : path === '/api/v1/catalog'
            ? { tables: [] }
            : path === '/api/v16/capabilities'
              ? capabilities()
              : path === '/api/v16/programs/list'
                ? listing()
                : path === '/api/v16/programs/describe'
                  ? program()
                  : path === '/api/v16/programs/plan'
                    ? plan()
                    : null;
    if (path === '/api/v16/programs/execute') {
      writes.push(route.request().postDataJSON());
      if (hang) return;
      return route.fulfill({ json: result() });
    }
    return json
      ? route.fulfill({ json })
      : route.fulfill({
          status: 404,
          json: { error: { code: 'not_found', message: 'Unavailable' } },
        });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Arbeitsbereich' })
    .getByRole('button', { name: 'Programmobjekte' })
    .click();
  await expect(page.getByTestId('program-list')).toBeVisible();
  return writes;
}
test('exact preview, confirmation, one write and locked completion at mobile width', async ({
  page,
}) => {
  const writes = await open(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill(plan().object.name);
  await page.getByLabel('Definitionskörper').fill('SELECT 42 AS value');
  expect(writes).toHaveLength(0);
  await page.getByRole('button', { name: 'Plan anzeigen', exact: true }).click();
  await expect(page.getByTestId('program-plan')).toContainText(plan().statements[0]);
  await expect(page.getByRole('button', { name: 'Ausführen', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: /Exakte Anweisungen/ }).check();
  await page.getByRole('button', { name: 'Ausführen', exact: true }).dblclick();
  await expect.poll(() => writes.length).toBe(1);
  await expect(page.getByText(/Diese Ausführung ist gesperrt/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('write receiver blocks hash navigation while request is pending', async ({ page }) => {
  const writes = await open(page, true);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill(plan().object.name);
  await page.getByLabel('Definitionskörper').fill('SELECT 42 AS value');
  await page.getByRole('button', { name: 'Plan anzeigen', exact: true }).click();
  await page.getByRole('checkbox', { name: /Exakte Anweisungen/ }).check();
  await page.getByRole('button', { name: 'Ausführen', exact: true }).dblclick();
  await expect.poll(() => writes.length).toBe(1);
  await page.evaluate(() => {
    location.hash = '#/server';
  });
  await expect(page.getByTestId('navigation-blocked')).toBeVisible();
  await expect(page).toHaveURL(/programmobjekte/);
});
