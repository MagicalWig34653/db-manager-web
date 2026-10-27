// SPDX-License-Identifier: AGPL-3.0-only
// Real server-side configuration store: backend main with a disposable MariaDB 12.3 as server state, orchestrated by
// scripts/test-real-config-store.py (DBM_REAL_CONFIG: urls, token, container of the task-owned database).
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const config = process.env.DBM_REAL_CONFIG
  ? JSON.parse(readFileSync(process.env.DBM_REAL_CONFIG, 'utf8'))
  : null;
const SCOPE_KEY = 'db-manager.sql-editor.v1.' + 'a'.repeat(64);

async function api(
  request: APIRequestContext,
  path: string,
  options: { method?: string; data?: unknown } = {},
) {
  const response = await request.fetch(`${config.backendURL}${path}`, {
    method: options.method ?? 'GET',
    headers: { Authorization: `Bearer ${config.token}` },
    ...(options.data === undefined ? {} : { data: options.data }),
  });
  return {
    status: response.status(),
    json: response.status() === 204 ? null : await response.json().catch(() => null),
  };
}
async function list(request: APIRequestContext, kind: string) {
  const answer = await api(request, `/api/v24/config/${kind}?limit=100`);
  expect(answer.status).toBe(200);
  return answer.json.items as {
    id: string;
    version: number;
    data: Record<string, unknown>;
    scope: string;
  }[];
}
async function signIn(page: Page) {
  await page.getByRole('button', { name: 'Backend-Zugang' }).click();
  await page.getByLabel('Zugriffstoken').fill(config.token);
  await page.getByRole('button', { name: 'Übernehmen' }).click();
}
async function connect(page: Page) {
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill(config.connection.database);
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
}
async function toServer(page: Page) {
  const link = page.getByRole('link', { name: 'Server', exact: true });
  if (await link.count()) await link.click();
  else await page.evaluate(() => (location.hash = '#/server/uebersicht'));
}
const toSql = (page: Page) => page.locator('a.database-label').click();

test.describe.configure({ mode: 'serial' });
test.skip(!config, 'DBM_REAL_CONFIG and the disposable backend/MariaDB fixture are required.');

test('capabilities report the real server mode with the single-owner notice', async ({
  page,
  request,
}) => {
  const caps = await api(request, '/api/v24/capabilities');
  expect(caps.json).toMatchObject({
    available: true,
    mode: 'server',
    reason: 'ok',
    owner_model: 'single',
  });
  await page.goto('/');
  await signIn(page);
  await toServer(page);
  const panel = page.locator('#config-store');
  await expect(panel).toContainText('Serverspeicher aktiv');
  await expect(panel).toContainText('dasselbe Zugangstoken');
  await expect(panel.getByRole('heading', { name: 'Datenschutz' })).toBeVisible();
});

test('local W-P16 data is previewed, migrated only after confirmation, idempotent, deleted locally only on request', async ({
  page,
  request,
}) => {
  await page.addInitScript((key) => {
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        enabled: true,
        history: [{ id: 'h1', sql: 'SELECT 41', name: '', time: '2026-10-01T10:00:00.000Z' }],
        bookmarks: [
          { id: 'b1', sql: 'SELECT 1', name: 'Local one', time: '2026-10-01T09:00:00.000Z' },
          { id: 'b2', sql: 'SELECT 2', name: 'Local two', time: '2026-10-01T08:00:00.000Z' },
          {
            id: 'b3',
            sql: "SELECT '0123456789abcdef0123456789abcdef'",
            name: 'Opaque',
            time: '2026-10-01T07:00:00.000Z',
          },
        ],
      }),
    );
  }, SCOPE_KEY);
  await page.goto('/');
  await signIn(page);
  await toServer(page);
  const panel = page.locator('#config-store');
  await expect(panel).toContainText('3 Lesezeichen und 0 Verlaufseinträge würden übertragen');
  expect((await list(request, 'bookmarks')).length).toBe(0);
  await panel.getByRole('checkbox', { name: /Auch den lokalen Verlauf/ }).check();
  await expect(panel.getByRole('button', { name: 'Jetzt übertragen' })).toBeDisabled();
  await panel.getByRole('checkbox', { name: /Ich bestätige/ }).check();
  await panel.getByRole('button', { name: 'Jetzt übertragen' }).dblclick();
  await expect(panel).toContainText(
    'Übertragen: 3 neu, 0 schon vorhanden, 0 aktualisiert, 1 abgelehnt',
  );
  const bookmarks = await list(request, 'bookmarks');
  expect(bookmarks.map((b) => b.data.name).sort()).toEqual(['Local one', 'Local two']);
  expect((await list(request, 'history')).map((h) => h.data.sql)).toEqual(['SELECT 41']);
  const privacy = await api(request, '/api/v24/config/settings?scope=&key=privacy');
  expect(privacy.json.items[0].data).toEqual({ history_enabled: true });
  // Rejected entry stays local; nothing is deleted before the explicit second action.
  expect(
    await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).bookmarks.length, SCOPE_KEY),
  ).toBe(3);
  // A second run (new page load, new local ids) finds everything already there.
  await page.reload();
  await signIn(page);
  await toServer(page);
  await panel.getByRole('checkbox', { name: /Auch den lokalen Verlauf/ }).check();
  await panel.getByRole('checkbox', { name: /Ich bestätige/ }).check();
  await panel.getByRole('button', { name: 'Jetzt übertragen' }).click();
  await expect(panel).toContainText('0 neu, 3 schon vorhanden');
  expect((await list(request, 'bookmarks')).length).toBe(2);
  expect((await list(request, 'history')).length).toBe(1);
  await panel
    .getByRole('button', { name: 'Übertragene Einträge aus diesem Browser löschen' })
    .click();
  await expect(panel).toContainText('3 lokale Einträge gelöscht');
  const left = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), SCOPE_KEY);
  expect(left.bookmarks.map((b: { name: string }) => b.name)).toEqual(['Opaque']);
  expect(left.history).toEqual([]);
});

