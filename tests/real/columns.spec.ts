// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync(process.env.DBM_REAL_CONFIG!, 'utf8'));

type Driver = 'sqlite' | 'postgresql';
const connectionFor = (driver: Driver) =>
  driver === 'sqlite'
    ? { driver: 'sqlite', database: 'columns_fixture' }
    : {
        driver: 'postgres',
        host: 'localhost',
        port: config.postgresPort,
        username: 'postgres',
        password: config.password,
        database: 'f3_probe',
        tls_mode: 'verify-full',
      };
// Independent read-back through the generic SQL route, not through the columns API.
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
    .fill(driver === 'sqlite' ? 'columns_fixture' : 'f3_probe');
  if (driver === 'postgresql') {
    await page.getByLabel('Host', { exact: true }).fill('localhost');
    await page.getByLabel('Port', { exact: true }).fill(String(config.postgresPort));
    await page.getByLabel('Benutzername').fill('postgres');
    await page.getByLabel('Passwort', { exact: true }).fill(config.password);
  }
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
}
const table = 'we"ird tbl';
async function openColumns(page: Page) {
  await page.getByRole('button', { name: new RegExp('we"ird tbl') }).click();
  await page
    .getByRole('navigation', { name: 'Tabellenreiter' })
    .getByRole('button', { name: 'Spalten' })
    .click();
  await expect(page.getByTestId('column-list')).toBeVisible();
}
async function addToList(page: Page) {
  await page.getByRole('button', { name: 'Zur Änderungsliste hinzufügen' }).click();
}
async function planAndExecute(page: Page) {
  await page.getByRole('button', { name: 'Plan anzeigen' }).click();
  await expect(page.getByTestId('columns-plan')).toBeVisible();
}
async function confirmPlain(page: Page) {
  await page.getByRole('checkbox', { name: /geprüft/ }).check();
  await page.getByRole('button', { name: 'Ausführen', exact: true }).dblclick();
  await expect(page.getByTestId('columns-result')).toContainText('ausgeführt');
}
async function confirmTyped(page: Page, typed: string) {
  await page.getByRole('button', { name: 'Zerstörend ausführen …' }).click();
  const dialog = page.getByTestId('confirm-destructive');
  await dialog.getByRole('textbox').fill(typed);
  await dialog.getByRole('button', { name: 'Zerstörend ausführen …' }).click();
}
const columnNames = (page: Page) =>
  page
    .locator('[data-testid="column-list"] tbody tr')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-column')));

