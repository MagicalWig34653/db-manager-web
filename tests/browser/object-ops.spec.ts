// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, type Page, type Route } from '@playwright/test';
import capabilities from '../fixtures/object-ops-capabilities.json' with { type: 'json' };

const v1 = (drivers: string[]) => ({
  contract_version: '0.1.0',
  drivers,
  credential_storage: false,
  max_rows: 10000,
  max_timeout_ms: 60000,
});
const errorBody = (code: string) => ({ error: { code, message: 'x' } });
const plan = (action: string, name: string, extra: Record<string, unknown> = {}) => ({
  action,
  driver: 'sqlite',
  target: { kind: 'table', schema: 'main', name },
  statements: [`-- ${action} ${name}`],
  warnings: ['Synthetische Warnung.'],
  affected_objects: [`table:${name}`],
  dependencies: [],
  dependencies_truncated: false,
  current_options: null,
  ddl_transactional: 'yes',
  confirmation: {
    action,
    destructive: ['database_drop', 'table_rename', 'table_truncate', 'table_drop'].includes(action),
    target_name: name,
    current_database: false,
    ...((extra.confirmation as object) ?? {}),
  },
  plan_sha256: 'a'.repeat(64),
});
const result = (action: string, outcome = 'completed', reason?: string) => ({
  action,
  outcome,
  ...(reason ? { reason } : {}),
  message: 'x',
  statements_total: 1,
  statements_executed: outcome === 'completed' ? 1 : 0,
  atomic: true,
  observation: null,
});

interface Mock {
  plans: Record<string, unknown>[];
  executes: Record<string, unknown>[];
}
async function mockBackend(
  page: Page,
  options: {
    drivers?: string[];
    execute?: (body: Record<string, unknown>, route: Route) => Promise<void> | void;
    planFor?: (action: string, body: Record<string, unknown>) => unknown;
  } = {},
): Promise<Mock> {
  const mock: Mock = { plans: [], executes: [] };
  await page.route('**/api/v1/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/capabilities'))
      return route.fulfill({ json: v1(options.drivers ?? ['sqlite']) });
    if (url.endsWith('/connections/test')) return route.fulfill({ json: { status: 'ok' } });
    if (url.endsWith('/catalog'))
      return route.fulfill({
        json: { tables: [{ name: 'orders', schema: 'main', kind: 'table' }] },
      });
    return route.fulfill({ status: 404, json: errorBody('x') });
  });
  await page.route('**/api/v8/capabilities', (route) => route.fulfill({ json: capabilities }));
  await page.route('**/api/v8/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v8/capabilities') return route.fallback();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const isPlan = url.pathname.endsWith('/plan');
    const action = url.pathname
      .replace('/api/v8/', '')
      .replace(/\/plan$/, '')
      .replace('databases/', 'database_')
      .replace('tables/', 'table_');
    if (isPlan) {
      mock.plans.push(body);
      const name = ((body.table as { name?: string })?.name ?? (body.database as string)) as string;
      return route.fulfill({ json: options.planFor?.(action, body) ?? plan(action, name) });
    }
    mock.executes.push(body);
    if (options.execute) return options.execute(body, route);
    return route.fulfill({ json: result(action) });
  });
  return mock;
}
async function connectSqlite(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
}
async function openTableOps(page: Page) {
  await connectSqlite(page);
  await page.getByRole('button', { name: /orders/ }).click();
  await page
    .getByRole('navigation', { name: 'Tabellenreiter' })
    .getByRole('button', { name: 'Operationen' })
    .click();
  await expect(page.getByTestId('table-ops')).toBeVisible();
}
const card = (page: Page, action: string) => page.getByTestId(`op-${action}`);
async function typeAndConfirm(page: Page, name: string) {
  const dialog = page.getByTestId('confirm-destructive');
  await dialog.getByRole('textbox').fill(name);
  await dialog.getByRole('button', { name: 'Ausführen' }).click();
}

test('drop: plan first, wrong name blocks, right name sends exactly one request, then locked', async ({
  page,
}) => {
  const mock = await mockBackend(page);
  await openTableOps(page);
  const drop = card(page, 'table_drop');
  await drop.getByRole('button', { name: 'Plan anzeigen' }).click();
  await expect(page.getByTestId('plan-table_drop')).toContainText('table_drop orders');
  await expect(page.getByTestId('plan-table_drop')).toContainText('Synthetische Warnung.');
  expect(mock.executes).toHaveLength(0);
  await drop.getByRole('button', { name: 'Ausführen' }).click();
  const dialog = page.getByTestId('confirm-destructive');
  await dialog.getByRole('textbox').fill('Orders');
  await expect(dialog.getByRole('button', { name: 'Ausführen' })).toBeDisabled();
  expect(mock.executes).toHaveLength(0);
  await dialog.getByRole('textbox').fill('orders');
  await dialog.getByRole('button', { name: 'Ausführen' }).dblclick();
  await expect(page.getByTestId('result-table_drop')).toHaveAttribute('data-outcome', 'completed');
  expect(mock.executes).toHaveLength(1);
  expect(mock.executes[0]).toMatchObject({
    confirm: { action: 'table_drop', target_name: 'orders' },
    expected_plan_sha256: 'a'.repeat(64),
    table: { schema: 'main', name: 'orders' },
  });
  await expect(drop.getByRole('button', { name: 'Ausführen' })).toHaveCount(0);
  await expect(drop).toContainText('gesperrt');
  await drop.getByRole('button', { name: 'Neuen Plan vorbereiten' }).click();
  await expect(drop.getByRole('button', { name: 'Plan anzeigen' })).toBeVisible();
  expect(page.url()).not.toMatch(/password|token/i);
});

