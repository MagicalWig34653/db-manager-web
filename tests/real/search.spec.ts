// SPDX-License-Identifier: AGPL-3.0-only
// Run against a disposable fixture. DBM_REAL_SEARCH_CONFIG supplies backendURL, token and
// connection (API shape); the fixture holds table notes(id PK, body TEXT) with three rows.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const config = process.env.DBM_REAL_SEARCH_CONFIG
  ? JSON.parse(readFileSync(process.env.DBM_REAL_SEARCH_CONFIG, 'utf8'))
  : null;
test('real search and replace with independent read-back', async ({ page, request }) => {
  test.skip(!config, 'DBM_REAL_SEARCH_CONFIG and a disposable backend fixture are required.');
  const query = async (sql: string) => {
    const response = await request.post(`${config.backendURL}/api/v1/query`, {
      headers: { Authorization: `Bearer ${config.token}` },
      data: { connection: config.connection, sql },
    });
    expect(response.status(), await response.text()).toBe(200);
    return (await response.json()).results[0].rows as { value?: string }[][];
  };
  const bodies = async () =>
    (await query('SELECT body FROM notes ORDER BY id')).map((row) => row[0].value);
  expect(await bodies()).toEqual(['alpha foo', 'beta', 'foo foo']);
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/v14/replace')) requests.push(r.postData() ?? '');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Backend-Zugang' }).click();
  await page.getByLabel('Zugriffstoken').fill(config.token);
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill(config.connection.database);
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
  // Database-wide search (read only).
  await page
    .getByRole('navigation', { name: 'Arbeitsbereich' })
    .getByRole('button', { name: 'Suche', exact: true })
    .click();
  await page.getByRole('main').getByRole('button', { name: 'main.notes', exact: true }).click();
  await page.getByRole('checkbox', { name: 'body', exact: true }).setChecked(true);
  await page.getByLabel('Suchtext').fill('foo');
  await page.getByRole('button', { name: 'Suchen', exact: true }).click();
  const found = page.getByTestId('search-result');
  await expect(found).toContainText('notes');
  await expect(found).toContainText('2 Treffer (exakt)');
  expect(await bodies()).toEqual(['alpha foo', 'beta', 'foo foo']);
  // Replace on the table: plan writes nothing, execution needs name, count and confirmation.
  await page
    .getByRole('complementary', { name: 'Datenbanknavigation' })
    .getByRole('button', { name: 'main.notes', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Tabellenreiter' })
    .getByRole('button', { name: 'Ersetzen', exact: true })
    .click();
  await page.getByRole('combobox', { name: /^Spalte/ }).selectOption('body');
  await page.getByLabel('Suchtext').fill('foo');
  await page.getByLabel('Ersatztext (darf leer sein)').fill('bar');
  await page.getByRole('button', { name: 'Plan anzeigen' }).click();
  await expect(page.getByTestId('replace-plan')).toBeVisible();
  expect(await bodies()).toEqual(['alpha foo', 'beta', 'foo foo']);
  const execute = page.getByRole('button', { name: 'Ersetzung ausführen' });
  await expect(execute).toBeDisabled();
  await page.getByLabel('Tabellenname zur Bestätigung').fill('notes');
  await page.getByLabel('Zeilenzahl zur Bestätigung').fill('1');
  await page.getByRole('checkbox', { name: /Ich habe Plan/ }).check();
  await expect(execute).toBeDisabled();
  await page.getByLabel('Zeilenzahl zur Bestätigung').fill('2');
  await expect(execute).toBeEnabled();
  await execute.dblclick();
  await expect(page.getByTestId('replace-result')).toContainText('Ersetzung abgeschlossen');
  expect(requests).toHaveLength(1);
  expect(await bodies()).toEqual(['alpha bar', 'beta', 'bar bar']);
});
