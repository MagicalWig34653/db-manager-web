// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, type Page } from '@playwright/test';
import { capabilities, description, plan, result } from '../../src/lib/features/columns/testing';

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
  await page.route('**/api/v2/tables/describe', (route) => route.fulfill({ json: description() }));
  await page.route('**/api/v9/capabilities', (route) => route.fulfill({ json: capabilities() }));
  await page.route('**/api/v9/columns/plan', async (route) => {
    mock.plans.push(route.request().postDataJSON());
    return route.fulfill({ json: (options.plan ?? (() => plan()))() });
  });
  await page.route('**/api/v9/columns/alter', async (route) => {
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
    .getByRole('button', { name: 'Spalten' })
    .click();
  await expect(page.getByTestId('column-list')).toBeVisible();
}
const noOverflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

test('plan first, confirmation checkbox, double click sends exactly one request', async ({
  page,
}) => {
  const mock = await mockBackend(page, { alter: () => 'hang' });
  await open(page);
  await page.getByRole('button', { name: 'Spalte hinzufügen' }).click();
  await page.getByLabel('Name', { exact: true }).fill('we"ird col');
  await page.getByLabel('Typ', { exact: true }).selectOption('int64');
  await page.getByRole('button', { name: 'Zur Änderungsliste hinzufügen' }).click();
  expect(mock.plans).toHaveLength(0);
  await page.getByRole('button', { name: 'Plan anzeigen' }).click();
  await expect(page.getByTestId('columns-plan')).toBeVisible();
  expect(mock.plans[0]).toMatchObject({
    table: { name: 'orders' },
    changes: [{ action: 'add', definition: { name: 'we"ird col', type: { kind: 'int64' } } }],
  });
  const execute = page.getByRole('button', { name: 'Ausführen', exact: true });
  await expect(execute).toBeDisabled();
  await page.getByRole('checkbox', { name: /geprüft/ }).check();
  await execute.dblclick();
  await expect.poll(() => mock.alters.length).toBe(1);
  await page.waitForTimeout(300);
  expect(mock.alters).toHaveLength(1);
  expect(mock.alters[0]).toMatchObject({
    confirm: { action: 'columns_alter' },
    expected_plan_sha256: 'a'.repeat(64),
  });
  expect(page.url()).not.toMatch(/password|token/i);
});

test('destructive drop needs the typed table name; wrong names send nothing (320 px)', async ({
  page,
}) => {
  const mock = await mockBackend(page, {
    plan: () => plan({ destructive: true, warnings: ['Alle Werte werden gelöscht.'] }),
    alter: () => ({ status: 200, json: result() }),
  });
  await open(page);
  await page.setViewportSize({ width: 320, height: 700 });
  await noOverflow(page);
  await page.getByRole('button', { name: 'Spalte note entfernen' }).click();
  await page.getByRole('button', { name: 'Plan anzeigen' }).click();
  await expect(page.getByTestId('plan-destructive')).toBeVisible();
  await noOverflow(page);
  await page.getByRole('button', { name: 'Zerstörend ausführen …' }).click();
  const dialog = page.getByTestId('confirm-destructive');
  const confirm = dialog.getByRole('button', { name: 'Zerstörend ausführen …' });
  await dialog.getByRole('textbox').fill('Orders');
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('textbox').fill('order');
  await expect(confirm).toBeDisabled();
  expect(mock.alters).toHaveLength(0);
  await dialog.getByRole('textbox').fill('orders');
  await confirm.click();
  await expect(page.getByTestId('columns-result')).toContainText('ausgeführt');
  expect(mock.alters).toHaveLength(1);
  expect(mock.alters[0]).toMatchObject({
    confirm: { action: 'columns_alter', target_name: 'orders' },
  });
  await expect(page.getByRole('button', { name: 'Ausführen', exact: true })).toHaveCount(0);
  await noOverflow(page);
});

test('an unknown outcome locks the editor and offers no retry', async ({ page }) => {
  const mock = await mockBackend(page, {
    alter: () => ({ status: 503, json: { error: { code: 'outcome_unknown', message: 'x' } } }),
  });
  await open(page);
  await page.getByRole('button', { name: 'Spalte note umbenennen' }).click();
  await page.getByLabel('Neuer Name').fill('remark');
  await page.getByRole('button', { name: 'Zur Änderungsliste hinzufügen' }).click();
  await page.getByRole('button', { name: 'Plan anzeigen' }).click();
  await page.getByRole('checkbox', { name: /geprüft/ }).check();
  await page.getByRole('button', { name: 'Ausführen', exact: true }).click();
  await expect(page.getByTestId('columns-result')).toContainText('Ausgang ist unbekannt');
  await expect(page.getByTestId('columns-result')).toContainText('Nicht erneut senden');
  await expect(page.getByRole('button', { name: 'Ausführen', exact: true })).toHaveCount(0);
  expect(mock.alters).toHaveLength(1);
});
