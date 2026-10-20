// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, type Page } from '@playwright/test';
const capabilities = {
  contract_version: '0.1.0',
  drivers: ['sqlite', 'mysql', 'postgres'],
  credential_storage: false,
  max_rows: 10000,
  max_timeout_ms: 60000,
};
const result = {
  duration_ms: 12,
  results: [
    {
      columns: [
        { name: 'id', database_type: 'BIGINT' },
        { name: 'optional', database_type: 'TEXT' },
        { name: 'empty', database_type: 'TEXT' },
        { name: 'payload', database_type: 'BLOB' },
      ],
      rows: [
        [
          { kind: 'integer', value: '9007199254740993123456789' },
          { kind: 'null' },
          { kind: 'text', value: '' },
          { kind: 'binary', value: 'AAEC' },
        ],
      ],
      truncated: true,
    },
  ],
};
async function setToken(page: Page) {
  await page.getByRole('button', { name: 'Backend-Zugang' }).click();
  await page.getByLabel('Zugriffstoken').fill('synthetic-token');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
}
async function connect(page: Page) {
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Name optional').fill('Testverbindung');
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbindung testen' }).click();
  await expect(
    page.getByText('Verbindung erfolgreich. Die Datenbank ist erreichbar.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
}

test('auth, connection, catalog, explicit SQL, precision, truncation, cancellation and ephemeral session', async ({
  page,
}) => {
  let queries = 0;
  let slowQuery = false;
  const requestLeaks: string[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    if (request.url().includes('synthetic-token') || request.url().includes('synthetic-password'))
      requestLeaks.push(request.url());
    if (request.headers().authorization !== 'Bearer synthetic-token')
      return route.fulfill({
        status: 401,
        json: { error: { code: 'unauthorized', message: 'Anmeldung erforderlich.' } },
      });
    if (request.url().endsWith('/capabilities')) return route.fulfill({ json: capabilities });
    if (request.url().endsWith('/connections/test'))
      return route.fulfill({ json: { status: 'ok' } });
    if (request.url().endsWith('/catalog'))
      return route.fulfill({
        json: { tables: [{ name: 'orders', schema: 'main', kind: 'table' }] },
      });
    if (request.url().endsWith('/query')) {
      queries++;
      if (slowQuery) await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.fulfill({ json: result }).catch(() => {});
    }
  });
  await page.goto('/');
  await expect(page.getByText('Nicht verbunden', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await expect(page.getByText(/Der Zugriffstoken fehlt/)).toBeVisible();
  await page.getByRole('button', { name: 'Schließen' }).click();
  await setToken(page);
  await connect(page);
  await page.getByRole('button', { name: 'orders' }).click();
  await expect(page.getByRole('textbox', { name: 'SQL-Abfrage', exact: true })).toHaveValue(
    'SELECT * FROM "main"."orders";',
  );
  expect(queries).toBe(0);
  await page
    .getByRole('textbox', { name: 'SQL-Abfrage', exact: true })
    .fill('SELECT * FROM synthetic;');
  expect(queries).toBe(0);
  await page.keyboard.press('Control+Enter');
  await expect(page.getByText('9007199254740993123456789', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'null: NULL' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'text:', exact: true })).toHaveText('""');
  await expect(page.getByRole('button', { name: 'binary: AAEC' })).toBeVisible();
  await expect(page.getByText(/Ergebnis begrenzt/)).toBeVisible();
  expect(queries).toBe(1);
  await page.screenshot({ path: '/tmp/db-manager-f1-desktop.png', fullPage: true });
  slowQuery = true;
  await page.getByRole('button', { name: 'Abfrage ausführen' }).click();
  await expect(page.getByRole('button', { name: 'Abbrechen' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Abbruch angefordert', { exact: true })).toBeVisible();
  const persisted = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
    url: location.href,
  }));
  expect(JSON.stringify(persisted)).not.toContain('synthetic-token');
  expect(persisted.local).toEqual({});
  expect(persisted.session).toEqual({});
  expect(requestLeaks).toEqual([]);
  await page.reload();
  await expect(page.getByText('Nicht verbunden', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'SQL-Abfrage', exact: true })).toHaveValue('');
});

test('unavailable backend drivers never report a successful connection', async ({ page }) => {
  await page.route('**/api/v1/capabilities', (route) =>
    route.fulfill({ json: { ...capabilities, drivers: [] } }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await expect(
    page.getByText('Dieses Backend bietet derzeit keine Datenbanktreiber an.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Verbinden', exact: true })).toBeDisabled();
});

test('responsive iPad workbench preserves navigation and editor access', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'SQL-Arbeitsbereich' })).toBeVisible();
  await page.getByRole('button', { name: 'Navigation öffnen' }).click();
  await expect(page.getByRole('complementary', { name: 'Datenbanknavigation' })).toBeInViewport();
  await page.getByRole('button', { name: 'Navigation schließen' }).first().click();
  await expect(
    page.getByRole('complementary', { name: 'Datenbanknavigation' }),
  ).not.toBeInViewport();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('textbox', { name: 'SQL-Abfrage', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '/tmp/db-manager-f1-ipad.png', fullPage: true });
});

