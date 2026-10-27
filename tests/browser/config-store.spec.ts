// SPDX-License-Identifier: AGPL-3.0-only
// Server-side configuration store (API 0.24) against an in-memory stand-in for the backend. The real server is covered
// by scripts/test-real-config-store.py.
import { test, expect, type Page } from '@playwright/test';
import { editorText } from './editor';
import { FakeConfigServer } from '../../src/lib/features/config-store/testing';

const SQL_CAPS = {
  contract_version: '0.1.0',
  drivers: ['sqlite'],
  credential_storage: false,
  max_rows: 10000,
  max_timeout_ms: 60000,
};
async function setup(page: Page, fake: FakeConfigServer) {
  let queries = 0;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/v24/')) {
      const answer = await fake.fetch(url.pathname + url.search, {
        method: request.method(),
        headers: request.headers(),
        body: request.postData() ?? undefined,
      });
      return route.fulfill({
        status: answer.status,
        headers: Object.fromEntries(answer.headers.entries()),
        body: answer.status === 204 ? undefined : await answer.text(),
      });
    }
    if (url.pathname.endsWith('/capabilities')) return route.fulfill({ json: SQL_CAPS });
    if (url.pathname.endsWith('/connections/test'))
      return route.fulfill({ json: { status: 'ok' } });
    if (url.pathname.endsWith('/catalog')) return route.fulfill({ json: { tables: [] } });
    if (url.pathname.endsWith('/query')) {
      queries++;
      return route.fulfill({
        json: { duration_ms: 1, results: [{ columns: [], rows: [], truncated: false }] },
      });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Backend-Zugang' }).click();
  await page.getByLabel('Zugriffstoken').fill(fake.token);
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  return () => queries;
}
async function connect(page: Page, database = 'synthetic') {
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill(database);
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
}
const toServer = (page: Page) => page.getByRole('link', { name: 'Server', exact: true }).click();
const noOverflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

test('without a server state store the local mode stays, with the reason and no server request for data', async ({
  page,
}) => {
  const fake = new FakeConfigServer();
  fake.state = 'not_configured';
  await setup(page, fake);
  await connect(page);
  await expect(page.getByRole('checkbox', { name: 'Verlauf speichern' })).toBeVisible();
  await page.locator('#sql-editor').fill('SELECT 1');
  await page.getByRole('checkbox', { name: 'Verlauf speichern' }).check();
  await page.locator('#sql-editor').press('Control+Enter');
  await expect(page.locator('.sql-library pre')).toHaveText(['SELECT 1']);
  await toServer(page);
  const panel = page.locator('#config-store');
  await expect(panel).toContainText('Lokaler Modus');
  await expect(panel).toContainText('keinen Zustandsspeicher eingerichtet');
  await expect(panel).not.toContainText('SELECT');
  expect(fake.calls.every((c) => c.path === '/api/v24/capabilities')).toBe(true);
});

test('server mode: opt-in synchronized with the server, history written only after opt-in, reload keeps it, 320 px', async ({
  page,
}) => {
  const fake = new FakeConfigServer();
  const queries = await setup(page, fake);
  await connect(page);
  await expect(page.getByText('Gespeichert auf dem Server')).toBeVisible();
  const editor = page.locator('#sql-editor');
  await editor.fill('SELECT 101');
  await editor.press('Control+Enter');
  await expect.poll(queries).toBe(1);
  expect(fake.count('history')).toBe(0); // no opt-in: nothing was even attempted
  expect(fake.calls.some((c) => c.path === '/api/v24/config/history' && c.method === 'POST')).toBe(
    false,
  );
  await toServer(page);
  const panel = page.locator('#config-store');
  const optIn = panel.getByRole('checkbox', { name: 'Abfrageverlauf auf dem Server speichern' });
  await optIn.check();
  await expect(optIn).toBeChecked();
  await page.getByRole('link', { name: 'synthetic', exact: true }).click();
  await editor.fill('SELECT 202');
  await editor.press('Control+Enter');
  await expect.poll(() => fake.count('history')).toBe(1);
  await expect(page.locator('.sql-library pre').first()).toHaveText('SELECT 202');
  await page.getByLabel('Verlauf durchsuchen').fill('202');
  await editor.fill('SELECT 303');
  await page.getByRole('button', { name: 'In Editor übernehmen' }).click();
  await expect.poll(() => editorText(editor)).toBe('SELECT 202');
  expect(queries()).toBe(2);
  // A bookmark with a secret the local rules do not know: rejected by the server, text never echoed.
  await page.getByLabel('Name des Lesezeichens').fill('Mark');
  await editor.fill('SELECT rejectme');
  await page.getByRole('button', { name: 'Als Lesezeichen speichern' }).click();
  await expect(page.getByRole('alert')).toContainText('Zugangsdaten');
  await expect(page.getByRole('alert')).not.toContainText('rejectme');
  await editor.fill('SELECT 404');
  await page.getByRole('button', { name: 'Als Lesezeichen speichern' }).dblclick();
  await expect(page.getByText('Lesezeichen gespeichert.')).toBeVisible();
  expect(fake.count('bookmarks')).toBe(1);
  await page.reload();
  await page.getByRole('button', { name: 'Backend-Zugang' }).click();
  await page.getByLabel('Zugriffstoken').fill(fake.token);
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await connect(page);
  await expect(page.locator('.sql-library pre', { hasText: 'SELECT 404' })).toBeVisible();
  await expect(page.locator('.sql-library pre', { hasText: 'SELECT 202' })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 700 });
  await noOverflow(page);
});

