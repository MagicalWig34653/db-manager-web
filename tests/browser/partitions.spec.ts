// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, type Page, type Route } from '@playwright/test';
import capabilities from '../fixtures/partitions-capabilities.json' with { type: 'json' };

const errorBody = (code: string) => ({ error: { code, message: 'x' } });
const HOSTILE = `pp_<b>"x'; DROP TABLE keep;--`;
const plan = (action: string, target: string, destructive = true) => ({
  driver: 'sqlite',
  statements: [`-- ${action} ${target}`],
  warnings: ['Synthetische Warnung.'],
  affected_objects: [`table:${target}`],
  plan_sha256: 'b'.repeat(64),
  action,
  confirmation: { action, destructive, target_name: target, current_database: false },
});
const batchResult = (outcome: string, statuses: string[]) => ({
  action: 'prefix_drop',
  outcome,
  ...(outcome === 'rejected' ? { reason: 'dependency_blocks' } : {}),
  message: 'x',
  statements_total: statuses.length,
  statements_executed: statuses.filter((s) => s === 'applied').length,
  atomic: false,
  observation: null,
  tables: statuses.map((status, i) => ({
    table: { schema: 'main', name: i === 0 ? HOSTILE : `pp_${i}` },
    status,
    statements_total: 1,
    statements_executed: status === 'applied' ? 1 : 0,
  })),
});

interface Mock {
  plans: Record<string, unknown>[];
  executes: Record<string, unknown>[];
}
async function mockBackend(
  page: Page,
  options: { execute?: (route: Route) => Promise<void> | void } = {},
): Promise<Mock> {
  const mock: Mock = { plans: [], executes: [] };
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
        json: { tables: [{ name: 'orders', schema: 'main', kind: 'table' }] },
      });
    return route.fulfill({ status: 404, json: errorBody('x') });
  });
  await page.route('**/api/v22/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v22/capabilities') return route.fulfill({ json: capabilities });
    if (url.pathname.endsWith('/partitions/list'))
      return route.fulfill({ status: 422, json: errorBody('unsupported_action') });
    if (url.pathname.endsWith('/prefix/list'))
      return route.fulfill({
        json: {
          tables: [
            { schema: 'main', name: HOSTILE },
            { schema: 'main', name: 'pp_1' },
          ],
        },
      });
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (url.pathname.endsWith('/plan')) {
      mock.plans.push(body);
      return route.fulfill({ json: plan(`prefix_${body.action}`, 'pp_') });
    }
    mock.executes.push(body);
    if (options.execute) return options.execute(route);
    return route.fulfill({ json: batchResult('completed', ['applied', 'applied']) });
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
async function openPrefix(page: Page) {
  await connectSqlite(page);
  await page.goto('/#/db/synthetic/praefix-stapel');
  await expect(page.getByTestId('prefix-tab')).toBeVisible();
  await page.getByTestId('prefix-input').fill('pp_');
}
async function typeAndConfirm(page: Page, name: string) {
  const dialog = page.getByTestId('confirm-destructive');
  await dialog.getByRole('textbox').fill(name);
  await dialog.getByRole('button', { name: 'Ausführen' }).dblclick();
}

test('SQLite: partitions are shown as not supported, the prefix batch works', async ({ page }) => {
  await mockBackend(page);
  await connectSqlite(page);
  await page.getByRole('button', { name: /orders/ }).click();
  await page
    .getByRole('navigation', { name: 'Tabellenreiter' })
    .getByRole('button', { name: 'Partitionen' })
    .click();
  await expect(page.getByTestId('partitions-unsupported')).toContainText('nicht unterstützt');
  await expect(page.getByTestId('partition-action')).toHaveCount(0);
});

test('prefix drop: plan, typed prefix, one request on double click, hostile names as text', async ({
  page,
}) => {
  const mock = await mockBackend(page);
  await openPrefix(page);
  await page.getByRole('button', { name: 'Treffer anzeigen' }).click();
  await expect(page.getByTestId('match-list')).toContainText(HOSTILE);
  expect(await page.locator('[data-testid=match-list] b').count()).toBe(0);
  const card = page.getByTestId('prefix-drop');
  await card.getByRole('button', { name: 'Plan anzeigen' }).click();
  await expect(page.getByTestId('plan')).toContainText('-- prefix_drop');
  expect(mock.executes).toHaveLength(0);
  await card.getByRole('button', { name: 'Ausführen' }).click();
  const dialog = page.getByTestId('confirm-destructive');
  await dialog.getByRole('textbox').fill('PP_');
  await expect(dialog.getByRole('button', { name: 'Ausführen' })).toBeDisabled();
  await typeAndConfirm(page, 'pp_');
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'completed');
  expect(mock.executes).toHaveLength(1);
  expect(mock.executes[0]).toMatchObject({
    action: 'drop',
    prefix: 'pp_',
    confirm: { action: 'prefix_drop', target_name: 'pp_' },
  });
});

test('partial batch: per table applied/unknown, outcome_unknown, no retry control', async ({
  page,
}) => {
  const mock = await mockBackend(page, {
    execute: (route) =>
      route.fulfill({
        json: batchResult('outcome_unknown', ['applied', 'unknown', 'not_applied']),
      }),
  });
  await openPrefix(page);
  await page.getByTestId('prefix-drop').getByRole('button', { name: 'Plan anzeigen' }).click();
  await page.getByTestId('prefix-drop').getByRole('button', { name: 'Ausführen' }).click();
  await typeAndConfirm(page, 'pp_');
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'outcome_unknown');
  const rows = page.getByTestId('table-results').locator('tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute('data-status', 'applied');
  await expect(rows.nth(1)).toHaveAttribute('data-status', 'unknown');
  await expect(rows.nth(2)).toHaveAttribute('data-status', 'not_applied');
  await expect(rows.nth(0)).toContainText(HOSTILE);
  await expect(
    page.getByTestId('prefix-drop').getByRole('button', { name: 'Ausführen' }),
  ).toHaveCount(0);
  expect(mock.executes).toHaveLength(1);
});

test('navigation is blocked while the execute request is in flight', async ({ page }) => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await mockBackend(page, {
    execute: async (route) => {
      await held;
      await route.fulfill({ json: batchResult('completed', ['applied']) });
    },
  });
  await openPrefix(page);
  const card = page.getByTestId('prefix-drop');
  await card.getByRole('button', { name: 'Plan anzeigen' }).click();
  await card.getByRole('button', { name: 'Ausführen' }).click();
  await typeAndConfirm(page, 'pp_');
  await expect(card).toHaveAttribute('data-phase', 'executing');
  release();
  await expect(page.getByTestId('result')).toBeVisible();
});

test('320 px: prefix batch fits without horizontal scroll and works by keyboard', async ({
  page,
}) => {
  await mockBackend(page);
  await openPrefix(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.getByRole('button', { name: 'Treffer anzeigen' }).click();
  await expect(page.getByTestId('match-list')).toBeVisible();
  await page.getByTestId('prefix-action').selectOption('truncate');
  await expect(page.getByTestId('prefix-truncate')).toBeVisible();
  await page.getByTestId('prefix-truncate').getByRole('button', { name: 'Plan anzeigen' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('plan')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
