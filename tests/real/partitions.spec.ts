// SPDX-License-Identifier: AGPL-3.0-only
// Real run: partitions (PostgreSQL, real declarative partitions) and the table prefix batch (SQLite and
// PostgreSQL) through the UI against the Go backend; results are read back through the generic SQL route.
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync(process.env.DBM_REAL_CONFIG!, 'utf8'));

type Driver = 'sqlite' | 'postgresql';
const connectionFor = (driver: Driver) =>
  driver === 'sqlite'
    ? { driver: 'sqlite', database: 'w4_part' }
    : {
        driver: 'postgres',
        host: 'localhost',
        port: config.postgresPort,
        username: 'postgres',
        password: config.password,
        database: 'w4_probe',
        tls_mode: 'verify-full',
      };
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
const quoted = (value: string) => `"${value.replaceAll('"', '""')}"`;
const names = async (request: APIRequestContext, driver: Driver, like: string) =>
  (
    await query(
      request,
      driver,
      driver === 'sqlite'
        ? `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '${like}' ESCAPE '\\' ORDER BY name`
        : `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE '${like}' ESCAPE '\\' ORDER BY tablename`,
    )
  ).map((row) => row[0]);

async function connect(page: Page, driver: Driver) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Backend-Zugang' }).click();
  await page.getByLabel('Zugriffstoken').fill(config.token);
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  if (driver === 'postgresql') await page.getByRole('button', { name: 'PostgreSQL' }).click();
  await page
    .getByLabel('Datenbank', { exact: true })
    .fill(driver === 'sqlite' ? 'w4_part' : 'w4_probe');
  if (driver === 'postgresql') {
    await page.getByLabel('Host', { exact: true }).fill('localhost');
    await page.getByLabel('Port', { exact: true }).fill(String(config.postgresPort));
    await page.getByLabel('Benutzername').fill('postgres');
    await page.getByLabel('Passwort', { exact: true }).fill(config.password);
  }
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
}
async function typeAndConfirm(page: Page, name: string) {
  const dialog = page.getByTestId('confirm-destructive');
  await dialog.getByRole('textbox').fill(name);
  await dialog.getByRole('button', { name: 'Ausführen' }).dblclick();
}