for (const driver of ['sqlite', 'postgresql'] as const) {
  test(`${driver}: real plan, confirmation, execution and read-back of column changes`, async ({
    page,
    request,
  }) => {
    const alters: Record<string, unknown>[] = [];
    const origins = new Set<string>();
    page.on('request', (item) => {
      origins.add(new URL(item.url()).origin);
      if (item.url().endsWith('/api/v9/columns/alter')) alters.push(item.postDataJSON());
    });
    await page.addInitScript(() => {
      window.cspViolations = [];
      document.addEventListener('securitypolicyviolation', (event) =>
        window.cspViolations.push(event.violatedDirective),
      );
    });
    const qt = quoted(table);
    await query(request, driver, 'CREATE TABLE keep_me (id INTEGER PRIMARY KEY, v TEXT)');
    await query(request, driver, "INSERT INTO keep_me VALUES (1, 'unchanged')");
    await query(
      request,
      driver,
      `CREATE TABLE ${qt} (id BIGINT PRIMARY KEY, "old col" VARCHAR(30), amount DECIMAL(10,2), extra VARCHAR(10))`,
    );
    await query(request, driver, `INSERT INTO ${qt} VALUES (1, 'alpha', 1.50, 'x')`);

    await connect(page, driver);
    await openColumns(page);
    expect(await columnNames(page)).toEqual(['id', 'old col', 'amount', 'extra']);

    // Capability reasons are visible and unsupported actions are disabled (SQLite).
    if (driver === 'sqlite') {
      await expect(page.getByTestId('support-list')).toContainText('nicht unterstützt');
      await expect(page.getByRole('button', { name: 'Spalte amount ändern' })).toBeDisabled();
    }

    // 1. Batch: add a column with a special name and a constant default, rename another.
    await page.getByRole('button', { name: 'Spalte hinzufügen' }).click();
    await page.getByLabel('Name', { exact: true }).fill(`n"ew; DROP TABLE keep_me;--`);
    await page.getByLabel('Typ', { exact: true }).selectOption('text');
    await page.getByLabel('Länge', { exact: true }).fill('40');
    await page.getByLabel('Standardwert', { exact: true }).selectOption('value');
    await page.getByRole('textbox', { name: 'fester Wert' }).fill("it's \\ ok");
    await addToList(page);
    await page.getByRole('button', { name: 'Spalte old col umbenennen' }).click();
    await page.getByLabel('Neuer Name').fill('renamed col');
    await addToList(page);
    expect(alters).toHaveLength(0);
    await planAndExecute(page);
    await expect(page.getByTestId('plan-affected')).toBeVisible();
    expect(alters).toHaveLength(0);
    await expect(page.getByRole('button', { name: 'Ausführen', exact: true })).toBeDisabled();
    await confirmPlain(page);
    expect(alters).toHaveLength(1);
    expect(alters[0]).toMatchObject({ confirm: { action: 'columns_alter' } });
    await page.getByRole('button', { name: 'Neue Änderung vorbereiten' }).click();
    await expect
      .poll(() => columnNames(page))
      .toEqual(['id', 'renamed col', 'amount', 'extra', 'n"ew; DROP TABLE keep_me;--']);
    if (driver === 'sqlite') {
      const info = await query(
        request,
        driver,
        `SELECT name FROM pragma_table_info(${literal(table)}) ORDER BY cid`,
      );
      expect(info.map((r) => r[0])).toEqual([
        'id',
        'renamed col',
        'amount',
        'extra',
        'n"ew; DROP TABLE keep_me;--',
      ]);
    } else {
      const info = await query(
        request,
        driver,
        `SELECT column_name FROM information_schema.columns WHERE table_name = ${literal(table)} ORDER BY ordinal_position`,
      );
      expect(info.map((r) => r[0])).toEqual([
        'id',
        'renamed col',
        'amount',
        'extra',
        'n"ew; DROP TABLE keep_me;--',
      ]);
    }
    // The default is a real constant, existing data is intact, the neighbour is untouched.
    await query(request, driver, `INSERT INTO ${qt} (id) VALUES (2)`);
    expect(
      await query(request, driver, `SELECT "n""ew; DROP TABLE keep_me;--" FROM ${qt} WHERE id = 2`),
    ).toEqual([["it's \\ ok"]]);
    expect(await query(request, driver, `SELECT "renamed col" FROM ${qt} WHERE id = 1`)).toEqual([
      ['alpha'],
    ]);
    expect(await query(request, driver, 'SELECT v FROM keep_me')).toEqual([['unchanged']]);

    // 2. PostgreSQL only: widening a type is a destructive plan (typed table name, wrong name sends nothing).
    if (driver === 'postgresql') {
      await page.getByRole('button', { name: 'Spalte renamed col ändern' }).click();
      await expect(page.getByLabel('Typ', { exact: true })).toHaveValue('text');
      await page.getByLabel('Länge', { exact: true }).fill('60');
      await addToList(page);
      await planAndExecute(page);
      await expect(page.getByTestId('plan-destructive')).toBeVisible();
      await page.getByRole('button', { name: 'Zerstörend ausführen …' }).click();
      const dialog = page.getByTestId('confirm-destructive');
      await dialog.getByRole('textbox').fill('WE"IRD TBL');
      await expect(dialog.getByRole('button', { name: 'Zerstörend ausführen …' })).toBeDisabled();
      expect(alters).toHaveLength(1);
      await dialog.getByRole('textbox').fill(table);
      await dialog.getByRole('button', { name: 'Zerstörend ausführen …' }).click();
      await expect(page.getByTestId('columns-result')).toContainText('ausgeführt');
      expect(alters).toHaveLength(2);
      expect(alters[1]).toMatchObject({ confirm: { action: 'columns_alter', target_name: table } });
      const type = await query(
        request,
        driver,
        `SELECT character_maximum_length FROM information_schema.columns WHERE table_name = ${literal(table)} AND column_name = 'renamed col'`,
      );
      expect(type).toEqual([['60']]);
      expect(await query(request, driver, `SELECT "renamed col" FROM ${qt} WHERE id = 1`)).toEqual([
        ['alpha'],
      ]);
      await page.getByRole('button', { name: 'Neue Änderung vorbereiten' }).click();
    }

    // 3. Destructive drop with the typed catalog table name.
    const before = alters.length;
    await page.getByRole('button', { name: 'Spalte extra entfernen' }).click();
    await planAndExecute(page);
    await expect(page.getByTestId('plan-destructive')).toBeVisible();
    await confirmTyped(page, table);
    await expect(page.getByTestId('columns-result')).toContainText('ausgeführt');
    expect(alters).toHaveLength(before + 1);
    await page.getByRole('button', { name: 'Neue Änderung vorbereiten' }).click();
    await expect.poll(() => columnNames(page)).toEqual(expect.not.arrayContaining(['extra']));
    expect(await columnNames(page)).toContain('amount');
    expect(await query(request, driver, `SELECT amount FROM ${qt} WHERE id = 1`)).toEqual([
      [driver === 'sqlite' ? '1.5' : '1.50'],
    ]);
    expect(await query(request, driver, 'SELECT v FROM keep_me')).toEqual([['unchanged']]);

    // 4. A colliding new name is stopped before any plan request.
    await page.getByRole('button', { name: 'Spalte amount umbenennen' }).click();
    await page.getByLabel('Neuer Name').fill('id');
    await addToList(page);
    await expect(page.getByTestId('batch-issues')).toContainText('bereits vergeben');
    await expect(page.getByRole('button', { name: 'Plan anzeigen' })).toBeDisabled();
    expect(alters).toHaveLength(before + 1);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect([...origins].filter((origin) => origin !== new URL(config.baseURL).origin)).toEqual([]);
  });
}