test('history is written only with the server opt-in; secrets are refused without echoing the SQL; 412 offers the merge choice', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await signIn(page);
  await connect(page);
  await toServer(page);
  const panel = page.locator('#config-store');
  const optIn = panel.getByRole('checkbox', { name: 'Abfrageverlauf auf dem Server speichern' });
  await expect(optIn).toBeChecked(); // migrated above
  await optIn.uncheck();
  await expect
    .poll(
      async () =>
        (await api(request, '/api/v24/config/settings?scope=&key=privacy')).json.items[0].data
          .history_enabled,
    )
    .toBe(false);
  await toSql(page);
  const editor = page.locator('#sql-editor');
  await editor.fill('SELECT 100');
  await editor.press('Control+Enter');
  await expect(page.getByText('Ergebnis 1').first()).toBeVisible();
  expect((await list(request, 'history')).map((h) => h.data.sql)).toEqual(['SELECT 41']); // nothing new
  // Server refuses a history write directly (409 history_disabled).
  const refused = await api(request, '/api/v24/config/history', {
    method: 'POST',
    data: { scope: 'a'.repeat(64), data: { sql: 'SELECT 1' } },
  });
  expect(refused.status).toBe(409);
  expect(refused.json.error.code).toBe('history_disabled');
  await toServer(page);
  await optIn.check();
  await expect
    .poll(
      async () =>
        (await api(request, '/api/v24/config/settings?scope=&key=privacy')).json.items[0].data
          .history_enabled,
    )
    .toBe(true);
  await toSql(page);
  await editor.fill('SELECT 200');
  await editor.press('Control+Enter');
  await expect
    .poll(async () => (await list(request, 'history')).map((h) => h.data.sql))
    .toContain('SELECT 200');
  // Bookmark the local rules let pass, the server rejects: only catalog text, never the SQL.
  await page.getByLabel('Name des Lesezeichens').fill('Opaque');
  await editor.fill("SELECT '0123456789abcdef0123456789abcdef'");
  await page.getByRole('button', { name: 'Als Lesezeichen speichern' }).click();
  const alert = page.getByRole('alert').first();
  await expect(alert).toContainText('Zugangsdaten');
  await expect(alert).not.toContainText('0123456789abcdef');
  // A normal bookmark, saved with a double click: exactly one entry.
  await editor.fill('SELECT 300');
  await page.getByLabel('Name des Lesezeichens').fill('Three hundred');
  const before = (await list(request, 'bookmarks')).length;
  await page.getByRole('button', { name: 'Als Lesezeichen speichern' }).dblclick();
  await expect(page.getByText('Lesezeichen gespeichert.')).toBeVisible();
  expect((await list(request, 'bookmarks')).length).toBe(before + 1);
  // Concurrent change elsewhere: stale edit -> 412 -> merge choice, server version untouched until chosen.
  const mine = (await list(request, 'bookmarks')).find((b) => b.data.name === 'Three hundred')!;
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Three hundred' })
    .getByRole('button', { name: 'Bearbeiten' })
    .click();
  const put = await request.fetch(`${config.backendURL}/api/v24/config/bookmarks/${mine.id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${config.token}`, 'If-Match': `"${mine.version}"` },
    data: { data: { name: 'Elsewhere', sql: 'SELECT 300' } },
  });
  expect(put.status()).toBe(200);
  await page.getByLabel('Neuer Name').fill('Mine');
  await page.getByRole('button', { name: 'Änderung speichern' }).click();
  const merge = page.getByRole('alert').filter({ hasText: 'inzwischen geändert' });
  await expect(merge).toContainText('Elsewhere');
  expect((await list(request, 'bookmarks')).find((b) => b.id === mine.id)!.data.name).toBe(
    'Elsewhere',
  );
  await merge.getByRole('button', { name: 'Meine Fassung speichern' }).click();
  await expect
    .poll(async () => (await list(request, 'bookmarks')).find((b) => b.id === mine.id)!.data.name)
    .toBe('Mine');
  // Reload: the data comes from the server.
  await page.reload();
  await signIn(page);
  await connect(page);
  await expect(page.locator('.sql-library pre', { hasText: 'SELECT 200' })).toBeVisible();
  await expect(page.locator('.sql-library strong', { hasText: 'Mine' })).toBeVisible();
});