for (const driver of ['sqlite', 'postgresql'] as const) {
  test(`${driver}: real prefix batch lists matches, rejects a blocked drop and drops after typing the prefix`, async ({
    page,
    request,
  }) => {
    const executes: string[] = [];
    page.on('request', (item) => {
      if (item.method() === 'POST' && /\/api\/v22\/tables\/prefix\/execute$/.test(item.url()))
        executes.push(item.url());
    });
    const odd = `px_odd"1`;
    await query(request, driver, 'CREATE TABLE keep_pfx (id INTEGER PRIMARY KEY)');
    await query(request, driver, 'CREATE TABLE px_a (id INTEGER PRIMARY KEY, v TEXT)');
    await query(request, driver, `CREATE TABLE ${quoted(odd)} (id INTEGER PRIMARY KEY)`);
    await query(request, driver, 'CREATE TABLE pxz_other (id INTEGER PRIMARY KEY)');
    await query(request, driver, "INSERT INTO px_a VALUES (1, 'row')");
    // PostgreSQL: a table outside the batch references px_a, so the drop is blocked and nothing may change.
    // SQLite does not enforce foreign keys by default, so there the first drop simply succeeds.
    const blocked = driver === 'postgresql';
    if (blocked)
      await query(
        request,
        driver,
        'CREATE TABLE outside_ref (id INTEGER PRIMARY KEY, a INTEGER REFERENCES px_a(id))',
      );

    await connect(page, driver);
    await page.goto(`/#/db/${driver === 'sqlite' ? 'w4_part' : 'w4_probe'}/praefix-stapel`);
    await expect(page.getByTestId('prefix-tab')).toBeVisible();
    await page.getByTestId('prefix-input').fill('px_');
    await page.getByRole('button', { name: 'Treffer anzeigen' }).click();
    // Literal prefix: "px_" also matches "pxz_other" in LIKE, but not in the batch.
    await expect(page.getByTestId('match-list')).toContainText('px_a');
    await expect(page.getByTestId('match-list')).toContainText(odd);
    await expect(page.getByTestId('match-list')).not.toContainText('pxz_other');

    const card = page.getByTestId('prefix-drop');
    await card.getByRole('button', { name: 'Plan anzeigen' }).click();
    await expect(page.getByTestId('plan')).toContainText('DROP TABLE');
    await card.getByRole('button', { name: 'Ausführen' }).click();
    await typeAndConfirm(page, 'px_');
    const result = page.getByTestId('result');
    if (blocked) {
      await expect(result).toHaveAttribute('data-outcome', 'rejected');
      await expect(page.getByTestId('table-results').locator('tbody tr').first()).toHaveAttribute(
        'data-status',
        'not_applied',
      );
      expect(executes).toHaveLength(1);
      expect(await names(request, driver, 'px\\_%')).toContain('px_a');
      expect(await names(request, driver, 'keep\\_pfx')).toEqual(['keep_pfx']);

      // Remove the blocker, plan again (a used plan is locked) and drop for real.
      await query(request, driver, 'DROP TABLE outside_ref');
      await card.getByRole('button', { name: 'Neuer Plan' }).click();
      await card.getByRole('button', { name: 'Plan anzeigen' }).click();
      await card.getByRole('button', { name: 'Ausführen' }).click();
      await typeAndConfirm(page, 'px_');
    }
    await expect(result).toHaveAttribute('data-outcome', 'completed');
    for (const row of await page.getByTestId('table-results').locator('tbody tr').all())
      await expect(row).toHaveAttribute('data-status', 'applied');
    expect(executes).toHaveLength(blocked ? 2 : 1);
    const left = await names(request, driver, 'px%');
    expect(left).toEqual(['pxz_other']);
    expect(await names(request, driver, 'keep\\_pfx')).toEqual(['keep_pfx']);
  });
}

test('sqlite: partitions are reported as not supported without touching anything', async ({
  page,
  request,
}) => {
  await connect(page, 'sqlite');
  await page.getByRole('button', { name: /keep_me/ }).click();
  await page
    .getByRole('navigation', { name: 'Tabellenreiter' })
    .getByRole('button', { name: 'Partitionen' })
    .click();
  await expect(page.getByTestId('partitions-unsupported')).toContainText('nicht unterstützt');
  expect(await names(request, 'sqlite', 'keep\\_me')).toEqual(['keep_me']);
});

