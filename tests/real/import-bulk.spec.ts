// SPDX-License-Identifier: AGPL-3.0-only
// W-P12 import and W-P13 multi row actions against a real Go backend (SQLite and PostgreSQL, TLS verify-full).
// Run through scripts/test-real-import.py, which builds the fixtures. Every assertion on data is an independent
// read-back through /api/v1/query, never through the UI under test.
import { test, expect, type Page } from '@playwright/test';

import { readFileSync } from 'node:fs';

const config = process.env.DBM_REAL_CONFIG
  ? JSON.parse(readFileSync(process.env.DBM_REAL_CONFIG, 'utf8'))
  : null;
function connection(driver: string) {
  return driver === 'sqlite'
    ? { driver, database: 'w12_fixture' }
    : {
        driver: 'postgres',
        database: 'w12_probe',
        host: 'localhost',
        port: config.postgresPort,
        username: 'postgres',
        password: config.password,
        tls_mode: 'verify-full',
      };
}
async function sql(page: Page, driver: string, statement: string) {
  const response = await page.request.post(config.backendURL + '/api/v1/query', {
    headers: { Authorization: 'Bearer ' + config.token },
    data: { connection: connection(driver), sql: statement },
  });
  expect(response.status(), await response.text()).toBe(200);
  const body = await response.json();
  return (body.results[0]?.rows ?? []) as { kind: string; value?: string }[][];
}
const cell = (rows: { kind: string; value?: string }[][], r = 0, c = 0) =>
  rows[r][c].kind === 'null' ? null : rows[r][c].value;
async function connect(page: Page, driver: string) {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Backend-Zugang' }).click();
  await page.getByLabel('Zugriffstoken').fill(config.token);
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  if (driver === 'postgresql') await page.getByRole('button', { name: 'PostgreSQL' }).click();
  await page
    .getByLabel('Datenbank', { exact: true })
    .fill(driver === 'sqlite' ? 'w12_fixture' : 'w12_probe');
  if (driver === 'postgresql') {
    await page.getByLabel('Host', { exact: true }).fill('localhost');
    await page.getByLabel('Port', { exact: true }).fill(String(config.postgresPort));
    await page.getByLabel('Benutzername').fill('postgres');
    await page.getByLabel('Passwort', { exact: true }).fill(config.password);
  }
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
}
/** Fails with the visible dialog text so a rejected outcome names its reason instead of just a mismatch. */
async function outcome(page: Page, expected: string) {
  const result = page.getByTestId('bulk-result');
  await expect(result).toBeVisible();
  await expect
    .poll(async () => (await result.getAttribute('data-outcome')) ?? '', {
      message: await page.getByTestId('bulk-dialog').innerText(),
    })
    .toBe(expected);
}
const file = (name: string, content: string | Buffer) => ({
  name,
  mimeType: 'application/octet-stream',
  buffer: Buffer.isBuffer(content) ? content : Buffer.from(content),
});

