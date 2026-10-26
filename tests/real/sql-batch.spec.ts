// SPDX-License-Identifier: AGPL-3.0-only
// Requires an isolated backend and databases configured via DBM_REAL_CONFIG.
// Independent read-back uses v1, never the response being verified.
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
const config = process.env.DBM_REAL_CONFIG
  ? JSON.parse(readFileSync(process.env.DBM_REAL_CONFIG, 'utf8'))
  : null;
test.skip(!config, 'DBM_REAL_CONFIG and isolated databases are required');
type Driver = 'sqlite' | 'postgresql';
const connectionFor = (driver: Driver) =>
  driver === 'sqlite'
    ? { driver: 'sqlite', database: config.sqliteDatabase ?? 'sqlbatch_fixture' }
    : {
        driver: 'postgres',
        host: 'localhost',
        port: config.postgresPort,
        username: 'postgres',
        password: config.password,
        database: config.postgresDatabase ?? 'f3_probe',
        tls_mode: 'verify-full',
      };
async function query(request: APIRequestContext, driver: Driver, sql: string) {
  const response = await request.post(`${config.backendURL}/api/v1/query`, {
    headers: { Authorization: `Bearer ${config.token}` },
    data: { connection: connectionFor(driver), sql },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).results as { rows: { value?: string }[][] }[];
}
async function count(request: APIRequestContext, driver: Driver, table = 'wp15_probe') {
  return Number(
    (await query(request, driver, `SELECT count(*) FROM "${table}"`))[0].rows[0][0].value,
  );
}
async function open(page: Page, driver: Driver) {
  const connection = connectionFor(driver);
  await page.goto('/');
  await page.getByRole('button', { name: 'Backend-Zugang' }).click();
  await page.getByLabel('Zugriffstoken').fill(config.token);
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  if (driver === 'postgresql') await page.getByRole('button', { name: 'PostgreSQL' }).click();
  await page.getByLabel('Datenbank', { exact: true }).fill(connection.database);
  if (driver === 'postgresql') {
    await page.getByLabel('Host', { exact: true }).fill('localhost');
    await page.getByLabel('Port', { exact: true }).fill(String(config.postgresPort));
    await page.getByLabel('Benutzername').fill('postgres');
    await page.getByLabel('Passwort', { exact: true }).fill(config.password);
  }
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'SQL-Stapel', exact: true }).click();
  await expect(page.getByTestId('batch-driver-reason')).toBeVisible();
}
async function run(page: Page, sql: string, action = 'batch', mode = 'stop') {
  await page.getByRole('combobox', { name: /^Aktion/ }).selectOption(action);
  if (action === 'batch')
    await page.getByRole('combobox', { name: /^Bei Statementfehler/ }).selectOption(mode);
  await page.getByTestId('batch-sql').fill(sql);
  for (const box of await page.getByTestId('sql-batch-panel').getByRole('checkbox').all())
    await box.check();
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === `/api/v12/sql/${action}`,
  );
  await page.getByRole('button', { name: 'Bestätigt ausführen' }).click();
  const received = await response;
  await expect(page.getByTestId('batch-sql')).toBeEnabled();
  return received;
}

for (const driver of ['sqlite', 'postgresql'] as const) {
  test(`${driver}: real stop/continue, dialect EXPLAIN, and independent simulation read-back`, async ({
    page,
    request,
  }) => {
    await query(request, driver, 'DROP TABLE IF EXISTS "wp15_probe"');
    await query(request, driver, 'CREATE TABLE "wp15_probe" (id INTEGER PRIMARY KEY, value TEXT)');
    try {
      await query(request, driver, "INSERT INTO wp15_probe VALUES (1, 'initial')");
      await open(page, driver);
      let response = await run(
        page,
        "INSERT INTO wp15_probe VALUES (1, 'duplicate'); INSERT INTO wp15_probe VALUES (2, 'after');",
        'batch',
        'stop',
      );
      expect(response.status()).toBe(200);
      await expect(page.getByTestId('batch-statement').nth(1)).toHaveAttribute(
        'data-outcome',
        'not_executed',
      );
      expect(await count(request, driver)).toBe(1);
      response = await run(
        page,
        "INSERT INTO wp15_probe VALUES (1, 'duplicate'); INSERT INTO wp15_probe VALUES (2, 'after');",
        'batch',
        'continue',
      );
      expect(response.status()).toBe(200);
      await expect(page.getByTestId('batch-statement').nth(1)).toHaveAttribute(
        'data-outcome',
        'completed',
      );
      expect(await count(request, driver)).toBe(2);
      response = await run(page, 'DELETE FROM wp15_probe', 'explain');
      expect(response.status()).toBe(200);
      await expect(page.getByTestId('batch-statement')).toHaveAttribute(
        'data-outcome',
        'completed',
      );
      expect(await count(request, driver)).toBe(2);
      if (driver === 'sqlite') {
        response = await run(page, 'DELETE FROM wp15_probe', 'simulate');
        expect(response.status()).toBe(200);
        await expect(page.getByTestId('simulation-result')).toHaveAttribute(
          'data-outcome',
          'rolled_back',
        );
        expect(await count(request, driver)).toBe(2);
      } else {
        await page.getByRole('combobox', { name: /^Aktion/ }).selectOption('simulate');
        await expect(page.getByTestId('simulation-unsupported')).toContainText('Sequenzen');
        await expect(page.getByRole('button', { name: 'Bestätigt ausführen' })).toBeDisabled();
      }
    } finally {
      await query(request, driver, 'DROP TABLE IF EXISTS "wp15_probe"');
    }
  });
}

test('sqlite: 422 BEGIN…END help, DELIMITER trigger, and rollback includes trigger writes', async ({
  page,
  request,
}) => {
  for (const name of ['wp15_probe', 'wp15_audit'])
    await query(request, 'sqlite', `DROP TABLE IF EXISTS "${name}"`);
  await query(request, 'sqlite', 'CREATE TABLE wp15_probe (id INTEGER PRIMARY KEY, value TEXT)');
  await query(request, 'sqlite', 'CREATE TABLE wp15_audit (value TEXT)');
  try {
    await open(page, 'sqlite');
    const trigger =
      'CREATE TRIGGER wp15_trigger AFTER INSERT ON wp15_probe BEGIN INSERT INTO wp15_audit VALUES (NEW.value); END';
    expect((await run(page, `${trigger};`)).status()).toBe(422);
    await expect(page.getByTestId('sql-batch-panel').getByRole('alert')).toContainText(
      'DELIMITER //',
    );
    expect((await run(page, `DELIMITER //\n${trigger}//\nDELIMITER ;`)).status()).toBe(200);
    await expect(page.getByTestId('batch-statement')).toHaveAttribute('data-outcome', 'completed');
    expect(
      (await run(page, "INSERT INTO wp15_probe VALUES (1, 'rollback')", 'simulate')).status(),
    ).toBe(200);
    await expect(page.getByTestId('simulation-result')).toHaveAttribute(
      'data-outcome',
      'rolled_back',
    );
    expect(await count(request, 'sqlite')).toBe(0);
    expect(await count(request, 'sqlite', 'wp15_audit')).toBe(0);
  } finally {
    await query(request, 'sqlite', 'DROP TABLE wp15_probe');
    await query(request, 'sqlite', 'DROP TABLE wp15_audit');
  }
});
