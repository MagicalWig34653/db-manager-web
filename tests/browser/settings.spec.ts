// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, type Page } from '@playwright/test';
const capabilities = {
  contract_version: '0.1.0',
  drivers: ['sqlite', 'mysql', 'postgres'],
  credential_storage: false,
  max_rows: 10000,
  max_timeout_ms: 60000,
};
async function open(page: Page) {
  await page.route('**/api/**', (route) => {
    const url = route.request().url();
    if (url.endsWith('/capabilities')) return route.fulfill({ json: capabilities });
    return route.fulfill({ json: { tables: [] } });
  });
  await page.goto('/#/server/uebersicht');
}
test('theme and language apply immediately, persist only on opt-in and reset clears storage', async ({
  page,
}) => {
  await open(page);
  const settings = page.locator('#settings');
  await expect(settings).toBeVisible();
  await settings.getByLabel('Thema', { exact: true }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await settings.getByLabel('Sprache', { exact: true }).selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#settings h2')).toHaveText('Settings');
  expect(await page.evaluate(() => localStorage.getItem('db-manager.settings.v1'))).toBeNull();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await page.locator('#settings').getByLabel('Sprache', { exact: true }).selectOption('en');
  await page.locator('#settings input[type=checkbox]').check();
  const stored = await page.evaluate(() => localStorage.getItem('db-manager.settings.v1'));
  expect(JSON.parse(stored!)).toEqual({ version: 1, persist: true, theme: 'system', locale: 'en' });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.locator('#settings button', { hasText: 'Reset' }).click();
  expect(await page.evaluate(() => localStorage.getItem('db-manager.settings.v1'))).toBeNull();
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
});
test('F1 opens the shortcut overview and Escape closes it', async ({ page }) => {
  await open(page);
  await page.keyboard.press('F1');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Abfrage ausführen');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