for (const driver of ['sqlite', 'postgresql']) {
  const apiDriver = driver;
  test.describe(driver, () => {
    test.skip(!config, 'DBM_REAL_CONFIG is required (scripts/test-real-import.py).');
    test(`${driver}: real CSV import with preview, one-time plan, failing replay and read-back`, async ({
      page,
    }) => {
      await sql(page, apiDriver, 'DROP TABLE IF EXISTS w12_rows');
      await sql(
        page,
        apiDriver,
        'CREATE TABLE w12_rows (id INTEGER PRIMARY KEY, label TEXT NOT NULL, n INTEGER)',
      );
      await connect(page, driver);
      await page.getByRole('button', { name: /w12_rows$/ }).click();
      await page
        .getByRole('navigation', { name: 'Tabellenreiter' })
        .getByRole('button', { name: 'Import', exact: true })
        .click();
      await expect(page.getByTestId('import-file')).toBeEnabled();
      const csv = 'id,label,n\n1,alpha,10\n2,"be,ta\nzwei",NA\n3,gamma,30\n';
      await page.getByTestId('import-file').setInputFiles(file('rows.csv', csv));
      await page.getByTestId('csv-null').count();
      await page.getByLabel('Bestimmten Text als NULL lesen').check();
      await page.getByTestId('csv-null').fill('NA');
      await page.getByTestId('import-plan').click();
      await expect(page.getByTestId('import-plan-view')).toBeVisible();
      await expect(page.getByTestId('import-preview').locator('tbody tr')).toHaveCount(3);
      // The preview wrote nothing.
      expect(cell(await sql(page, apiDriver, 'SELECT count(*) FROM w12_rows'))).toBe('0');
      await page.getByTestId('import-csv-start').click();
      await page
        .getByRole('dialog')
        .getByRole('textbox')
        .fill(driver === 'sqlite' ? 'main.w12_rows' : 'public.w12_rows');
      await page
        .getByRole('button', { name: 'Jetzt einfügen' })
        .evaluate((b: HTMLButtonElement) => {
          b.click();
          b.click();
        });
      await expect(page.getByTestId('import-result')).toBeVisible({ timeout: 30000 });
      await expect(page.getByTestId('import-outcome')).toContainText('Abgeschlossen');
      expect(cell(await sql(page, apiDriver, 'SELECT count(*) FROM w12_rows'))).toBe('3');
      const rows = await sql(page, apiDriver, 'SELECT label, n FROM w12_rows ORDER BY id');
      expect(cell(rows, 1, 0)).toBe('be,ta\nzwei');
      expect(cell(rows, 1, 1)).toBeNull();
      await expect(page.getByTestId('import-plan-consumed')).toBeVisible();
      await expect(page.getByTestId('import-csv-start')).toHaveCount(0);
      // A new preview of the same file is possible but fails on the key at execution time: nothing changes.
      await page.getByTestId('import-plan').click();
      await expect(page.getByTestId('import-csv-start')).toBeEnabled();
      await page.getByTestId('import-csv-start').click();
      await page
        .getByRole('dialog')
        .getByRole('textbox')
        .fill(driver === 'sqlite' ? 'main.w12_rows' : 'public.w12_rows');
      await page.getByRole('button', { name: 'Jetzt einfügen' }).click();
      await expect(page.getByTestId('import-outcome')).toContainText('Abgewiesen', {
        timeout: 30000,
      });
      expect(cell(await sql(page, apiDriver, 'SELECT count(*) FROM w12_rows'))).toBe('3');
    });

    test(`${driver}: real SQL import runs the file statement by statement`, async ({ page }) => {
      await sql(page, apiDriver, 'DROP TABLE IF EXISTS w12_sql');
      await sql(page, apiDriver, 'CREATE TABLE w12_sql (id INTEGER PRIMARY KEY, v TEXT)');
      await connect(page, driver);
      await page
        .getByRole('navigation', { name: 'Arbeitsbereich' })
        .getByRole('button', { name: 'Import', exact: true })
        .click();
      await expect(page.getByTestId('import-sql-warning')).toContainText(
        'führt beliebiges SQL ohne Plan aus',
      );
      const script =
        "INSERT INTO w12_sql VALUES (1, 'Grüße; <b>x</b>');\nINSERT INTO w12_sql VALUES (2, 'zwei');\nINSERT INTO w12_sql VALUES (2, 'doppelt');\nINSERT INTO w12_sql VALUES (3, 'drei');\n";
      await page.getByTestId('import-file').setInputFiles(file('dump.sql', script));
      await page.getByTestId('import-sql-start').click();
      await page.getByRole('dialog').getByRole('textbox').fill('dump.sql');
      await page.getByRole('button', { name: 'SQL jetzt ausführen' }).click();
      await expect(page.getByTestId('import-result')).toBeVisible({ timeout: 30000 });
      // The failing third statement leaves the fourth untouched (stop mode) and the outcome is reported honestly.
      await expect(page.getByTestId('import-statement')).toHaveCount(4);
      await expect(page.locator('[data-testid="import-statement"]').nth(2)).toHaveAttribute(
        'data-outcome',
        /outcome_unknown|rolled_back/,
      );
      await expect(page.locator('[data-testid="import-statement"]').nth(3)).toHaveAttribute(
        'data-outcome',
        'not_executed',
      );
      await expect(page.getByTestId('import-sql-start')).toBeDisabled();
      expect(cell(await sql(page, apiDriver, 'SELECT count(*) FROM w12_sql WHERE id = 3'))).toBe(
        '0',
      );
    });

    test(`${driver}: real multi row update, copy, delete, file value and foreign key lookup`, async ({
      page,
    }) => {
      const identity =
        driver === 'sqlite'
          ? 'id INTEGER PRIMARY KEY'
          : 'id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY';
      const blob = driver === 'sqlite' ? 'BLOB' : 'BYTEA';
      for (const statement of [
        'DROP TABLE IF EXISTS w13_items',
        'DROP TABLE IF EXISTS w13_owners',
        'CREATE TABLE w13_owners (id INTEGER PRIMARY KEY, label TEXT NOT NULL)',
        `CREATE TABLE w13_items (${identity}, name TEXT, owner_id INTEGER REFERENCES w13_owners(id), raw ${blob})`,
        "INSERT INTO w13_owners VALUES (1, 'Erste'), (2, 'Zweite')",
        "INSERT INTO w13_items (id, name, owner_id) VALUES (1, 'a', 1), (2, 'b', 1), (3, 'c', 2), (4, 'd', NULL)",
        // Explicit ids leave a PostgreSQL identity sequence behind; a copy with an automatic key needs it ahead.
        ...(driver === 'sqlite'
          ? []
          : ["SELECT setval(pg_get_serial_sequence('w13_items', 'id'), 4)"]),
      ])
        await sql(page, apiDriver, statement);
      await connect(page, driver);
      await page.getByRole('button', { name: /w13_items$/ }).click();
      await expect(page.getByRole('checkbox', { name: 'Zeile 1 auswählen' })).toBeVisible();
      // Multi row update.
      await page.getByRole('checkbox', { name: 'Zeile 1 auswählen' }).check();
      await page.getByRole('checkbox', { name: 'Zeile 2 auswählen' }).check();
      await page.getByTestId('bulk-update').click();
      await page.getByLabel('Angabe für name', { exact: true }).selectOption('value');
      await page.getByLabel('Wert für name', { exact: true }).fill('neu');
      await page.getByRole('button', { name: 'Vorschau erstellen' }).click();
      await expect(page.getByTestId('bulk-plan-view')).toBeVisible();
      expect(
        cell(await sql(page, apiDriver, "SELECT count(*) FROM w13_items WHERE name = 'neu'")),
      ).toBe('0');
      await page.getByRole('checkbox', { name: /Ich bestätige/ }).check();
      await page.getByTestId('bulk-execute').dblclick();
      await outcome(page, 'completed');
      expect(
        cell(await sql(page, apiDriver, "SELECT count(*) FROM w13_items WHERE name = 'neu'")),
      ).toBe('2');
      await page.getByTestId('bulk-close').click();
      // Plan conflict: a concurrent change after the selection rejects everything and nothing changes.
      await page.getByRole('checkbox', { name: 'Zeile 3 auswählen' }).check();
      await page.getByRole('checkbox', { name: 'Zeile 4 auswählen' }).check();
      await page.getByTestId('bulk-delete').click();
      await expect(page.getByTestId('bulk-plan-view')).toBeVisible();
      await sql(page, apiDriver, "UPDATE w13_items SET name = 'heimlich' WHERE id = 4");
      await page.getByRole('checkbox', { name: /Ich bestätige/ }).check();
      await page.getByTestId('bulk-typed').fill('2');
      await page.getByTestId('bulk-execute').click();
      await outcome(page, 'rejected');
      expect(cell(await sql(page, apiDriver, 'SELECT count(*) FROM w13_items'))).toBe('4');
      await page.getByTestId('bulk-close').click();
      // Copy with an automatic key (SQLite rowid alias / PostgreSQL identity).
      await page.getByRole('checkbox', { name: 'Zeile 1 auswählen' }).check();
      await expect(
        page.getByTestId('bulk-bar'),
        await page.getByRole('main').innerText(),
      ).toBeVisible();
      await page.getByTestId('bulk-copy').click();
      await expect(page.getByTestId('bulk-plan-view')).toBeVisible();
      await page.getByRole('checkbox', { name: /Ich bestätige/ }).check();
      await page.getByTestId('bulk-execute').click();
      await outcome(page, 'completed');
      expect(cell(await sql(page, apiDriver, 'SELECT count(*) FROM w13_items'))).toBe('5');
      await page.getByTestId('bulk-close').click();
      // Delete.
      await page.getByRole('checkbox', { name: 'Zeile 4 auswählen' }).check();
      await page.getByTestId('bulk-delete').click();
      await expect(page.getByTestId('bulk-plan-view')).toBeVisible();
      await page.getByRole('checkbox', { name: /Ich bestätige/ }).check();
      await page.getByTestId('bulk-typed').fill('1');
      await page.getByTestId('bulk-execute').click();
      await outcome(page, 'completed');
      expect(cell(await sql(page, apiDriver, 'SELECT count(*) FROM w13_items WHERE id = 4'))).toBe(
        '0',
      );
      await page.getByTestId('bulk-close').click();
      // File value: upload bytes, download them again, compare with an independent read-back.
      await page.getByRole('button', { name: 'Bearbeiten' }).first().click();
      const payload = Buffer.from([0, 1, 2, 255, 128, 10, 13]);
      await page.getByTestId('file-input').setInputFiles(file('x.bin', payload));
      await page.getByTestId('file-value-panel').getByRole('checkbox').check();
      await page.getByTestId('file-upload').click();
      await expect(page.getByTestId('file-message')).toContainText('bestätigt');
      const hex = driver === 'sqlite' ? 'hex(raw)' : "encode(raw, 'hex')";
      expect(
        String(
          cell(await sql(page, apiDriver, `SELECT ${hex} FROM w13_items WHERE id = 1`)),
        ).toLowerCase(),
      ).toBe(payload.toString('hex'));
      // The uploaded row is stale on screen: discard, reload and open the fresh row.
      await page.getByRole('button', { name: 'Verwerfen' }).click();
      await expect(
        page.getByRole('button', { name: 'Zeile hinzufügen', exact: true }),
      ).toBeEnabled();
      await page.getByRole('button', { name: 'Bearbeiten' }).first().click();
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('file-download').click(),
      ]);
      const bytes = Buffer.concat(
        (await (await download.createReadStream()).toArray()) as Buffer[],
      );
      expect(bytes.equals(payload)).toBe(true);
      // Foreign key lookup fills the field with the chosen key.
      await page.getByLabel('Angabe für owner_id', { exact: true }).selectOption('value');
      await page.getByTestId('fk-open-owner_id').click();
      await expect(page.getByTestId('fk-choice').first()).toBeVisible();
      await page.getByTestId('fk-choice').filter({ hasText: 'Zweite' }).click();
      await expect(page.getByLabel('Wert für owner_id', { exact: true })).toHaveValue('2');
    });
  });
}