test('postgresql: real partitions are listed, attached, detached, truncated and dropped through the UI', async ({
  page,
  request,
}) => {
  const executes: string[] = [];
  page.on('request', (item) => {
    if (item.method() === 'POST' && /\/api\/v22\/tables\/partitions\/execute$/.test(item.url()))
      executes.push(item.url());
  });
  const driver: Driver = 'postgresql';
  await query(
    request,
    driver,
    'CREATE TABLE w4_parent (id INTEGER NOT NULL, v TEXT) PARTITION BY RANGE (id)',
  );
  await query(
    request,
    driver,
    'CREATE TABLE w4_p0 PARTITION OF w4_parent FOR VALUES FROM (0) TO (10)',
  );
  await query(
    request,
    driver,
    'CREATE TABLE w4_p1 PARTITION OF w4_parent FOR VALUES FROM (10) TO (20)',
  );
  await query(request, driver, "INSERT INTO w4_parent VALUES (1,'a'),(11,'b')");
  await query(request, driver, 'CREATE TABLE w4_spare (id INTEGER NOT NULL, v TEXT)');

  await connect(page, driver);
  await page.getByRole('button', { name: 'public.w4_parent', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Tabellenreiter' })
    .getByRole('button', { name: 'Partitionen' })
    .click();
  await expect(page.getByTestId('list-method')).toContainText('RANGE');
  await expect(page.getByTestId('partition-list')).toContainText('w4_p0');
  await expect(page.getByTestId('partition-list')).toContainText('FOR VALUES FROM (0) TO (10)');

  // Unsupported actions on PostgreSQL are explained, not offered.
  await page.getByTestId('partition-action').selectOption('reorganize');
  await expect(page.getByTestId('action-unsupported')).toBeVisible();

  // Create a partition (CREATE TABLE ... PARTITION OF).
  await page.getByTestId('partition-action').selectOption('add');
  let card = page.getByTestId('partition-add');
  await card.getByLabel('Name der Partition 1').fill('w4_p2');
  await card.getByLabel('Von (inklusive, Wert oder MINVALUE)').fill('20');
  await card.getByLabel('Bis (exklusive, Wert oder MAXVALUE)').fill('30');
  await card.getByRole('button', { name: 'Plan anzeigen' }).click();
  await expect(page.getByTestId('plan')).toContainText('PARTITION OF');
  await card.getByRole('button', { name: 'Ausführen' }).click();
  await typeAndConfirm(page, 'w4_parent');
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'completed');
  expect(await names(request, driver, 'w4\\_p2')).toEqual(['w4_p2']);

  // Detach w4_p1: the table stays with its data.
  await page.getByTestId('partition-list').getByRole('button', { name: 'Aktualisieren' }).click();
  await page.getByTestId('partition-action').selectOption('detach');
  card = page.getByTestId('partition-detach');
  await card.getByRole('checkbox', { name: /public.w4_p1/ }).check();
  await card.getByRole('button', { name: 'Plan anzeigen' }).click();
  await card.getByRole('button', { name: 'Ausführen' }).click();
  await typeAndConfirm(page, 'w4_parent');
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'completed');
  expect(await query(request, driver, 'SELECT count(*) FROM w4_p1')).toEqual([['1']]);
  expect((await query(request, driver, 'SELECT count(*) FROM w4_parent'))[0][0]).toBe('1');

  // Truncate w4_p0 (destructive, typed name): the row is gone, the partition remains.
  await page.getByTestId('partition-list').getByRole('button', { name: 'Aktualisieren' }).click();
  await page.getByTestId('partition-action').selectOption('truncate');
  card = page.getByTestId('partition-truncate');
  await card.getByRole('checkbox', { name: /public.w4_p0/ }).check();
  await card.getByRole('button', { name: 'Plan anzeigen' }).click();
  await expect(page.getByTestId('plan')).toContainText('unwiderruflich');
  await card.getByRole('button', { name: 'Ausführen' }).click();
  const dialog = page.getByTestId('confirm-destructive');
  await dialog.getByRole('textbox').fill('W4_PARENT');
  await expect(dialog.getByRole('button', { name: 'Ausführen' })).toBeDisabled();
  expect(executes).toHaveLength(2);
  await typeAndConfirm(page, 'w4_parent');
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'completed');
  expect(executes).toHaveLength(3);
  expect(await query(request, driver, 'SELECT count(*) FROM w4_p0')).toEqual([['0']]);

  // Drop w4_p2 including its table.
  await page.getByTestId('partition-list').getByRole('button', { name: 'Aktualisieren' }).click();
  await page.getByTestId('partition-action').selectOption('drop');
  card = page.getByTestId('partition-drop');
  await card.getByRole('checkbox', { name: /public.w4_p2/ }).check();
  await card.getByRole('button', { name: 'Plan anzeigen' }).click();
  await card.getByRole('button', { name: 'Ausführen' }).click();
  await typeAndConfirm(page, 'w4_parent');
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'completed');
  expect(await names(request, driver, 'w4\\_p2')).toEqual([]);
  expect(await names(request, driver, 'keep\\_me')).toEqual(['keep_me']);
});
