// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, type Page } from '@playwright/test';
import { createCapabilities, createResult, errorBody } from '../fixtures/create';

const capabilities = {
  contract_version: '0.1.0',
  drivers: ['sqlite'],
  credential_storage: false,
  max_rows: 10000,
  max_timeout_ms: 60000,
};
interface Mock {
  creates: Record<string, unknown>[];
  catalogRequests: number;
}
async function mockBackend(
  page: Page,
  create: (body: Record<string, unknown>) => { status: number; json: unknown } | 'hang',
  v6 = true,
): Promise<Mock> {
  const mock: Mock = { creates: [], catalogRequests: 0 };
  await page.route('**/api/v1/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/capabilities')) return route.fulfill({ json: capabilities });
    if (url.endsWith('/connections/test')) return route.fulfill({ json: { status: 'ok' } });
    if (url.endsWith('/catalog')) {
      mock.catalogRequests++;
      return route.fulfill({
        json: { tables: [{ name: 'orders', schema: 'main', kind: 'table' }] },
      });
    }
    return route.fulfill({ status: 404, json: errorBody('x') });
  });
  await page.route('**/api/v6/capabilities', (route) =>
    v6
      ? route.fulfill({ json: createCapabilities })
      : route.fulfill({ status: 404, json: errorBody('not_found') }),
  );
  await page.route('**/api/v6/tables/create', async (route) => {
    const body = route.request().postDataJSON();
    mock.creates.push(body);
    const answer = create(body);
    if (answer === 'hang') return;
    return route.fulfill(answer);
  });
  return mock;
}
async function open(page: Page) {
  await page.goto('/#/db/synthetic/tabelle-anlegen');
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Neue Tabelle anlegen' })).toBeVisible();
}
async function review(page: Page, name: string) {
  await page.getByLabel('Tabellenname').fill(name);
  await page.getByRole('button', { name: 'Definition prüfen' }).click();
  await expect(page.getByTestId('create-review')).toBeVisible();
}
const submitButton = (page: Page) =>
  page.getByTestId('create-table').getByRole('button', { name: 'Tabelle anlegen' });
const confirmBox = (page: Page) => page.getByRole('checkbox', { name: /Ich bestätige/ });

test('no request without the explicit confirmation, then one request with confirm:true', async ({
  page,
}) => {
  const mock = await mockBackend(page, (body) => ({
    status: 200,
    json: createResult('transactional', (body.table as { name: string }).name),
  }));
  await open(page);
  await review(page, 'orders_new');
  await expect(submitButton(page)).toBeDisabled();
  expect(mock.creates).toHaveLength(0);
  const catalogBefore = mock.catalogRequests;
  await confirmBox(page).check();
  await submitButton(page).click();
  await expect(page.getByTestId('create-result')).toBeVisible();
  expect(mock.creates).toHaveLength(1);
  expect(mock.creates[0]).toMatchObject({ confirm: true, table: { name: 'orders_new' } });
  await expect(page.getByTestId('structure-check')).toHaveText('transactional');
  await expect.poll(() => mock.catalogRequests).toBeGreaterThan(catalogBefore);
  expect(page.url()).not.toMatch(/password|token|orders_new/i);
});

test('special names are sent byte-exact and shown quoted in the review', async ({ page }) => {
  const name = `odd"name \`x\` '; DROP TABLE orders;--`;
  const mock = await mockBackend(page, (body) => ({
    status: 200,
    json: createResult('transactional', (body.table as { name: string }).name),
  }));
  await open(page);
  await page.getByLabel('Spaltenname 1', { exact: true }).fill('we"ird col');
  await review(page, name);
  await expect(page.getByTestId('create-review')).toContainText(JSON.stringify(name));
  await confirmBox(page).check();
  await submitButton(page).click();
  await expect(page.getByTestId('create-result')).toBeVisible();
  expect(mock.creates[0]).toMatchObject({
    table: { name },
    columns: [{ name: 'we"ird col' }],
  });
});

