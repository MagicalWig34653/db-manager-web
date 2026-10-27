// SPDX-License-Identifier: AGPL-3.0-only
// W-P16: CodeMirror SQL editor against a real backend (SQLite and PostgreSQL). Requires DBM_REAL_CONFIG.
// Bookmark variables are replaced in the browser only; the table is read back independently through v1.
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { editorText } from '../browser/editor';

const config = process.env.DBM_REAL_CONFIG
  ? JSON.parse(readFileSync(process.env.DBM_REAL_CONFIG, 'utf8'))
  : null;
test.skip(!config, 'DBM_REAL_CONFIG and isolated databases are required');
type Driver = 'sqlite' | 'postgresql';
const connectionFor = (driver: Driver) =>
  driver === 'sqlite'
    ? { driver: 'sqlite', database: config.sqliteDatabase ?? 'sqleditor_fixture' }
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
  expect(response.status(), `${sql} -> ${await response.text()}`).toBe(200);
  return (await response.json()).results as { rows: { value?: string }[][] }[];
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
  await expect(page.locator('.cm-editor')).toBeVisible();
}
// Ctrl/Cmd+Enter is ignored while the connection is still being established, so wait for the enabled button.
async function runQuery(page: Page) {
  await expect(page.getByRole('button', { name: 'Abfrage ausführen' })).toBeEnabled();
  await box(page).press('ControlOrMeta+Enter');
}
const box = (page: Page) => page.getByRole('textbox', { name: 'SQL-Abfrage', exact: true });

for (const driver of ['sqlite', 'postgresql'] as const) {
  test(`${driver}: dialect highlighting, formatting, completion and text-only variables`, async ({
    page,
    request,
  }) => {
    await query(request, driver, 'DROP TABLE IF EXISTS "wp16_probe"');
    await query(request, driver, 'CREATE TABLE "wp16_probe" (id INTEGER PRIMARY KEY, note TEXT)');
    try {
      await query(request, driver, "INSERT INTO wp16_probe VALUES (1, 'alpha')");
      await open(page, driver);

      // Syntax colors differ between keywords, strings and numbers.
      await box(page).fill("select id, note, 42 from wp16_probe where note = 'alpha' -- c");
      const colors = await page
        .locator('.cm-line span')
        .evaluateAll((spans) => spans.map((span) => getComputedStyle(span).color));
      expect(new Set(colors).size).toBeGreaterThan(3);

      // Formatting changes whitespace only: the formatted statement returns the same row.
      await page.getByRole('button', { name: 'Formatieren', exact: true }).click();
      await expect.poll(() => editorText(box(page))).toContain('\nfrom wp16_probe\nwhere note = ');
      await runQuery(page);
      await expect(page.getByText('alpha', { exact: true })).toBeVisible();

      // Table names from the catalog are offered without any extra request.
      await box(page).fill('select * from wp16_pr');
      await expect(
        page.getByRole('listbox').getByRole('option', { name: /wp16_probe/ }),
      ).toBeVisible();
      await page.keyboard.press('Escape');

      // Variables: the hostile text value is a quoted literal, never SQL; the table survives.
      const hostile = "x'); DROP TABLE wp16_probe; --";
      await box(page).fill('insert into wp16_probe (id, note) values (:id, :note)');
      await runQuery(page);
      const dialog = page.getByRole('dialog', { name: 'Variablen ausfüllen' });
      await dialog.getByLabel('Art des Werts für :id').selectOption('number');
      await dialog.getByLabel('Wert für :id').fill('2');
      await dialog.getByLabel('Wert für :note').fill(hostile);
      await expect(dialog.locator('pre')).toContainText("'x''); DROP TABLE wp16_probe; --'");
      await dialog.getByRole('button', { name: 'Ausführen', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect
        .poll(
          async () =>
            (await query(request, driver, 'SELECT note FROM wp16_probe WHERE id = 2'))[0]
              .rows[0]?.[0]?.value,
        )
        .toBe(hostile);
      expect(
        (await query(request, driver, 'SELECT count(*) FROM wp16_probe'))[0].rows[0][0].value,
      ).toBe('2');
      // The editor still holds the template, not the values.
      expect(await editorText(box(page))).toBe(
        'insert into wp16_probe (id, note) values (:id, :note)',
      );
    } finally {
      await query(request, driver, 'DROP TABLE IF EXISTS "wp16_probe"');
    }
  });
}

test('postgresql: casts and dollar quotes are not placeholders, backslashes stay literal', async ({
  page,
  request,
}) => {
  await open(page, 'postgresql');
  await box(page).fill("select 'a'::text as c, $q$:not_a_param$q$ as d, :v::text as e");
  await runQuery(page);
  const dialog = page.getByRole('dialog', { name: 'Variablen ausfüllen' });
  await expect(dialog.getByLabel('Wert für :v')).toBeVisible();
  await expect(dialog.getByLabel(/Wert für :not_a_param/)).toHaveCount(0);
  await dialog.getByLabel('Wert für :v').fill('a\\b');
  await dialog.getByRole('button', { name: 'Ausführen', exact: true }).click();
  await expect(page.getByText('a\\b', { exact: true })).toBeVisible();
  await expect(page.getByText(':not_a_param', { exact: true })).toBeVisible();
  void request;
});

// Formatting must not change what a statement does: unformatted and formatted statements give equal results.
import { formatSql } from '../../src/lib/features/sql-editor/format';
for (const driver of ['sqlite', 'postgresql'] as const) {
  test(`${driver}: formatted statements return the same results as the originals`, async ({
    request,
  }) => {
    const corpus =
      driver === 'sqlite'
        ? [
            'select - -1, + +2, 3 - -4, 5- - 6',
            "select '{\"a\":1}'->>'$.a', 'x   y' || '  z', x'41', 7 -- k\n+ 1",
            'select 10 -(-5), 1 /* c */ + 2, 3<=4, 5<>6',
          ]
        : [
            'select - -1, + +2, 3 - -4, 5- - 6',
            "select '{\"a\":[1]}'::jsonb @> '{\"a\":[1]}', '{\"a\":1}'::jsonb #>> '{a}', array[1,2] <@ array[1,2,3]",
            "select E'a\\'  b', U&'d\\0061t  a', B'101'::text, X'4a'::text, $t1$ a   b $t1$, 'm\n  n   \nx'",
            'select 5 -(-3), 1 /* /* n */ */ + 2, 2 || 3, 7 # 2, 6 & 3, ~5',
          ];
    for (const sql of corpus) {
      const out = formatSql(sql, driver);
      expect(out, sql).not.toBeNull();
      const original = await query(request, driver, sql);
      const formatted = await query(request, driver, out!);
      expect(JSON.stringify(formatted[0].rows), sql).toBe(JSON.stringify(original[0].rows));
    }
  });
}
