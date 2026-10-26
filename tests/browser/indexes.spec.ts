// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, type Page } from '@playwright/test';
import {
  capabilities,
  description,
  metadata,
  plan,
  result,
} from '../../src/lib/features/indexes/testing';

const v1 = {
  contract_version: '0.1.0',
  drivers: ['sqlite', 'mysql', 'postgres'],
  credential_storage: false,
  max_rows: 10000,
  max_timeout_ms: 60000,
};
const v2 = {
  contract_version: '0.2.0',
  features: ['table_describe', 'table_browse'],
  drivers: ['sqlite', 'mysql', 'postgres'],
  max_page_size: 1000,
  max_timeout_ms: 60000,
};
interface Mock {
  plans: Record<string, unknown>[];
  alters: Record<string, unknown>[];
}
async function mockBackend(
  page: Page,
  options: {
    plan?: () => ReturnType<typeof plan>;
    alter?: (body: Record<string, unknown>) => { status: number; json: unknown } | 'hang';
  } = {},
): Promise<Mock> {
  const mock: Mock = { plans: [], alters: [] };
  await page.route('**/api/v1/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/capabilities')) return route.fulfill({ json: v1 });
    if (url.endsWith('/connections/test')) return route.fulfill({ json: { status: 'ok' } });
    if (url.endsWith('/catalog'))
      return route.fulfill({
        json: { tables: [{ name: 'orders', schema: 'main', kind: 'table' }] },
      });
    return route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'x' } } });
  });
  await page.route('**/api/v2/capabilities', (route) => route.fulfill({ json: v2 }));
  await page.route('**/api/v2/tables/describe', (route) =>
    route.fulfill({ json: { ...description(), table: { name: 'orders', schema: 'main' } } }),
  );
  await page.route('**/api/v5/capabilities', (route) =>
    route.fulfill({
      json: {
        contract_version: '0.5.0',
        features: ['table_structure'],
        mutations: false,
        max_objects_per_section: 1024,
        max_terms: 8192,
        timeout_ms: 10000,
      },
    }),
  );
  await page.route('**/api/v5/tables/structure', (route) =>
    route.fulfill({ json: { ...metadata(), table: { name: 'orders', schema: 'main' } } }),
  );
  await page.route('**/api/v13/capabilities', (route) => route.fulfill({ json: capabilities() }));
  await page.route('**/api/v13/indexes/plan', async (route) => {
    mock.plans.push(route.request().postDataJSON());
    return route.fulfill({ json: (options.plan ?? (() => plan()))() });
  });
  await page.route('**/api/v13/indexes/alter', async (route) => {
    const body = route.request().postDataJSON();
    mock.alters.push(body);
    const answer = options.alter ? options.alter(body) : { status: 200, json: result() };
    if (answer === 'hang') return;
    return route.fulfill(answer);
  });
  return mock;
}
async function open(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /orders/ }).click();
  await page
    .getByRole('navigation', { name: 'Tabellenreiter' })
    .getByRole('button', { name: 'Indizes' })
    .click();
  await expect(page.getByTestId('index-list')).toBeVisible();
}

async function define(page: Page) {
  await page.getByLabel('Neuer Index- oder Constraintname').fill('idx_new');
  await page.getByLabel('Spalte 1', { exact: true }).selectOption('note');
}
test('index plan, confirmation, one dispatch and navigation lock at 320px', async ({ page }) => {
  const mock = await mockBackend(page, { alter: () => 'hang' });
  await open(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await define(page);
  expect(mock.alters).toHaveLength(0);
  await page.getByRole('button', { name: 'Plan anzeigen' }).click();
  await expect(page.getByTestId('indexes-plan')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ausführen', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: /Vorschau und Warnungen/ }).check();
  await page.getByRole('button', { name: 'Ausführen', exact: true }).dblclick();
  expect(mock.alters).toHaveLength(1);
  const original = await page.evaluate(() => location.hash);
  await page.evaluate(() => (location.hash = '#/'));
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(original);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('destructive deletion needs the exact table name from the plan', async ({ page }) => {
  const mock = await mockBackend(page, {
    plan: () => plan({ destructive: true, target_name: 'orders' }),
  });
  await open(page);
  await page.getByLabel('Aktion', { exact: true }).selectOption('index_drop');
  await page.getByLabel('Bestehender Name aus dem Katalog').selectOption('idx <img src=x>');
  await page.getByRole('button', { name: 'Plan anzeigen' }).click();
  await page.getByRole('button', { name: 'Änderung mit Namen bestätigen' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('idx <img src=x>');
  await expect(dialog.getByRole('button', { name: 'Endgültig ausführen' })).toBeDisabled();
  expect(mock.alters).toHaveLength(0);
  await dialog.getByRole('textbox').fill('orders');
  await dialog.getByRole('button', { name: 'Endgültig ausführen' }).click();
  await expect(page.getByTestId('indexes-result')).toBeVisible();
  expect(mock.alters).toHaveLength(1);
  expect(mock.alters[0]).toMatchObject({
    confirm: { action: 'index_drop', target_name: 'orders' },
  });
});
test('unknown outcome locks execution and tells the user to inspect the database', async ({
  page,
}) => {
  const mock = await mockBackend(page, {
    alter: () => ({
      status: 200,
      json: {
        outcome: 'outcome_unknown',
        reason: 'commit_unknown',
        message: 'x',
        statements_executed: 0,
        atomic: false,
        observation: 'unavailable',
      },
    }),
  });
  await open(page);
  await define(page);
  await page.getByRole('button', { name: 'Plan anzeigen' }).click();
  await page.getByRole('checkbox', { name: /Vorschau und Warnungen/ }).check();
  await page.getByRole('button', { name: 'Ausführen', exact: true }).click();
  await expect(page.getByTestId('indexes-result')).toContainText('Ausgang unbekannt');
  await expect(page.getByRole('button', { name: 'Ausführen', exact: true })).toHaveCount(0);
  expect(mock.alters).toHaveLength(1);
});