test('a double click sends exactly one request', async ({ page }) => {
  const mock = await mockBackend(page, () => 'hang');
  await open(page);
  await review(page, 'once');
  await confirmBox(page).check();
  const button = submitButton(page);
  await button.dblclick();
  await expect(
    page.getByTestId('create-table').getByRole('button', { name: 'Wird angelegt …' }),
  ).toBeDisabled();
  await expect.poll(() => mock.creates.length).toBe(1);
  await page.waitForTimeout(300);
  expect(mock.creates).toHaveLength(1);
});

test('a name conflict (409) keeps the form and reports nothing as created', async ({ page }) => {
  const mock = await mockBackend(page, () => ({ status: 409, json: errorBody('create_conflict') }));
  await open(page);
  await review(page, 'orders');
  await expect(page.getByText('laut aktuellem Objektkatalog')).toBeVisible();
  await confirmBox(page).check();
  await submitButton(page).click();
  await expect(page.getByTestId('create-error')).toContainText('nicht verändert');
  await expect(page.getByTestId('create-result')).toHaveCount(0);
  await expect(page.getByLabel('Tabellenname')).toHaveValue('orders');
  expect(mock.creates).toHaveLength(1);
});

test('outcome_unknown offers no retry and locks the form', async ({ page }) => {
  const mock = await mockBackend(page, () => ({ status: 503, json: errorBody('outcome_unknown') }));
  await open(page);
  await review(page, 'maybe');
  await confirmBox(page).check();
  await submitButton(page).click();
  await expect(page.getByTestId('create-unknown')).toContainText('Nicht erneut senden');
  await expect(submitButton(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /erneut|Wiederholen/i })).toHaveCount(0);
  expect(mock.creates).toHaveLength(1);
});

test('an instance without API 0.6 explains the missing feature', async ({ page }) => {
  await mockBackend(page, () => ({ status: 500, json: errorBody('x') }), false);
  await page.goto('/#/db/synthetic/tabelle-anlegen');
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Tabellenanlage nicht verfügbar')).toBeVisible();
  await expect(page.getByLabel('Tabellenname')).toHaveCount(0);
});

test('invalid limits block the review and 320 px has no horizontal scroll', async ({ page }) => {
  await mockBackend(page, () => ({ status: 500, json: errorBody('x') }));
  await open(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.getByLabel('Tabellenname').fill('x'.repeat(64));
  await expect(page.getByRole('button', { name: 'Definition prüfen' })).toBeDisabled();
  await expect(page.getByTestId('create-issues')).toContainText('63 Bytes');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Spalte hinzufügen' }).click();
  await page.getByLabel('Typ von Spalte 2', { exact: true }).selectOption('decimal');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: 'node_modules/.cache/playwright-results/table-create-320.png',
    fullPage: true,
  });
});

test('the review step has no horizontal overflow at 320 px (axe review F-5)', async ({ page }) => {
  await mockBackend(page, () => ({ status: 500, json: errorBody('x') }));
  await open(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await review(page, 'orders_with_a_rather_long_table_name_for_the_review');
  await expect(page.getByTestId('create-review')).toBeVisible();
  const overflow = await page.evaluate(() =>
    Array.from(document.querySelectorAll('body *'))
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .map((el) => el.tagName + '.' + String(el.className).slice(0, 30)),
  );
  expect(overflow).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('while sending, tabs and objects are locked, leaving warns and an unknown outcome is not lost', async ({
  page,
}) => {
  let answer: (() => void) | undefined;
  await mockBackend(page, () => 'hang');
  await page.route('**/api/v6/tables/create', async (route) => {
    await new Promise<void>((resolve) => (answer = resolve));
    await route.fulfill({ status: 503, json: errorBody('outcome_unknown') });
  });
  await open(page);
  await review(page, 'racing');
  await confirmBox(page).check();
  await submitButton(page).click();
  const tabs = page.getByRole('navigation', { name: 'Arbeitsbereich' });
  await expect(tabs.getByRole('button', { name: 'SQL', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: /orders/ })).toBeDisabled();
  const prevented = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await expect.poll(() => !!answer).toBe(true);
  answer?.();
  await expect(page.getByTestId('create-unknown')).toBeVisible();
  await expect(
    page.getByText('Der Ausgang eines gesendeten Schreibvorgangs ist unbekannt'),
  ).toBeVisible();
  await expect(tabs.getByRole('button', { name: 'SQL', exact: true })).toBeEnabled();
});
