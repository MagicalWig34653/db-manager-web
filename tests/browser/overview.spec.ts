// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

const dir = 'src/lib/features/overview/fixtures/';
const fixture = (name: string) => JSON.parse(readFileSync(dir + name, 'utf8'));
const support = (value = 'supported', reason?: string) => ({
  support: value,
  ...(reason ? { reason } : {}),
});
function capabilities(over: Record<string, unknown> = {}) {
  const driver = {
    databases: support(),
    objects: support(),
    definition: support(),
    server_info: support(),
    exact_rows: support(),
    ...over,
  };
  return {
    contract_version: '0.7.0',
    features: ['databases', 'objects', 'definition', 'server_info'],
    mutations: false,
    drivers: { sqlite: driver, mysql: driver, postgres: driver },
    default_limit: 200,
    max_limit: 1000,
    max_offset: 1000000,
    max_exact_objects: 100,
    default_timeout_ms: 10000,
    max_timeout_ms: 30000,
    max_list_items: 1000,
    max_definition_bytes: 1048576,
    max_request_bytes: 1048576,
  };
}
const estimatedObjects = () => {
  const data = fixture('ObjectsResult.sqlite-objects.json');
  return {
    ...data,
    exact_requested: false,
    objects: [
      ...data.objects.map((o: object, i: number) => ({
        ...o,
        rows: { value: 100 + i, state: 'estimated' },
      })),
      {
        schema: 'main',
        name: 'a_view',
        kind: 'view',
        rows: { value: null, state: 'unknown' },
        engine: null,
        collation: null,
        size_bytes: null,
        comment: null,
      },
    ],
  };
};

async function mockBackend(
  page: Page,
  caps = capabilities(),
  seen: { url: string; body: unknown }[] = [],
) {
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
        json: {
          tables: [
            { name: 't_000', schema: 'main', kind: 'table' },
            { name: 'a_view', schema: 'main', kind: 'view' },
          ],
        },
      });
    return route.fulfill({ status: 404, json: { error: { code: 'x', message: 'x' } } });
  });
  await page.route('**/api/v7/**', async (route) => {
    const request = route.request();
    const url = request.url();
    const body = request.postData() ? JSON.parse(request.postData()!) : undefined;
    seen.push({ url, body });
    if (url.endsWith('/capabilities')) return route.fulfill({ json: caps });
    if (url.endsWith('/databases'))
      return route.fulfill({
        json: {
          ...fixture('DatabasesResult.sqlite-databases.json'),
          databases: [
            { ...fixture('DatabasesResult.sqlite-databases.json').databases[0], name: 'synthetic' },
          ],
        },
      });
    if (url.endsWith('/objects'))
      return route.fulfill({
        json: body.exact_rows
          ? {
              ...estimatedObjects(),
              exact_requested: true,
              objects: estimatedObjects().objects.map((o: { kind: string }) =>
                o.kind === 'table' ? { ...o, rows: { value: 3, state: 'exact' } } : o,
              ),
            }
          : estimatedObjects(),
      });
    if (url.endsWith('/definition'))
      return route.fulfill({
        json: {
          ...fixture('DefinitionResult.postgres-definition-table.json'),
          definition: 'CREATE TABLE t_000 (id integer);',
        },
      });
    if (url.endsWith('/server-info'))
      return route.fulfill({ json: fixture('ServerInfoResult.sqlite-server-info.json') });
    return route.fulfill({ status: 404, json: { error: { code: 'x', message: 'x' } } });
  });
}
async function connect(page: Page) {
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
}
const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('server page shows context and databases with an exact/estimated marker and links', async ({
  page,
}) => {
  const seen: { url: string; body: unknown }[] = [];
  await mockBackend(page, capabilities(), seen);
  await page.goto('/');
  await connect(page);
  await page.goto('/#/server');
  await expect(page.getByTestId('server-info')).toBeVisible();
  await expect(page.getByTestId('server-facts')).toBeVisible();
  await expect(page.getByTestId('database-table')).toBeVisible();
  await expect(page.getByTestId('value-state').first()).toHaveText('exakt');
  await expect(
    page.getByTestId('database-table').getByRole('link', { name: 'synthetic' }),
  ).toHaveAttribute('href', '#/db/synthetic/uebersicht');
  expect(seen.every((entry) => !entry.url.includes('password'))).toBe(true);
  expect(page.url()).not.toMatch(/password|token|SELECT/i);
});

test('database overview marks estimates, counts exactly on request, filters and sorts', async ({
  page,
}) => {
  const seen: { url: string; body: unknown }[] = [];
  await mockBackend(page, capabilities(), seen);
  await page.goto('/#/db/synthetic/uebersicht');
  await connect(page);
  await expect(page.getByTestId('objects-table')).toBeVisible();
  await expect(page.getByTestId('estimate-hint')).toBeVisible();
  await expect(page.getByTestId('row-count').first()).toHaveAttribute('data-state', 'unknown');
  await expect(page.getByText('geschätzt').first()).toBeVisible();
  await page.getByTestId('objects-kind').selectOption('view');
  await expect(page.getByTestId('object-kind')).toHaveCount(1);
  await page.getByTestId('objects-kind').selectOption('all');
  await page.getByTestId('count-exact').click();
  await expect(page.getByTestId('exact-done')).toBeVisible();
  await expect(page.getByText('geschätzt')).toHaveCount(0);
  const exact = seen.find((entry) => (entry.body as { exact_rows?: boolean })?.exact_rows);
  expect(exact?.body).toMatchObject({ exact_rows: true, limit: 100 });
  await page.getByRole('button', { name: 'Name' }).click();
  await expect(page.getByRole('columnheader', { name: /Name/ })).toHaveAttribute(
    'aria-sort',
    'descending',
  );
  await page.getByTestId('objects-filter').fill('t_001');
  await expect(page.getByTestId('objects-table').getByRole('row')).toHaveCount(2);
  expect(page.url()).not.toMatch(/password|token|SELECT/i);
});

test('definition view is read only, copyable and flags derived text', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await mockBackend(page);
  await page.goto('/#/db/synthetic/schema/main/tabelle/t_000/definition');
  await connect(page);
  await expect(page.getByTestId('definition-derived')).toBeVisible();
  await expect(page.getByTestId('definition-text')).toHaveText('CREATE TABLE t_000 (id integer);');
  await page.getByTestId('copy-definition').click();
  await expect(page.getByTestId('copy-state')).toContainText('kopiert');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'CREATE TABLE t_000 (id integer);',
  );
  await expect(page.getByTestId('definition').locator('textarea, input')).toHaveCount(0);
});

test('unsupported functions are explained instead of hidden', async ({ page }) => {
  await mockBackend(
    page,
    capabilities({ objects: support('unsupported', 'Objektlisten fehlen in dieser Version.') }),
  );
  await page.goto('/#/db/synthetic/uebersicht');
  await connect(page);
  await expect(page.getByText('Objektlisten fehlen in dieser Version.')).toBeVisible();
  await expect(page.getByTestId('objects-table')).toHaveCount(0);
});

test('320 px: overview and server page do not scroll horizontally', async ({ page }) => {
  await mockBackend(page);
  await page.goto('/#/db/synthetic/uebersicht');
  await connect(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await expect(page.getByTestId('objects-table')).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.goto('/#/server');
  await expect(page.getByTestId('database-table')).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
});
