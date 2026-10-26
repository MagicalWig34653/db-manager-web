// SPDX-License-Identifier: AGPL-3.0-only
// W-P14 search and replace against a mocked backend (API 0.14).
import { test, expect, type Page } from '@playwright/test';
import { capabilities, description, plan, table } from '../../src/lib/features/search/testing';

const v1 = {
  contract_version: '0.1.0',
  drivers: ['sqlite', 'mysql', 'postgres'],
  credential_storage: false,
  max_rows: 10000,
  max_timeout_ms: 60000,
};
const objectsResult = {
  driver: 'sqlite',
  schema: 'main',
  total: 1,
  offset: 0,
  limit: 200,
  has_more: false,
  exact_requested: false,
  exact_incomplete: false,
  objects: [
    {
      schema: 'main',
      name: 'orders',
      kind: 'table',
      rows: { value: 2, state: 'exact' },
      engine: null,
      collation: null,
      size_bytes: null,
      comment: null,
    },
  ],
};
const searchResult = {
  tables: [
    {
      table,
      columns: ['note'],
      count: 2,
      count_exact: true,
      rows: [
        [{ kind: 'text', value: 'quick fox' }],
        [{ kind: 'text', value: '<img src=x onerror=alert(1)> fox' }],
      ],
    },
  ],
};
interface Mock {
  searches: Record<string, unknown>[];
  plans: Record<string, unknown>[];
  replaces: Record<string, unknown>[];
}
async function mockBackend(page: Page, hangReplace = false): Promise<Mock> {
  const mock: Mock = { searches: [], plans: [], replaces: [] };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
    if (path === '/api/v1/capabilities') return route.fulfill({ json: v1 });
    if (path === '/api/v1/connections/test') return route.fulfill({ json: { status: 'ok' } });
    if (path === '/api/v1/catalog')
      return route.fulfill({
        json: { tables: [{ name: 'orders', schema: 'main', kind: 'table' }] },
      });
    if (path === '/api/v2/capabilities')
      return route.fulfill({
        json: {
          contract_version: '0.2.0',
          features: ['table_describe', 'table_browse'],
          drivers: ['sqlite', 'mysql', 'postgres'],
          max_page_size: 1000,
          max_timeout_ms: 60000,
        },
      });
    if (path === '/api/v2/tables/describe') return route.fulfill({ json: description() });
    if (path === '/api/v7/objects') return route.fulfill({ json: objectsResult });
    if (path === '/api/v14/capabilities') return route.fulfill({ json: capabilities() });
    if (path === '/api/v14/search') {
      mock.searches.push(body);
      const columns = (body as { targets: { columns: string[] }[] }).targets[0].columns;
      return route.fulfill({
        json: {
          tables: [
            {
              ...searchResult.tables[0],
              columns,
              rows: searchResult.tables[0].rows.map((row) => columns.map(() => row[0])),
            },
          ],
        },
      });
    }
    if (path === '/api/v14/replace/plan') {
      mock.plans.push(body);
      return route.fulfill({ json: plan() });
    }
    if (path === '/api/v14/replace') {
      mock.replaces.push(body);
      if (hangReplace) return;
      return route.fulfill({ json: { outcome: 'completed', affected_rows: 1 } });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'x' } } });
  });
  return mock;
}
async function connect(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
}
const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test('search: select table and column, escaped literal highlighting, no horizontal scroll at 320px', async ({
  page,
}) => {
  const mock = await mockBackend(page);
  await connect(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page
    .getByRole('navigation', { name: 'Arbeitsbereich' })
    .getByRole('button', { name: 'Suche', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Suche', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Suchen', exact: true })).toBeDisabled();
  await page
    .getByRole('region', { name: 'Suche' })
    .getByRole('button', { name: 'main.orders' })
    .click();
  await page.getByRole('checkbox', { name: 'note', exact: true }).check();
  await page.getByRole('textbox', { name: 'Suchtext' }).fill('fox');
  expect(mock.searches).toHaveLength(0);
  await page.getByRole('button', { name: 'Suchen', exact: true }).click();
  await expect(page.getByTestId('search-result')).toBeVisible();
  expect(mock.searches).toHaveLength(1);
  expect(mock.searches[0]).toMatchObject({ term: 'fox', mode: 'substring' });
  await expect(page.getByTestId('search-result')).toContainText('2 Treffer (exakt)');
  // Hostile cell text stays text.
  await expect(page.getByTestId('search-result')).toContainText('<img src=x onerror=alert(1)>');
  expect(await page.locator('[data-testid="search-result"] img').count()).toBe(0);
  expect(await noHorizontalScroll(page)).toBe(true);
});

