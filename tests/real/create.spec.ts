// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync(process.env.DBM_REAL_CONFIG!, 'utf8'));
async function connect(page: Page, driver: string) {
  await page.setViewportSize(
    driver === 'sqlite' ? { width: 1440, height: 1000 } : { width: 1024, height: 768 },
  );
  await page.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) =>
      window.cspViolations.push(event.violatedDirective),
    );
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Backend-Zugang' }).click();
  await page.getByLabel('Zugriffstoken').fill(config.token);
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  if (driver === 'postgresql') await page.getByRole('button', { name: 'PostgreSQL' }).click();
  await page
    .getByLabel('Datenbank', { exact: true })
    .fill(driver === 'sqlite' ? 'f3_fixture' : 'f3_probe');
  if (driver === 'postgresql') {
    await page.getByLabel('Host', { exact: true }).fill('localhost');
    await page.getByLabel('Port', { exact: true }).fill(String(config.postgresPort));
    await page.getByLabel('Benutzername').fill('postgres');
    await page.getByLabel('Passwort', { exact: true }).fill(config.password);
  }
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Neue Tabelle', exact: true })).toBeEnabled();
}
async function open(page: Page, name: string) {
  await page.getByRole('button', { name: 'Neue Tabelle', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Neue Tabelle anlegen', exact: true });
  await expect(dialog.getByLabel('Neuer Tabellenname')).toBeVisible();
  await dialog.getByLabel('Neuer Tabellenname').fill(name);
  return dialog;
}
async function confirm(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Neue Tabelle anlegen', exact: true });
  await dialog.getByRole('button', { name: 'Definition prüfen', exact: true }).click();
  const submit = dialog.getByRole('button', { name: 'Tabelle verbindlich anlegen', exact: true });
  await expect(submit).toBeDisabled();
  await dialog.getByLabel('Tabellenanlage ausdrücklich bestätigen').check();
  await submit.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  return dialog;
}
for (const driver of ['sqlite', 'postgresql']) {
  test(`${driver}: confirmed new table, typed defaults, ordered keys, conflict and failed catalog read`, async ({
    page,
  }) => {
    await connect(page, driver);
    const requests: any[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/api/v6/tables/create')) requests.push(request.postDataJSON());
    });
    const name = `f7_created_${driver}`;
    const dialog = await open(page, name);
    await dialog.getByRole('button', { name: 'Spalte hinzufügen', exact: true }).click();
    await dialog.getByLabel('Spalte 2 Name', { exact: true }).fill('part');
    await dialog.getByLabel('Spalte 2 Textlänge', { exact: true }).fill('16');
    await dialog.getByLabel('Spalte 2 erlaubt NULL', { exact: true }).uncheck();
    await dialog.getByLabel('Spalte 2 Primärschlüssel', { exact: true }).check();
    await dialog.getByRole('button', { name: 'Schlüssel 2 nach oben', exact: true }).click();
    await dialog.getByLabel('Spalte 2 Defaultmodus', { exact: true }).selectOption('value');
    await dialog.getByLabel('Spalte 2 Defaultwert', { exact: true }).fill('part-default');
    await dialog.getByRole('button', { name: 'Spalte hinzufügen', exact: true }).click();
    await dialog.getByLabel('Spalte 3 Name', { exact: true }).fill('optional');
    await dialog.getByLabel('Spalte 3 Defaultmodus', { exact: true }).selectOption('null');
    await dialog.getByRole('button', { name: 'Spalte hinzufügen', exact: true }).click();
    await dialog.getByLabel('Spalte 4 Name', { exact: true }).fill('empty');
    await dialog.getByLabel('Spalte 4 Defaultmodus', { exact: true }).selectOption('value');
    await dialog.getByLabel('Spalte 4 Defaultwert', { exact: true }).fill('');
    await dialog.getByRole('button', { name: 'Spalte hinzufügen', exact: true }).click();
    await dialog.getByLabel('Spalte 5 Name', { exact: true }).fill('precise');
    await dialog.getByLabel('Spalte 5 Typ', { exact: true }).selectOption('decimal');
    await dialog.getByLabel('Spalte 5 Präzision', { exact: true }).fill('38');
    await dialog.getByLabel('Spalte 5 Skala', { exact: true }).fill('20');
    await dialog.getByLabel('Spalte 5 Defaultmodus', { exact: true }).selectOption('value');
    await dialog
      .getByLabel('Spalte 5 Defaultwert', { exact: true })
      .fill('123456789012345678.12345678901234567890');
    await page.route('**/api/v1/catalog', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'database_error', message: 'Synthetic readonly catalog unavailable' },
        }),
      }),
    );
    await confirm(page);
    await expect(
      dialog.getByRole('heading', { name: 'Anlage bestätigt', exact: true }),
    ).toBeVisible();
    await expect(dialog.getByRole('status')).toContainText('Anlage bleibt bestätigt');
    expect(requests).toHaveLength(1);
    expect(requests[0].primary_key).toEqual(['part', 'id']);
    expect(requests[0].columns[3].default).toEqual({
      mode: 'value',
      value: { kind: 'text', value: '' },
    });
    expect(requests[0].columns[4].default.value.value).toBe(
      '123456789012345678.12345678901234567890',
    );
    expect(requests[0]).not.toHaveProperty('sql');
    const probe = await page.request.post('/api/v2/tables/describe', {
      headers: { Authorization: 'Bearer ' + config.token },
      data: { connection: requests[0].connection, table: { name } },
    });
    expect(probe.status()).toBe(200);
    const actual = await probe.json();
    expect(actual.primary_key).toEqual(['part', 'id']);
    expect(actual.columns.map((c: any) => c.name)).toEqual([
      'id',
      'part',
      'optional',
      'empty',
      'precise',
    ]);
    await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
    await page.unroute('**/api/v1/catalog');
    await page.getByRole('button', { name: 'Objekte aktualisieren', exact: true }).click();
    await expect(page.getByRole('button', { name: new RegExp(`${name}$`) })).toBeVisible();
    const conflict = await open(page, name);
    await confirm(page);
    await expect(conflict).toContainText('Die vorhandene Tabelle bleibt unverändert');
    expect(requests).toHaveLength(2);
    const unchanged = await page.request.post('/api/v2/tables/describe', {
      headers: { Authorization: 'Bearer ' + config.token },
      data: { connection: requests[0].connection, table: { name } },
    });
    expect((await unchanged.json()).columns).toEqual(actual.columns);
    await conflict.getByRole('button', { name: 'Schließen', exact: true }).click();
    await page.route('**/api/v6/capabilities', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'not_found', message: 'Synthetic legacy boundary' },
        }),
      }),
    );
    const legacy = await open(page, 'unused');
    await expect(legacy).toContainText('Diese Instanz bietet keine freigegebene Tabellenanlage');
    await legacy.getByRole('button', { name: 'Schließen', exact: true }).click();
    await page.unroute('**/api/v6/capabilities');
    expect(requests).toHaveLength(2);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
  });
  test(`${driver}: actual committed create answer loss is never retried and session cleanup keeps only generic uncertainty`, async ({
    page,
  }) => {
    await connect(page, driver);
    let count = 0;
    let input: any;
    let held = false;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/v6/tables/create', async (route) => {
      count++;
      input = route.request().postDataJSON();
      const actual = await route.fetch();
      expect(actual.status()).toBe(200);
      expect((await actual.json()).outcome).toBe('created');
      await route.abort('failed');
    });
    const name = `f7_lost_${driver}`;
    const dialog = await open(page, name);
    await confirm(page);
    await expect(dialog).toContainText('Die Tabelle könnte bereits angelegt sein');
    await expect(dialog.getByRole('button', { name: 'Tabelle verbindlich anlegen' })).toHaveCount(
      0,
    );
    expect(count).toBe(1);
    const actual = await page.request.post('/api/v2/tables/describe', {
      headers: { Authorization: 'Bearer ' + config.token },
      data: { connection: input.connection, table: { name } },
    });
    expect(actual.status()).toBe(200);
    await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
    await page.unroute('**/api/v6/tables/create');
    await page.route('**/api/v6/tables/create', async (route) => {
      count++;
      input = route.request().postDataJSON();
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      held = true;
      await barrier;
      try {
        await route.fulfill({ response });
      } catch {
        /* Original browser session was explicitly aborted. */
      }
    });
    const heldName = `f7_held_${driver}`;
    const pending = await open(page, heldName);
    await confirm(page);
    await expect.poll(() => held).toBe(true);
    await pending.getByRole('button', { name: 'Schließen', exact: true }).click();
    await page.getByRole('button', { name: 'Backend-Zugang' }).click();
    await page.getByLabel('Zugriffstoken').fill(config.invalidToken);
    await page.getByRole('button', { name: 'Übernehmen' }).click();
    release();
    await expect(page.getByRole('dialog', { name: 'Neue Tabelle anlegen' })).toHaveCount(0);
    await expect(page.getByText(heldName, { exact: true })).toHaveCount(0);
    await expect(page.getByText('Nicht verbunden', { exact: true })).toBeVisible();
    expect(count).toBe(2);
    const committed = await page.request.post('/api/v2/tables/describe', {
      headers: { Authorization: 'Bearer ' + config.token },
      data: { connection: input.connection, table: { name: heldName } },
    });
    expect(committed.status()).toBe(200);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
  });
}
