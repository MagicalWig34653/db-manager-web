// SPDX-License-Identifier: AGPL-3.0-only
// PIN-BUNDLE-6 review: reproduces the flake of config-store.spec.ts "theme and language are stored on the server".
// Cause: a theme/language change made before the server store is ready (capabilities, opt-in, initial appearance
// load) is dropped by AppearanceSync.push (`loaded` false / no sync object yet) and never re-sent. The first test is
// the confirmed product defect (test.fail: it states the wanted behaviour and turns red once fixed); the second is the
// control that proves the harness (a change after the load is stored).
// Run: DBM_REAL_SPEC=tests/real/pin6-appearance.spec.ts DBM_EMBEDDED=1 python3 scripts/test-real-config-store.py
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';

const config = process.env.DBM_REAL_CONFIG
  ? JSON.parse(readFileSync(process.env.DBM_REAL_CONFIG, 'utf8'))
  : null;
test.skip(!config, 'DBM_REAL_CONFIG and the disposable backend/MariaDB fixture are required.');
test.describe.configure({ mode: 'serial' });

async function appearance(request: APIRequestContext) {
  const response = await request.fetch(
    `${config.backendURL}/api/v24/config/settings?scope=&key=appearance`,
    { headers: { Authorization: `Bearer ${config.token}` } },
  );
  return (await response.json()).items[0]?.data;
}
async function signIn(page: Page) {
  await page.getByRole('button', { name: 'Backend-Zugang' }).click();
  await page.getByLabel('Zugriffstoken').fill(config.token);
  await page.getByRole('button', { name: 'Übernehmen' }).click();
}
async function toServer(page: Page) {
  const link = page.getByRole('link', { name: 'Server', exact: true });
  if (await link.count()) await link.click();
  else await page.evaluate(() => (location.hash = '#/server/uebersicht'));
}
async function clear(request: APIRequestContext) {
  const response = await request.fetch(
    `${config.backendURL}/api/v24/config/settings?scope=&key=appearance`,
    {
      headers: { Authorization: `Bearer ${config.token}` },
    },
  );
  for (const item of (await response.json()).items)
    await request.fetch(`${config.backendURL}/api/v24/config/settings/${item.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${config.token}`, 'If-Match': `"${item.version}"` },
    });
}

test('FAILS TODAY: a theme change made while the server store is still being checked is lost', async ({
  page,
  request,
}) => {
  test.fail(
    true,
    'confirmed product defect: AppearanceSync.push drops changes before load() finished',
  );
  await clear(request);
  await page.route('**/api/v24/capabilities', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.goto('/');
  await signIn(page);
  await toServer(page);
  await page.locator('#settings').getByLabel('Thema', { exact: true }).selectOption('dark');
  await expect
    .poll(() => appearance(request), { timeout: 10000 })
    .toEqual({ theme: 'dark', locale: 'de' });
});

test('control: a theme change after the server store is ready is stored', async ({
  page,
  request,
}) => {
  await clear(request);
  await page.goto('/');
  await signIn(page);
  await toServer(page);
  await expect(page.locator('#config-store')).toContainText('Server');
  await page.waitForTimeout(1500);
  await page.locator('#settings').getByLabel('Thema', { exact: true }).selectOption('dark');
  await expect
    .poll(() => appearance(request), { timeout: 10000 })
    .toEqual({ theme: 'dark', locale: 'de' });
});