test('theme and language are stored on the server (allowlisted values only) and applied on the next visit', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await signIn(page);
  await toServer(page);
  const settings = page.locator('#settings');
  await settings.getByLabel('Thema', { exact: true }).selectOption('dark');
  await expect
    .poll(
      async () =>
        (await api(request, '/api/v24/config/settings?scope=&key=appearance')).json.items[0]?.data,
    )
    .toEqual({ theme: 'dark', locale: 'de' });
  await page.reload();
  await signIn(page);
  await toServer(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await settings.getByLabel('Thema', { exact: true }).selectOption('system');
  await expect
    .poll(
      async () =>
        (await api(request, '/api/v24/config/settings?scope=&key=appearance')).json.items[0].data
          .theme,
    )
    .toBe('system');
});

test('export downloads the server document; delete everything needs preview and the typed confirmation', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await signIn(page);
  await toServer(page);
  const panel = page.locator('#config-store');
  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Alle Serverdaten exportieren (JSON)' }).click();
  const file = await download;
  const text = readFileSync((await file.path())!, 'utf8');
  const exported = JSON.parse(text);
  expect(exported.format).toBe('dbm-config-export');
  expect(exported.items.length).toBeGreaterThan(3);
  await panel.getByRole('button', { name: 'Alle gespeicherten Daten löschen' }).click();
  const confirmation = `LÖSCHEN ${exported.items.length}`;
  await expect(panel.getByLabel(/Tippe zur Bestätigung/)).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Endgültig löschen' })).toBeDisabled();
  await panel.getByLabel(/Tippe zur Bestätigung/).fill('LÖSCHEN 0');
  await expect(panel.getByRole('button', { name: 'Endgültig löschen' })).toBeDisabled();
  expect((await list(request, 'bookmarks')).length).toBeGreaterThan(0);
  await panel.getByLabel(/Tippe zur Bestätigung/).fill(confirmation);
  await panel.getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(panel).toContainText(`${exported.items.length} Einträge gelöscht`);
  for (const kind of ['history', 'bookmarks', 'settings'])
    expect((await list(request, kind)).length).toBe(0);
});

test('outage of the state database: local mode reason, buffered write, recovery without loss', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await signIn(page);
  await connect(page);
  await expect(page.getByText('Gespeichert auf dem Server')).toBeVisible();
  const docker = (...args: string[]) => execFileSync('docker', [...args], { stdio: 'pipe' });
  docker('stop', config.container);
  try {
    await expect
      .poll(async () => (await api(request, '/api/v24/capabilities')).json.reason, {
        timeout: 60000,
        intervals: [1000],
      })
      .toBe('unreachable');
    expect((await api(request, '/api/v24/config/status')).status).toBe(503);
    await page.locator('#sql-editor').fill('SELECT 777');
    await page.getByLabel('Name des Lesezeichens').fill('Buffered');
    await page.getByRole('button', { name: 'Als Lesezeichen speichern' }).click();
    await expect(page.getByText('noch nicht auf dem Server')).toBeVisible();
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem('db-manager.config-buffer.v1')!).entries.length,
      ),
    ).toBe(1);
  } finally {
    docker('start', config.container);
  }
  await expect
    .poll(async () => (await api(request, '/api/v24/capabilities')).json.mode, {
      timeout: 90000,
      intervals: [1000],
    })
    .toBe('server');
  await toServer(page);
  await expect
    .poll(async () => (await list(request, 'bookmarks')).map((b) => b.data.name), {
      timeout: 30000,
    })
    .toContain('Buffered');
  const names = (await list(request, 'bookmarks')).map((b) => b.data.name);
  expect(names.filter((n) => n === 'Buffered')).toHaveLength(1);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('db-manager.config-buffer.v1')))
    .toBeNull();
});

test('a backend without server state keeps the local mode with the reason (second backend)', async ({
  page,
}) => {
  await page.goto(config.localOnlyURL);
  await page.getByRole('button', { name: 'Backend-Zugang' }).click();
  await page.getByLabel('Zugriffstoken').fill(config.token);
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await toServer(page);
  const panel = page.locator('#config-store');
  await expect(panel).toContainText('Lokaler Modus');
  await expect(panel).toContainText('keinen Zustandsspeicher eingerichtet');
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill(config.connection.database);
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Verlauf speichern' })).toBeVisible();
});