test('rename and copy are planned with structured fields and non-destructive copy needs a checkbox', async ({
  page,
}) => {
  const mock = await mockBackend(page);
  await openTableOps(page);
  const copy = card(page, 'table_copy');
  await copy.getByLabel('Neuer Name').fill(`odd"copy 'x'`);
  await copy.getByLabel('Nur Struktur').check();
  await copy.getByRole('button', { name: 'Plan anzeigen' }).click();
  expect(mock.plans[0]).toMatchObject({
    table: { schema: 'main', name: 'orders' },
    new_name: `odd"copy 'x'`,
    mode: 'structure',
  });
  const run = copy.getByRole('button', { name: 'Ausführen' });
  await expect(run).toBeDisabled();
  await copy.getByRole('checkbox', { name: /Ich bestätige/ }).check();
  await run.click();
  await expect(page.getByTestId('result-table_copy')).toBeVisible();
  expect(mock.executes).toHaveLength(1);
  expect(mock.executes[0].confirm).toEqual({ action: 'table_copy' });
});

test('rejected reasons are German and nothing else is sent', async ({ page }) => {
  const mock = await mockBackend(page, {
    execute: (_b, route) =>
      route.fulfill({ json: result('table_truncate', 'rejected', 'dependency_blocks') }),
  });
  await openTableOps(page);
  const truncate = card(page, 'table_truncate');
  await truncate.getByRole('button', { name: 'Plan anzeigen' }).click();
  await truncate.getByRole('button', { name: 'Ausführen' }).click();
  await typeAndConfirm(page, 'orders');
  await expect(page.getByTestId('result-table_truncate')).toContainText('Fremdschlüssel');
  await expect(page.getByTestId('result-table_truncate')).toContainText('nichts verändert');
  expect(mock.executes).toHaveLength(1);
});

test('while an execute is running the tabs are locked, leaving warns and an unknown outcome raises the global notice', async ({
  page,
}) => {
  let answer: (() => void) | undefined;
  await mockBackend(page, {
    execute: async (_b, route) => {
      await new Promise<void>((resolve) => (answer = resolve));
      await route.fulfill({ status: 503, json: errorBody('outcome_unknown') });
    },
  });
  await openTableOps(page);
  const drop = card(page, 'table_drop');
  await drop.getByRole('button', { name: 'Plan anzeigen' }).click();
  await drop.getByRole('button', { name: 'Ausführen' }).click();
  await typeAndConfirm(page, 'orders');
  const tabs = page.getByRole('navigation', { name: 'Tabellenreiter' });
  await expect(tabs.getByRole('button', { name: 'Tabelle', exact: true })).toBeDisabled();
  const prevented = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await expect.poll(() => !!answer).toBe(true);
  answer?.();
  await expect(page.getByTestId('op-unknown')).toContainText('Nicht erneut senden');
  await expect(
    page.getByText('Der Ausgang eines gesendeten Schreibvorgangs ist unbekannt'),
  ).toBeVisible();
  await expect(drop.getByRole('button', { name: 'Ausführen' })).toHaveCount(0);
  await expect(tabs.getByRole('button', { name: 'Tabelle', exact: true })).toBeEnabled();
});

test('SQLite database actions are explained as unsupported', async ({ page }) => {
  await mockBackend(page);
  await connectSqlite(page);
  await page
    .getByRole('navigation', { name: 'Arbeitsbereich' })
    .getByRole('button', { name: 'Datenbankaktionen' })
    .click();
  await expect(
    page
      .getByTestId('database-ops')
      .getByText(/verwaltete Kennungen/)
      .first(),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Plan anzeigen' })).toHaveCount(0);
});

test('MySQL: dropping the connection database needs the extra acknowledgement', async ({
  page,
}) => {
  const mock = await mockBackend(page, {
    drivers: ['sqlite', 'mysql'],
    planFor: (action, body) =>
      plan(action, body.database as string, {
        confirmation: { current_database: action === 'database_drop' },
      }),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByRole('button', { name: 'MySQL' }).click();
  await page.getByLabel('Datenbank', { exact: true }).fill('shop');
  await page.getByLabel('Host', { exact: true }).fill('db.example.test');
  await page.getByLabel('Benutzername').fill('app');
  await page.getByLabel('Passwort', { exact: true }).fill('secret-pass');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Arbeitsbereich' })
    .getByRole('button', { name: 'Datenbankaktionen' })
    .click();
  const drop = card(page, 'database_drop');
  await drop.getByLabel('Datenbankname').fill('shop');
  await drop.getByRole('button', { name: 'Plan anzeigen' }).click();
  const run = drop.getByRole('button', { name: 'Ausführen' });
  await expect(run).toBeDisabled();
  await drop.getByRole('checkbox', { name: /aktuell verbundene Datenbank/ }).check();
  await run.click();
  await typeAndConfirm(page, 'shop');
  await expect(page.getByTestId('result-database_drop')).toBeVisible();
  expect(mock.executes).toHaveLength(1);
  expect(mock.executes[0].confirm).toEqual({
    action: 'database_drop',
    target_name: 'shop',
    acknowledge_current_database: true,
  });
  expect(page.url()).not.toContain('secret-pass');
});

test('320 px layout without horizontal scroll while a plan is shown', async ({ page }) => {
  await mockBackend(page);
  await openTableOps(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await card(page, 'table_drop').getByRole('button', { name: 'Plan anzeigen' }).click();
  await expect(page.getByTestId('plan-table_drop')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: 'node_modules/.cache/playwright-results/object-ops-320.png',
    fullPage: true,
  });
});
