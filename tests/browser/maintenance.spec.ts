// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, type Page } from '@playwright/test';
import { capabilities, item, plan, result } from '../../src/lib/features/maintenance/testing';

async function setup(page: Page, typed = false, unknown = false) {
  const writes: unknown[] = [];
  let release: () => Promise<void> = async () => {};
  await page.route('**/api/v1/**', (route) => {
    const url = route.request().url();
    if (url.endsWith('/capabilities'))
      return route.fulfill({
        json: {
          contract_version: '0.1.0',
          drivers: ['sqlite', 'mysql', 'postgres'],
          credential_storage: false,
          max_rows: 10000,
          max_timeout_ms: 60000,
        },
      });
    if (url.endsWith('/connections/test')) return route.fulfill({ json: { status: 'ok' } });
    if (url.endsWith('/catalog'))
      return route.fulfill({
        json: { tables: [{ name: 'orders', schema: 'main', kind: 'table' }] },
      });
    return route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'x' } } });
  });
  await page.route('**/api/v10/capabilities', (route) => route.fulfill({ json: capabilities() }));
  await page.route('**/api/v10/tables/maintenance/plan', (route) =>
    route.fulfill({ json: plan([item], typed) }),
  );
  await page.route('**/api/v10/tables/maintenance', async (route) => {
    writes.push(route.request().postDataJSON());
    await new Promise<void>((resolve) => {
      release = async () => {
        if (unknown)
          await route.fulfill({
            status: 503,
            json: { error: { code: 'outcome_unknown', message: 'x' } },
          });
        else await route.fulfill({ json: result() });
        resolve();
      };
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /orders/ }).click();
  await page
    .getByRole('navigation', { name: 'Tabellenreiter' })
    .getByRole('button', { name: 'Tabellenwartung' })
    .click();
  await page.getByRole('button', { name: 'Plan anzeigen' }).click();
  await expect(page.getByTestId('maintenance-plan')).toBeVisible();
  return { writes, release: () => release() };
}

test('plan, exact name, double click, navigation lock, final replay lock at 320px', async ({
  page,
}) => {
  const mock = await setup(page, true);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const execute = page.getByRole('button', { name: 'Ausführen', exact: true });
  await page.getByRole('checkbox', { name: /geprüft/ }).check();
  await page.getByLabel('Tabellenname exakt eingeben: orders').fill('Orders');
  await expect(execute).toBeDisabled();
  expect(mock.writes).toHaveLength(0);
  await page.getByLabel('Tabellenname exakt eingeben: orders').fill('orders');
  // Two synchronous clicks cover the in-flight double-dispatch guard.
  await execute.evaluate((node) => {
    (node as HTMLButtonElement).click();
    (node as HTMLButtonElement).click();
  });
  await expect.poll(() => mock.writes.length).toBe(1);
  const url = page.url();
  await page.evaluate(() => {
    location.hash = '#/datenbank/sql';
  });
  await expect(page.getByTestId('navigation-blocked')).toBeVisible();
  await expect.poll(() => page.url()).toBe(url);
  await mock.release();
  await expect(page.getByTestId('maintenance-result')).toContainText('Abgeschlossen');
  await expect(execute).toHaveCount(0);
  expect(mock.writes).toHaveLength(1);
  await page.getByRole('button', { name: 'Neue Wartung vorbereiten' }).click();
  await expect(page.getByTestId('maintenance-plan')).toHaveCount(0);
});

test('transport uncertainty leaves the operation locked with no automatic retry', async ({
  page,
}) => {
  const mock = await setup(page, false, true);
  await page.getByRole('checkbox', { name: /geprüft/ }).check();
  await page.getByRole('button', { name: 'Ausführen', exact: true }).click();
  await expect.poll(() => mock.writes.length).toBe(1);
  await mock.release();
  await expect(page.getByTestId('maintenance')).toContainText('Nicht erneut senden');
  await expect(page.getByRole('button', { name: 'Ausführen', exact: true })).toHaveCount(0);
  expect(mock.writes).toHaveLength(1);
});
