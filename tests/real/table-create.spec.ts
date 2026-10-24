// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync(process.env.DBM_REAL_CONFIG!, 'utf8'));

type Driver = 'sqlite' | 'postgresql';
const connectionFor = (driver: Driver) =>
  driver === 'sqlite'
    ? { driver: 'sqlite', database: 'create_fixture' }
    : {
        driver: 'postgres',
        host: 'localhost',
        port: config.postgresPort,
        username: 'postgres',
        password: config.password,
        database: 'f3_probe',
        tls_mode: 'verify-full',
      };
// Independent read-back through the generic SQL route, not through the create API.
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

async function connect(page: Page, driver: Driver) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Backend-Zugang' }).click();
  await page.getByLabel('Zugriffstoken').fill(config.token);
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  if (driver === 'postgresql') await page.getByRole('button', { name: 'PostgreSQL' }).click();
  await page
    .getByLabel('Datenbank', { exact: true })
    .fill(driver === 'sqlite' ? 'create_fixture' : 'f3_probe');
  if (driver === 'postgresql') {
    await page.getByLabel('Host', { exact: true }).fill('localhost');
    await page.getByLabel('Port', { exact: true }).fill(String(config.postgresPort));
    await page.getByLabel('Benutzername').fill('postgres');
    await page.getByLabel('Passwort', { exact: true }).fill(config.password);
  }
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Arbeitsbereich' })
    .getByRole('button', { name: 'Tabelle anlegen' })
    .click();
  await expect(page.getByRole('heading', { name: 'Neue Tabelle anlegen' })).toBeVisible();
}
const panel = (page: Page) => page.getByTestId('create-table');
const submitButton = (page: Page) => panel(page).getByRole('button', { name: 'Tabelle anlegen' });
async function reviewAndConfirm(page: Page) {
  await panel(page).getByRole('button', { name: 'Definition prüfen' }).click();
  await expect(page.getByTestId('create-review')).toBeVisible();
  await page.getByRole('checkbox', { name: /Ich bestätige/ }).check();
}

