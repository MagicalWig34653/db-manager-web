// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync(process.env.DBM_REAL_CONFIG!, 'utf8'));

type Driver = 'sqlite' | 'postgresql';
const connectionFor = (driver: Driver) =>
  driver === 'sqlite'
    ? { driver: 'sqlite', database: 'ops_fixture' }
    : {
        driver: 'postgres',
        host: 'localhost',
        port: config.postgresPort,
        username: 'postgres',
        password: config.password,
        database: 'f3_probe',
        tls_mode: 'verify-full',
      };
// Independent read-back through the generic SQL route, not through the v8 API.
async function query(request: APIRequestContext, driver: Driver, sql: string) {
  const response = await request.post(`${config.backendURL}/api/v1/query`, {
    headers: { Authorization: `Bearer ${config.token}` },
    data: { connection: connectionFor(driver), sql },
  });
  expect(response.status(), sql).toBe(200);
  const body = await response.json();
  const results = body.results as { rows: { value?: string }[][] }[];
  return (results[0]?.rows ?? []).map((row) => row.map((cell) => cell.value ?? null));
}
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const quoted = (value: string) => `"${value.replaceAll('"', '""')}"`;
const tableExists = async (request: APIRequestContext, driver: Driver, name: string) =>
  (
    await query(
      request,
      driver,
      driver === 'sqlite'
        ? `SELECT name FROM sqlite_master WHERE type='table' AND name=${literal(name)}`
        : `SELECT tablename FROM pg_tables WHERE tablename=${literal(name)}`,
    )
  ).length === 1;
const count = async (request: APIRequestContext, driver: Driver, name: string) =>
  Number((await query(request, driver, `SELECT count(*) FROM ${quoted(name)}`))[0][0]);

