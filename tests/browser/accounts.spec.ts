// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic browser acceptance. Real database scenarios are documented separately.
import { test, expect, type Page } from '@playwright/test';
import { actions, type Schemas, type Action } from '../../src/lib/features/accounts/model';
import { capabilities, info, details, plan, result } from '../../src/lib/features/accounts/testing';

async function mockBackend(
  page: Page,
  options: { outcome?: Schemas['AccountResult']['outcome']; delayed?: boolean } = {},
) {
  const plans: Record<string, unknown>[] = [];
  const executes: Record<string, unknown>[] = [];
  let release: (() => void) | undefined;
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
    if (url.endsWith('/catalog')) return route.fulfill({ json: { tables: [] } });
    return route.fulfill({ status: 404, json: { error: { code: 'not_found', message: '' } } });
  });
  await page.route('**/api/v15/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/capabilities')) return route.fulfill({ json: capabilities() });
    if (url.endsWith('/list'))
      return route.fulfill({ json: { accounts: [info()], truncated: false } });
    if (url.endsWith('/access')) return route.fulfill({ json: { actions, notes: [] } });
    if (url.endsWith('/inspect')) return route.fulfill({ json: details() });
    const body = route.request().postDataJSON();
    const segments = new URL(url).pathname.split('/');
    if (url.endsWith('/plan')) {
      plans.push(body);
      return route.fulfill({ json: plan(segments.at(-2) as Action) });
    }
    executes.push(body);
    if (options.delayed)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return route.fulfill({ json: result(options.outcome) });
  });
  return { plans, executes, release: () => release?.() };
}
async function open(page: Page, driver: 'mysql' | 'sqlite' = 'mysql') {
  await page.goto('/#/server/benutzer');
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  if (driver === 'mysql') {
    await page.getByRole('button', { name: /MySQL \/ MariaDB/ }).click();
    await page.getByLabel('Host', { exact: true }).fill('fixture.invalid');
    await page.getByLabel('Benutzername', { exact: true }).fill('synthetic');
  }
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    location.hash = '#/server/benutzer';
  });
  if (driver === 'mysql') await expect(page.getByTestId('account-list')).toBeVisible();
}
async function prepare(page: Page, action: Action) {
  await page.getByRole('button', { name: 'synthetic', exact: true }).click();
  await page.getByLabel('Aktion', { exact: true }).selectOption(action);
  await page.getByRole('button', { name: 'Plan anzeigen' }).click();
  await expect(page.getByLabel('Getippte Kontokennung')).toBeVisible();
}
async function confirm(page: Page) {
  await page.getByLabel('Ich habe den Plan und die Warnungen geprüft.').check();
  await page.getByLabel('Getippte Kontokennung').fill('9:synthetic@%');
  await page.getByLabel(/Ich bestätige zusätzlich/).check();
}
test('password stays out of plan, clears on dispatch, one execute, navigation lock', async ({
  page,
}) => {
  const mock = await mockBackend(page, { delayed: true });
  await open(page);
  await prepare(page, 'password');
  expect(mock.executes).toHaveLength(0);
  expect(mock.plans[0]).not.toHaveProperty('secret');
  await expect(page.getByLabel('Neues Passwort')).toHaveAttribute('type', 'password');
  await page.getByLabel('Neues Passwort').fill('synthetic-secret');
  await expect(page.getByRole('region', { name: 'Geplante SQL-Anweisungen' })).not.toContainText(
    'synthetic-secret',
  );
  await confirm(page);
  const execute = page.getByRole('button', { name: 'Bestätigt ausführen' });
  await execute.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect.poll(() => mock.executes.length).toBe(1);
  await expect(page.getByLabel('Neues Passwort')).toHaveCount(0);
  await expect(
    page
      .getByRole('navigation', { name: 'Benutzer und Rechte' })
      .getByRole('button', { name: 'Übersicht' }),
  ).toBeDisabled();
  await page.evaluate(() => {
    location.hash = '#/server/uebersicht';
  });
  await expect(page.getByTestId('navigation-blocked')).toBeVisible();
  await expect(page).toHaveURL(/#\/server\/benutzer$/);
  const unloadBlocked = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(unloadBlocked).toBe(true);
  mock.release();
  await expect(page.getByText(/Diese Ausführung ist abgeschlossen/)).toBeVisible();
  expect(mock.executes[0]).toMatchObject({
    secret: 'synthetic-secret',
    confirm: { action: 'password', acknowledge_self: true },
  });
});
test('delete requires exact identity and an independent acknowledgement', async ({ page }) => {
  const mock = await mockBackend(page);
  await open(page);
  await prepare(page, 'drop');
  await page.getByLabel('Ich habe den Plan und die Warnungen geprüft.').check();
  await page.getByLabel('Getippte Kontokennung').fill('synthetic');
  await page.getByLabel(/Ich bestätige zusätzlich/).check();
  await expect(page.getByRole('button', { name: 'Bestätigt ausführen' })).toBeDisabled();
  expect(mock.executes).toHaveLength(0);
  await page.getByLabel('Getippte Kontokennung').fill('9:synthetic@%');
  await page.getByRole('button', { name: 'Bestätigt ausführen' }).click();
  await expect(page.getByText(/Diese Ausführung ist abgeschlossen/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bestätigt ausführen' })).toHaveCount(0);
  expect(mock.executes).toHaveLength(1);
});
test('unknown result remains visible without retry', async ({ page }) => {
  const mock = await mockBackend(page, { outcome: 'outcome_unknown' });
  await open(page);
  await prepare(page, 'drop');
  await confirm(page);
  await page.getByRole('button', { name: 'Bestätigt ausführen' }).click();
  await expect(page.getByText(/Der Ausgang ist unbekannt/).first()).toBeVisible();
  expect(mock.executes).toHaveLength(1);
});
test('all scopes and roles are visible at 320 pixels', async ({ page }) => {
  await mockBackend(page);
  await open(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByRole('button', { name: 'synthetic', exact: true }).click();
  for (const scope of ['global', 'database', 'table', 'column', 'routine'])
    await expect(page.getByTestId(`grants-${scope}`)).toBeVisible();
  await expect(page.getByText('synthetic_role@%')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('SQLite explicitly unsupported', async ({ page }) => {
  const mock = await mockBackend(page);
  await open(page, 'sqlite');
  await expect(page.getByTestId('accounts-unsupported')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Plan anzeigen' })).toHaveCount(0);
  expect(mock.plans).toHaveLength(0);
  expect(mock.executes).toHaveLength(0);
});
