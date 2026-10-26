// SPDX-License-Identifier: AGPL-3.0-only
// Requires an isolated backend + web preview and DBM_REAL_CONFIG, as in the existing real suite.
// No mocks: plans and results come from the Go maintenance API; SQL independently checks data.
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync(process.env.DBM_REAL_CONFIG!, 'utf8'));
type Driver = 'sqlite' | 'postgresql';
const connectionFor = (driver: Driver) =>
  driver === 'sqlite'
    ? { driver: 'sqlite', database: 'maintenance_fixture' }
    : {
        driver: 'postgres',
        host: 'localhost',
        port: config.postgresPort,
        username: 'postgres',
        password: config.password,
        database: 'f3_probe',
        tls_mode: 'verify-full',
      };
const target = 'maintenance " quote;--';
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
async function query(request: APIRequestContext, driver: Driver, sql: string) {
  const response = await request.post(`${config.backendURL}/api/v1/query`, {
    headers: { Authorization: `Bearer ${config.token}` },
    data: { connection: connectionFor(driver), sql },
  });
  expect(response.status()).toBe(200);
  return response.json();
}
async function connect(page: Page, driver: Driver) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Backend-Zugang' }).click();
  await page.getByLabel('Zugriffstoken').fill(config.token);
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  if (driver === 'postgresql') await page.getByRole('button', { name: 'PostgreSQL' }).click();
  await page
    .getByLabel('Datenbank', { exact: true })
    .fill(driver === 'sqlite' ? 'maintenance_fixture' : 'f3_probe');
  if (driver === 'postgresql') {
    await page.getByLabel('Host', { exact: true }).fill('localhost');
    await page.getByLabel('Port', { exact: true }).fill(String(config.postgresPort));
    await page.getByLabel('Benutzername').fill('postgres');
    await page.getByLabel('Passwort', { exact: true }).fill(config.password);
  }
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: new RegExp('maintenance " quote;--') }).click();
  await page
    .getByRole('navigation', { name: 'Tabellenreiter' })
    .getByRole('button', { name: 'Tabellenwartung' })
    .click();
}
for (const driver of ['sqlite', 'postgresql'] as const) {
  test(`${driver}: real maintenance preserves target and neighboring data`, async ({
    page,
    request,
  }) => {
    const writes: unknown[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/api/v10/tables/maintenance'))
        writes.push(request.postDataJSON());
    });
    const table = quote(target);
    const neighbor = quote('maintenance_neighbor');
    try {
      await query(request, driver, `CREATE TABLE ${table} (id INTEGER PRIMARY KEY, v TEXT)`);
      await query(request, driver, `CREATE TABLE ${neighbor} (id INTEGER PRIMARY KEY, v TEXT)`);
      await query(request, driver, `INSERT INTO ${table} VALUES (1, 'keep')`);
      await query(request, driver, `INSERT INTO ${neighbor} VALUES (2, 'neighbor')`);
      const before = await query(request, driver, `SELECT * FROM ${table}`);
      const neighborBefore = await query(request, driver, `SELECT * FROM ${neighbor}`);
      await connect(page, driver);
      for (const action of driver === 'sqlite'
        ? ['check', 'analyze']
        : ['analyze', 'vacuum', 'reindex']) {
        await page.getByLabel('Wartungsaktion').selectOption(action);
        await page.getByRole('button', { name: 'Plan anzeigen' }).click();
        await expect(page.getByTestId('maintenance-plan')).toContainText(target);
        const count = writes.length;
        const typed = page.getByLabel(`Tabellenname exakt eingeben: ${target}`);
        await page.getByRole('checkbox', { name: /geprüft/ }).check();
        if (await typed.count()) {
          await typed.fill('wrong');
          await expect(page.getByRole('button', { name: 'Ausführen', exact: true })).toBeDisabled();
          expect(writes).toHaveLength(count);
          await typed.fill(target);
        }
        await page.getByRole('button', { name: 'Ausführen', exact: true }).evaluate((node) => {
          (node as HTMLButtonElement).click();
          (node as HTMLButtonElement).click();
        });
        await expect(page.getByTestId('maintenance-result')).toContainText('Abgeschlossen');
        expect(writes).toHaveLength(count + 1);
        await expect(page.getByRole('button', { name: 'Ausführen', exact: true })).toHaveCount(0);
        // Compare tagged row values only; elapsed time and other observations may change.
        expect((await query(request, driver, `SELECT * FROM ${table}`)).results[0].rows).toEqual(
          before.results[0].rows,
        );
        expect((await query(request, driver, `SELECT * FROM ${neighbor}`)).results[0].rows).toEqual(
          neighborBefore.results[0].rows,
        );
        await page.getByRole('button', { name: 'Neue Wartung vorbereiten' }).click();
      }
    } finally {
      await query(request, driver, `DROP TABLE IF EXISTS ${table}`);
      await query(request, driver, `DROP TABLE IF EXISTS ${neighbor}`);
    }
  });
}