test('replace: plan writes nothing, exact name and count are required, one write, locked afterwards, 320px', async ({
  page,
}) => {
  const mock = await mockBackend(page);
  await connect(page);
  await page.getByRole('button', { name: /orders/ }).click();
  await page.setViewportSize({ width: 320, height: 800 });
  await page
    .getByRole('navigation', { name: 'Tabellenreiter' })
    .getByRole('button', { name: 'Ersetzen', exact: true })
    .click();
  await page.getByRole('combobox', { name: 'Spalte', exact: true }).selectOption('note');
  await page.getByRole('textbox', { name: 'Suchtext' }).fill('fox');
  await page.getByRole('textbox', { name: 'Ersatztext (darf leer sein)' }).fill('cat');
  await page.getByRole('button', { name: 'Plan anzeigen', exact: true }).click();
  await expect(page.getByTestId('replace-plan')).toBeVisible();
  expect(mock.plans).toHaveLength(1);
  expect(mock.replaces).toHaveLength(0);
  const execute = page.getByRole('button', { name: 'Ersetzung ausführen', exact: true });
  await expect(execute).toBeDisabled();
  await page.getByRole('textbox', { name: 'Tabellenname zur Bestätigung' }).fill('orders');
  await page.getByRole('textbox', { name: 'Zeilenzahl zur Bestätigung' }).fill('2');
  await page.getByRole('checkbox', { name: /Plan, Beispiele/ }).check();
  await expect(execute).toBeDisabled();
  await page.getByRole('textbox', { name: 'Zeilenzahl zur Bestätigung' }).fill('1');
  await expect(execute).toBeEnabled();
  await execute.dblclick();
  await expect(page.getByTestId('replace-result')).toBeVisible();
  expect(mock.replaces).toHaveLength(1);
  await expect(page.getByTestId('replace-result')).toContainText('gesperrt');
  expect(await noHorizontalScroll(page)).toBe(true);
});

test('replace: navigation is locked while the write is pending', async ({ page }) => {
  const mock = await mockBackend(page, true);
  await connect(page);
  await page.getByRole('button', { name: /orders/ }).click();
  await page
    .getByRole('navigation', { name: 'Tabellenreiter' })
    .getByRole('button', { name: 'Ersetzen', exact: true })
    .click();
  await page.getByRole('combobox', { name: 'Spalte', exact: true }).selectOption('note');
  await page.getByRole('textbox', { name: 'Suchtext' }).fill('fox');
  await page.getByRole('button', { name: 'Plan anzeigen', exact: true }).click();
  await expect(page.getByTestId('replace-plan')).toBeVisible();
  await page.getByRole('textbox', { name: 'Tabellenname zur Bestätigung' }).fill('orders');
  await page.getByRole('textbox', { name: 'Zeilenzahl zur Bestätigung' }).fill('1');
  await page.getByRole('checkbox', { name: /Plan, Beispiele/ }).check();
  await page.getByRole('button', { name: 'Ersetzung ausführen', exact: true }).click();
  await expect.poll(() => mock.replaces.length).toBe(1);
  const hash = await page.evaluate(() => location.hash);
  await page.evaluate(() => (location.hash = '#/'));
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(hash);
  await expect(page.getByTestId('navigation-blocked')).toBeVisible();
});