test('network credentials stay ephemeral and clearing a running session cannot revive old data', async ({
  page,
}) => {
  const logs: string[] = [];
  let receivedPassword = '';
  let queryRequests = 0;
  page.on('console', (message) => logs.push(message.text()));
  page.on('pageerror', (error) => logs.push(error.message));
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    expect(request.url()).not.toMatch(/synthetic-(token|password)/);
    if (request.url().endsWith('/capabilities'))
      return route.fulfill({ json: { ...capabilities, drivers: ['mysql'] } });
    if (request.url().endsWith('/connections/test')) {
      const connection = request.postDataJSON().connection;
      receivedPassword = connection.password;
      expect(connection.tls_mode).toBe('verify-full');
      return route.fulfill({ json: { status: 'ok' } });
    }
    if (request.url().endsWith('/catalog')) return route.fulfill({ json: { tables: [] } });
    if (request.url().endsWith('/query')) {
      queryRequests++;
      await new Promise((resolve) => setTimeout(resolve, 500));
      return route.fulfill({ json: result }).catch(() => {});
    }
  });
  await page.goto('/');
  await setToken(page);
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByRole('button', { name: 'MySQL / MariaDB' }).click();
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByLabel('Benutzername').fill('synthetic-user');
  await page.getByLabel('Passwort', { exact: true }).fill('synthetic-password');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
  expect(receivedPassword).toBe('synthetic-password');
  await page.getByRole('textbox', { name: 'SQL-Abfrage', exact: true }).fill('SELECT 1');
  await page.getByRole('button', { name: 'Abfrage ausführen' }).click();
  await expect.poll(() => queryRequests).toBe(1);
  await page.getByRole('button', { name: 'Backend-Zugang' }).click();
  await page.getByRole('button', { name: 'Sitzung leeren' }).click();
  await expect(page.getByText('Nicht verbunden', { exact: true })).toBeVisible();
  await expect(page.getByText('Platz für deine Ergebnisse', { exact: true })).toBeVisible();
  await expect(page.getByText('9007199254740993123456789', { exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Backend-Zugang' }).click();
  await expect(page.getByLabel('Zugriffstoken')).toHaveValue('');
  const state = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
      cookies: document.cookie,
    }),
  );
  expect(state).not.toMatch(/synthetic-(token|password)/);
  expect(logs.join('\n')).not.toMatch(/synthetic-(token|password)/);
});

test('changing the backend token invalidates the complete previous session and delayed query', async ({
  page,
}) => {
  let queries = 0;
  let releaseOldResponse!: () => void;
  let oldResponseAttempted = false;
  let latestCapabilityToken = '';
  const oldResponseGate = new Promise<void>((resolve) => {
    releaseOldResponse = resolve;
  });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    if (request.url().endsWith('/capabilities')) {
      latestCapabilityToken = request.headers().authorization;
      return route.fulfill({ json: capabilities });
    }
    if (request.url().endsWith('/connections/test'))
      return route.fulfill({ json: { status: 'ok' } });
    if (request.url().endsWith('/catalog'))
      return route.fulfill({
        json: { tables: [{ name: 'orders', schema: 'main', kind: 'table' }] },
      });
    if (request.url().endsWith('/query')) {
      queries++;
      if (queries === 2) {
        await oldResponseGate;
        await route.fulfill({ json: result }).catch(() => {});
        oldResponseAttempted = true;
        return;
      }
      return route.fulfill({ json: result });
    }
  });
  await page.goto('/');
  await setToken(page);
  await connect(page);
  await page
    .getByRole('textbox', { name: 'SQL-Abfrage', exact: true })
    .fill('SELECT synthetic_old_session;');
  await page.getByRole('button', { name: 'Abfrage ausführen' }).click();
  await expect(page.getByText('9007199254740993123456789', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Abfrage ausführen' }).click();
  await expect.poll(() => queries).toBe(2);
  await page.getByRole('button', { name: 'Backend-Zugang' }).click();
  await page.getByLabel('Zugriffstoken').fill('synthetic-next-token');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByText('Nicht verbunden', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'SQL-Abfrage', exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'orders' })).not.toBeVisible();
  await expect(page.getByText('9007199254740993123456789', { exact: true })).not.toBeVisible();
  releaseOldResponse();
  await expect.poll(() => oldResponseAttempted).toBe(true);
  await expect(page.getByText('Platz für deine Ergebnisse', { exact: true })).toBeVisible();
  await expect(page.getByText('Abbruch angefordert', { exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await expect.poll(() => latestCapabilityToken).toBe('Bearer synthetic-next-token');
  expect(queries).toBe(2);
});

test('a successful DML response without an affected-row count does not display zero', async ({
  page,
}) => {
  await page.route('**/api/v1/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/capabilities')) return route.fulfill({ json: capabilities });
    if (url.endsWith('/connections/test')) return route.fulfill({ json: { status: 'ok' } });
    if (url.endsWith('/catalog')) return route.fulfill({ json: { tables: [] } });
    if (url.endsWith('/query'))
      return route.fulfill({
        json: { duration_ms: 1, results: [{ columns: [], rows: [], truncated: false }] },
      });
  });
  await page.goto('/');
  await setToken(page);
  await connect(page);
  await page
    .getByRole('textbox', { name: 'SQL-Abfrage', exact: true })
    .fill('UPDATE synthetic SET value = 1;');
  await page.getByRole('button', { name: 'Abfrage ausführen' }).click();
  await expect(page.getByText('Anweisung abgeschlossen', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Anzahl betroffener Zeilen nicht gemeldet', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('0 betroffene Zeilen', { exact: true })).not.toBeVisible();
});