async function connect(page: Page, driver: Driver) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Backend-Zugang' }).click();
  await page.getByLabel('Zugriffstoken').fill(config.token);
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  if (driver === 'postgresql') await page.getByRole('button', { name: 'PostgreSQL' }).click();
  await page
    .getByLabel('Datenbank', { exact: true })
    .fill(driver === 'sqlite' ? 'ops_fixture' : 'f3_probe');
  if (driver === 'postgresql') {
    await page.getByLabel('Host', { exact: true }).fill('localhost');
    await page.getByLabel('Port', { exact: true }).fill(String(config.postgresPort));
    await page.getByLabel('Benutzername').fill('postgres');
    await page.getByLabel('Passwort', { exact: true }).fill(config.password);
  }
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
}
async function openOps(page: Page, driver: Driver, name: string) {
  const schema = driver === 'sqlite' ? 'main' : 'public';
  await page.getByRole('button', { name: `${schema}.${name}`, exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Tabellenreiter' })
    .getByRole('button', { name: 'Operationen' })
    .click();
  await expect(page.getByTestId('table-ops')).toBeVisible();
}
const card = (page: Page, action: string) => page.getByTestId(`op-${action}`);
async function typeAndConfirm(page: Page, name: string) {
  const dialog = page.getByTestId('confirm-destructive');
  await dialog.getByRole('textbox').fill(name);
  await dialog.getByRole('button', { name: 'Ausführen' }).click();
}
async function refreshObjects(page: Page) {
  await page.getByRole('button', { name: 'Objekte aktualisieren' }).click();
}

for (const driver of ['sqlite', 'postgresql'] as const) {
  test(`${driver}: real plan, confirmation, copy, rename, truncate, drop and dependencies`, async ({
    page,
    request,
  }) => {
    const executes: string[] = [];
    const origins = new Set<string>();
    page.on('request', (item) => {
      origins.add(new URL(item.url()).origin);
      if (
        item.method() === 'POST' &&
        /\/api\/v8\/(?!.*plan$)(?!tables\/dependencies)/.test(item.url())
      )
        executes.push(item.url());
    });
    await page.addInitScript(() => {
      window.cspViolations = [];
      document.addEventListener('securitypolicyviolation', (event) =>
        window.cspViolations.push(event.violatedDirective),
      );
    });
    const odd = `p07 odd"name '1'; DROP TABLE keep_me;--`;
    await query(request, driver, 'CREATE TABLE keep_me (id INTEGER PRIMARY KEY, v TEXT)');
    await query(request, driver, "INSERT INTO keep_me VALUES (1, 'unchanged')");
    await query(request, driver, 'CREATE TABLE p07_parent (id INTEGER PRIMARY KEY, v TEXT)');
    await query(request, driver, "INSERT INTO p07_parent VALUES (1, 'p')");
    await query(
      request,
      driver,
      'CREATE TABLE p07_child (id INTEGER PRIMARY KEY, pid INTEGER REFERENCES p07_parent(id))',
    );
    await query(request, driver, 'INSERT INTO p07_child VALUES (1, 1)');
    await query(request, driver, `CREATE TABLE ${quoted(odd)} (id INTEGER PRIMARY KEY, v TEXT)`);
    await query(request, driver, `INSERT INTO ${quoted(odd)} VALUES (1,'a'),(2,'b'),(3,'c')`);

    await connect(page, driver);

    // 1. Referenced table: plan warns, a wrong name blocks, the server rejects, nothing changes.
    await openOps(page, driver, 'p07_parent');
    await page
      .getByTestId('deps-box')
      .getByRole('button', { name: 'Abhängigkeiten prüfen' })
      .click();
    await expect(page.getByTestId('deps-list')).toContainText('p07_child');
    const drop = card(page, 'table_drop');
    await drop.getByRole('button', { name: 'Plan anzeigen' }).click();
    await expect(page.getByTestId('plan-table_drop')).toContainText('DROP TABLE');
    await expect(page.getByTestId('dependencies')).toContainText('verhindert die Aktion');
    await drop.getByRole('button', { name: 'Ausführen' }).click();
    const dialog = page.getByTestId('confirm-destructive');
    await dialog.getByRole('textbox').fill('P07_parent');
    await expect(dialog.getByRole('button', { name: 'Ausführen' })).toBeDisabled();
    expect(executes).toHaveLength(0);
    await dialog.getByRole('textbox').fill('p07_parent');
    await dialog.getByRole('button', { name: 'Ausführen' }).dblclick();
    await expect(page.getByTestId('result-table_drop')).toHaveAttribute('data-outcome', 'rejected');
    await expect(page.getByTestId('result-table_drop')).toContainText('Fremdschlüssel');
    expect(executes).toHaveLength(1);
    expect(await tableExists(request, driver, 'p07_parent')).toBe(true);
    expect(await count(request, driver, 'p07_parent')).toBe(1);
    await expect(drop.getByRole('button', { name: 'Ausführen' })).toHaveCount(0);

    // 2. Copy (structure and data) of the special-name table: row count preserved.
    await openOps(page, driver, odd);
    const copy = card(page, 'table_copy');
    await copy.getByLabel('Neuer Name').fill(`p07 copy "x"`);
    await copy.getByRole('button', { name: 'Plan anzeigen' }).click();
    await expect(copy.getByTestId('plan-table_copy')).toBeVisible();
    await copy.getByRole('checkbox', { name: /Ich bestätige/ }).check();
    await copy.getByRole('button', { name: 'Ausführen' }).click();
    await expect(page.getByTestId('result-table_copy')).toHaveAttribute(
      'data-outcome',
      'completed',
    );
    await expect(page.getByTestId('observation')).toContainText('Zeilen: 3');
    expect(await count(request, driver, `p07 copy "x"`)).toBe(3);
    expect(await count(request, driver, odd)).toBe(3);

    // 3. Rename the copy.
    await refreshObjects(page);
    await openOps(page, driver, `p07 copy "x"`);
    const rename = card(page, 'table_rename');
    await rename.getByLabel('Neuer Name').fill("p07 renamed 'y'");
    await rename.getByRole('button', { name: 'Plan anzeigen' }).click();
    await rename.getByRole('button', { name: 'Ausführen' }).click();
    await typeAndConfirm(page, `p07 copy "x"`);
    await expect(page.getByTestId('result-table_rename')).toHaveAttribute(
      'data-outcome',
      'completed',
    );
    expect(await tableExists(request, driver, `p07 copy "x"`)).toBe(false);
    expect(await count(request, driver, "p07 renamed 'y'")).toBe(3);

    // 4. Truncate the renamed table, then drop it; neighbours stay.
    await refreshObjects(page);
    await openOps(page, driver, "p07 renamed 'y'");
    const truncate = card(page, 'table_truncate');
    await truncate.getByRole('button', { name: 'Plan anzeigen' }).click();
    await truncate.getByRole('button', { name: 'Ausführen' }).click();
    await typeAndConfirm(page, "p07 renamed 'y'");
    await expect(page.getByTestId('result-table_truncate')).toHaveAttribute(
      'data-outcome',
      'completed',
    );
    expect(await count(request, driver, "p07 renamed 'y'")).toBe(0);
    const again = card(page, 'table_drop');
    await again.getByRole('button', { name: 'Plan anzeigen' }).click();
    await again.getByRole('button', { name: 'Ausführen' }).click();
    await typeAndConfirm(page, "p07 renamed 'y'");
    await expect(page.getByTestId('result-table_drop')).toHaveAttribute(
      'data-outcome',
      'completed',
    );
    expect(await tableExists(request, driver, "p07 renamed 'y'")).toBe(false);
    expect(await tableExists(request, driver, 'keep_me')).toBe(true);
    expect(await count(request, driver, odd)).toBe(3);
    expect(await query(request, driver, 'SELECT v FROM keep_me')).toEqual([['unchanged']]);
    expect(executes).toHaveLength(5);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect([...origins].filter((origin) => origin !== new URL(config.baseURL).origin)).toEqual([]);
  });
}

test('sqlite: database actions are unsupported and explained', async ({ page }) => {
  await connect(page, 'sqlite');
  await page
    .getByRole('navigation', { name: 'Arbeitsbereich' })
    .getByRole('button', { name: 'Datenbankaktionen' })
    .click();
  await expect(
    page
      .getByTestId('database-ops')
      .getByText(/verwaltete Kennungen/)
      .first(),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Plan anzeigen' })).toHaveCount(0);
});

test('postgresql: create and drop another database; the connection database cannot be dropped', async ({
  page,
  request,
}) => {
  const name = `p07 odd"db`;
  const exists = async () =>
    (await query(request, 'postgresql', `SELECT 1 FROM pg_database WHERE datname=${literal(name)}`))
      .length === 1;
  await connect(page, 'postgresql');
  await page
    .getByRole('navigation', { name: 'Arbeitsbereich' })
    .getByRole('button', { name: 'Datenbankaktionen' })
    .click();
  const create = card(page, 'database_create');
  await create.getByLabel('Datenbankname').fill(name);
  await create.getByRole('button', { name: 'Plan anzeigen' }).click();
  await expect(create.getByTestId('plan-database_create')).toContainText('CREATE DATABASE');
  expect(await exists()).toBe(false);
  await create.getByRole('checkbox', { name: /Ich bestätige/ }).check();
  await create.getByRole('button', { name: 'Ausführen' }).click();
  await expect(page.getByTestId('result-database_create')).toHaveAttribute(
    'data-outcome',
    'completed',
  );
  expect(await exists()).toBe(true);
  const drop = card(page, 'database_drop');
  await drop.getByLabel('Datenbankname').fill(name);
  await drop.getByRole('button', { name: 'Plan anzeigen' }).click();
  await drop.getByRole('button', { name: 'Ausführen' }).click();
  await typeAndConfirm(page, name);
  await expect(page.getByTestId('result-database_drop')).toHaveAttribute(
    'data-outcome',
    'completed',
  );
  expect(await exists()).toBe(false);
  // The connection database is refused by the server (plan stage, nothing dropped).
  await drop.getByRole('button', { name: 'Neuen Plan vorbereiten' }).click();
  await drop.getByLabel('Datenbankname').fill('f3_probe');
  await drop.getByRole('button', { name: 'Plan anzeigen' }).click();
  await expect(drop.getByTestId('op-error')).toBeVisible();
  expect(
    (await query(request, 'postgresql', "SELECT 1 FROM pg_database WHERE datname='f3_probe'"))
      .length,
  ).toBe(1);
});