for (const driver of ['sqlite', 'postgresql'] as const) {
  test(`${driver}: real confirmed table creation, special names, conflict and read-back`, async ({
    page,
    request,
  }) => {
    const creates: Record<string, unknown>[] = [];
    const origins = new Set<string>();
    page.on('request', (item) => {
      origins.add(new URL(item.url()).origin);
      if (item.url().endsWith('/api/v6/tables/create')) creates.push(item.postDataJSON());
    });
    await page.addInitScript(() => {
      window.cspViolations = [];
      document.addEventListener('securitypolicyviolation', (event) =>
        window.cspViolations.push(event.violatedDirective),
      );
    });
    // Fixture objects that must survive everything below.
    await query(request, driver, 'CREATE TABLE keep_me (id INTEGER PRIMARY KEY, v TEXT)');
    await query(request, driver, "INSERT INTO keep_me VALUES (1, 'unchanged')");
    await query(request, driver, 'CREATE TABLE create_exists (id INTEGER PRIMARY KEY, v TEXT)');
    await query(request, driver, "INSERT INTO create_exists VALUES (7, 'original')");

    await connect(page, driver);
    const name = `odd"name 'x'; DROP TABLE keep_me;--`;
    await page.getByLabel('Tabellenname').fill(name);
    await page.getByLabel('Spaltenname 1').fill('i"d');
    await page.getByLabel('Spalte 1 gehört zum Primärschlüssel').check();
    for (let i = 0; i < 4; i++)
      await page.getByRole('button', { name: 'Spalte hinzufügen' }).click();
    await page.getByLabel('Spaltenname 2').fill('co de');
    await page.getByLabel('Länge von Spalte 2').fill('20');
    await page.getByLabel('Spalte 2 gehört zum Primärschlüssel').check();
    await page.getByLabel('Spaltenname 3').fill('amount');
    await page.getByLabel('Typ von Spalte 3').selectOption('decimal');
    await page.getByLabel('Stellen von Spalte 3').fill('10');
    await page.getByLabel('Nachkommastellen von Spalte 3').fill('2');
    await page.getByLabel('Standardwert von Spalte 3').selectOption('value');
    await page.getByLabel('Konstante von Spalte 3').fill('-12.50');
    await page.getByLabel('Spaltenname 4').fill('payload');
    await page.getByLabel('Typ von Spalte 4').selectOption('binary');
    await page.getByLabel('Standardwert von Spalte 4').selectOption('null');
    await page.getByLabel('Spaltenname 5').fill('note');
    await page.getByLabel('Länge von Spalte 5').fill('50');
    await page.getByLabel('Standardwert von Spalte 5').selectOption('value');
    await page.getByLabel('Konstante von Spalte 5').fill("it's \\ ok");
    // Primary key order: swap so that "co de" comes first.
    await page.getByRole('button', { name: 'Primärschlüsselspalte co de nach oben' }).click();
    await expect(page.getByTestId('key-order')).toContainText(/co de.*i"d/);

    // No request before review and explicit confirmation.
    expect(creates).toHaveLength(0);
    await panel(page).getByRole('button', { name: 'Definition prüfen' }).click();
    await expect(page.getByTestId('create-review')).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();
    expect(creates).toHaveLength(0);
    await page.getByRole('checkbox', { name: /Ich bestätige/ }).check();
    await submitButton(page).dblclick();
    await expect(page.getByTestId('create-result')).toBeVisible();
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({ confirm: true, primary_key: ['co de', 'i"d'] });
    await expect(page.getByTestId('structure-check')).toHaveText('transactional');
    await expect(page.getByTestId('actual-structure')).toContainText('amount');

    // Independent read-back from the catalog.
    if (driver === 'sqlite') {
      const columns = await query(
        request,
        driver,
        `SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(${literal(name)}) ORDER BY cid`,
      );
      expect(columns.map((c) => c[0])).toEqual(['i"d', 'co de', 'amount', 'payload', 'note']);
      expect(columns.map((c) => c[1])).toEqual([
        'BIGINT',
        'VARCHAR(20)',
        'DECIMAL(10,2)',
        'BLOB',
        'VARCHAR(50)',
      ]);
      expect(columns.map((c) => c[4])).toEqual(['2', '1', '0', '0', '0']);
    } else {
      const columns = await query(
        request,
        driver,
        `SELECT column_name, data_type, character_maximum_length, numeric_precision, numeric_scale, is_nullable FROM information_schema.columns WHERE table_name = ${literal(name)} ORDER BY ordinal_position`,
      );
      expect(columns.map((c) => c[0])).toEqual(['i"d', 'co de', 'amount', 'payload', 'note']);
      expect(columns.map((c) => c[1])).toEqual([
        'bigint',
        'character varying',
        'numeric',
        'bytea',
        'character varying',
      ]);
      expect(columns[2].slice(3, 5)).toEqual(['10', '2']);
      expect(columns.map((c) => c[5])).toEqual(['NO', 'NO', 'YES', 'YES', 'YES']);
      const key = await query(
        request,
        driver,
        `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = ${literal('public.' + quoted(name))}::regclass AND i.indisprimary ORDER BY array_position(i.indkey::int2[], a.attnum)`,
      );
      expect(key.map((row) => row[0])).toEqual(['co de', 'i"d']);
    }
    // The defaults are real constants, not evaluated text.
    const qn = quoted(name);
    await query(request, driver, `INSERT INTO ${qn} ("i""d", "co de") VALUES (1, 'a')`);
    const row = await query(request, driver, `SELECT amount, note FROM ${qn}`);
    expect(Number(row[0][0])).toBe(-12.5);
    expect(row[0][1]).toBe("it's \\ ok");
    // Unrelated fixture objects are untouched, and the new table is listed in the object list.
    expect(await query(request, driver, 'SELECT v FROM keep_me')).toEqual([['unchanged']]);
    await expect(page.getByRole('button', { name: new RegExp('odd"name') })).toBeVisible();

    // Name conflict: 409, nothing reported as created, existing table and data unchanged.
    await page.getByRole('button', { name: 'Weitere Tabelle anlegen' }).click();
    await page.getByLabel('Tabellenname').fill('create_exists');
    await reviewAndConfirm(page);
    await submitButton(page).click();
    await expect(page.getByTestId('create-error')).toContainText('nicht verändert');
    await expect(page.getByTestId('create-result')).toHaveCount(0);
    expect(creates).toHaveLength(2);
    expect(await query(request, driver, 'SELECT id, v FROM create_exists')).toEqual([
      ['7', 'original'],
    ]);
    // Re-sending is a new explicit confirmation; the user changes the name and succeeds.
    await page.getByLabel('Tabellenname').fill('create_second');
    await reviewAndConfirm(page);
    await submitButton(page).click();
    await expect(page.getByTestId('create-result')).toBeVisible();
    expect(creates).toHaveLength(3);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect([...origins].filter((origin) => origin !== new URL(config.baseURL).origin)).toEqual([]);
  });
}