test('migration of local data needs confirmation, is idempotent and deletes local data only on request', async ({
  page,
}) => {
  const fake = new FakeConfigServer();
  await page.addInitScript(() => {
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    localStorage.setItem(
      'db-manager.sql-editor.v1.' + 'f'.repeat(64),
      JSON.stringify({
        version: 1,
        enabled: true,
        history: [{ id: 'h1', sql: 'SELECT 1', name: '', time: '2026-10-01T10:00:00.000Z' }],
        bookmarks: [
          { id: 'b1', sql: 'SELECT 2', name: 'Local one', time: '2026-10-01T09:00:00.000Z' },
          { id: 'b2', sql: 'SELECT 3', name: 'Local two', time: '2026-10-01T08:00:00.000Z' },
        ],
      }),
    );
  });
  await setup(page, fake);
  await page.goto('/#/server/uebersicht');
  const panel = page.locator('#config-store');
  await expect(panel).toContainText('2 Lesezeichen und 0 Verlaufseinträge würden übertragen');
  await panel.getByRole('checkbox', { name: /Auch den lokalen Verlauf/ }).check();
  await expect(panel).toContainText('2 Lesezeichen und 1 Verlaufseinträge');
  const run = panel.getByRole('button', { name: 'Jetzt übertragen' });
  await expect(run).toBeDisabled();
  expect(fake.count('bookmarks')).toBe(0);
  await panel.getByRole('checkbox', { name: /Ich bestätige/ }).check();
  await run.dblclick();
  await expect(panel).toContainText('Übertragen: 3 neu, 0 schon vorhanden');
  expect(fake.calls.filter((c) => c.path === '/api/v24/config/import')).toHaveLength(1);
  expect(fake.count('bookmarks')).toBe(2);
  expect(fake.count('history')).toBe(1);
  expect(
    await page.evaluate(
      () => Object.keys(localStorage).filter((k) => k.includes('sql-editor')).length,
    ),
  ).toBe(1);
  await panel
    .getByRole('button', { name: 'Übertragene Einträge aus diesem Browser löschen' })
    .click();
  await expect(panel).toContainText('3 lokale Einträge gelöscht');
  // Entries are gone from the browser (the library key itself may remain with its opt-in flag).
  const left = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.includes('sql-editor'));
    return key ? JSON.parse(localStorage.getItem(key)!) : null;
  });
  expect(left.history).toEqual([]);
  expect(left.bookmarks).toEqual([]);
});

test('delete everything: preview, typed confirmation and export download', async ({ page }) => {
  const fake = new FakeConfigServer();
  fake.seed('bookmarks', { name: 'a', sql: 'SELECT 1' }, 's');
  fake.seed('favorites', { table: 't' }, 's');
  await setup(page, fake);
  await page.goto('/#/server/uebersicht');
  const panel = page.locator('#config-store');
  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Alle Serverdaten exportieren (JSON)' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('db-manager-konfiguration.json');
  await panel.getByRole('button', { name: 'Alle gespeicherten Daten löschen' }).click();
  await expect(panel).toContainText('Insgesamt 2 Einträge');
  const execute = panel.getByRole('button', { name: 'Endgültig löschen' });
  await expect(execute).toBeDisabled();
  await panel.getByLabel(/Tippe zur Bestätigung/).fill('LÖSCHEN 2');
  await execute.click();
  await expect(panel).toContainText('2 Einträge gelöscht');
  expect(fake.items.size).toBe(0);
  await panel
    .getByLabel('Datenschutz', { exact: false })
    .first()
    .isVisible()
    .catch(() => {});
  await expect(panel.getByRole('heading', { name: 'Datenschutz' })).toBeVisible();
});

test('outage: entries are buffered in the browser and arrive after recovery without loss', async ({
  page,
}) => {
  const fake = new FakeConfigServer();
  await setup(page, fake);
  await connect(page);
  await expect(page.getByText('Gespeichert auf dem Server')).toBeVisible();
  fake.down = true;
  await page.locator('#sql-editor').fill('SELECT 77');
  await page.getByLabel('Name des Lesezeichens').fill('Offline');
  await page.getByRole('button', { name: 'Als Lesezeichen speichern' }).click();
  await expect(page.getByText('noch nicht auf dem Server')).toBeVisible();
  expect(fake.count('bookmarks')).toBe(0);
  fake.down = false;
  await toServer(page);
  await expect.poll(() => fake.count('bookmarks')).toBe(1);
});

test('stale bookmark edit offers the merge choice at 320 px', async ({ page }) => {
  const fake = new FakeConfigServer();
  await setup(page, fake);
  await connect(page);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.locator('#sql-editor').fill('SELECT 9');
  await page.getByLabel('Name des Lesezeichens').fill('Original');
  await page.getByRole('button', { name: 'Als Lesezeichen speichern' }).click();
  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  const rec = [...fake.items.values()].find((i) => i.kind === 'bookmarks')!;
  rec.version = 5;
  rec.data = { name: 'Elsewhere', sql: 'SELECT 9' };
  await page.getByLabel('Neuer Name').fill('Mine');
  await page.getByRole('button', { name: 'Änderung speichern' }).click();
  const dialog = page.getByRole('alert').filter({ hasText: 'inzwischen geändert' });
  await expect(dialog).toContainText('Elsewhere');
  await noOverflow(page);
  await dialog.getByRole('button', { name: 'Serverfassung übernehmen' }).click();
  await expect(page.locator('.sql-library strong', { hasText: 'Elsewhere' })).toBeVisible();
  expect(rec.data.name).toBe('Elsewhere');
});
