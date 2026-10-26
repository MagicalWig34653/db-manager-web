// SPDX-License-Identifier: AGPL-3.0-only
// Run against a disposable fixture. DBM_REAL_INDEXES_CONFIG supplies backendURL, token,
// connection (API shape), table (TableRef), column, and driver ('sqlite' or 'postgresql').
// The fixture must contain at least one row and a neighbour table checked by its harness.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const config = process.env.DBM_REAL_INDEXES_CONFIG
  ? JSON.parse(readFileSync(process.env.DBM_REAL_INDEXES_CONFIG, 'utf8'))
  : null;
test('real index create/drop with independent catalog read-back', async ({ page, request }) => {
  test.skip(!config, 'DBM_REAL_INDEXES_CONFIG and a disposable backend fixture are required.');
  const headers = { Authorization: `Bearer ${config.token}` };
  const name = 'web_idx " ;DROP';
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const query = async (sql: string) => {
    const response = await request.post(`${config.backendURL}/api/v1/query`, {
      headers,
      data: { connection: config.connection, sql },
    });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };
  const countSQL =
    config.driver === 'sqlite'
      ? `SELECT count(*) FROM sqlite_schema WHERE type='index' AND name=${literal(name)}`
      : `SELECT count(*) FROM pg_indexes WHERE schemaname=${literal(config.table.schema ?? 'public')} AND indexname=${literal(name)}`;
  const count = async () => {
    const data = await query(countSQL);
    return data.results[0].rows[0][0].value;
  };
  expect(String(await count())).toBe('0');
  const rowsBefore = await query(
    `SELECT count(*) FROM ${config.table.schema ? quote(config.table.schema) + '.' : ''}${quote(config.table.name)}`,
  );
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/v13/indexes/alter')) requests.push(r.postData() ?? '');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Backend-Zugang' }).click();
  await page.getByLabel('Zugriffstoken').fill(config.token);
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  if (config.driver === 'postgresql') {
    await page.getByRole('button', { name: 'PostgreSQL' }).click();
    await page.getByLabel('Host', { exact: true }).fill(config.connection.host);
    await page.getByLabel('Port', { exact: true }).fill(String(config.connection.port));
    await page.getByLabel('Benutzername').fill(config.connection.username);
    await page.getByLabel('Passwort', { exact: true }).fill(config.connection.password);
  }
  await page.getByLabel('Datenbank', { exact: true }).fill(config.connection.database);
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
  await page
    .getByRole('button', {
      name: `${config.table.schema ? config.table.schema + '.' : ''}${config.table.name}`,
      exact: true,
    })
    .click();
  await page
    .getByRole('navigation', { name: 'Tabellenreiter' })
    .getByRole('button', { name: 'Indizes', exact: true })
    .click();
  await page.getByLabel('Neuer Index- oder Constraintname').fill(name);
  await page.getByLabel('Spalte 1', { exact: true }).selectOption(config.column);
  await page.getByRole('button', { name: 'Plan anzeigen' }).click();
  await expect(page.getByTestId('indexes-plan')).toBeVisible();
  expect(requests).toHaveLength(0);
  expect(String(await count())).toBe('0');
  await page.getByRole('checkbox', { name: /Vorschau und Warnungen/ }).check();
  await page.getByRole('button', { name: 'Ausführen', exact: true }).dblclick();
  await expect(page.getByTestId('indexes-result')).toContainText('abgeschlossen');
  expect(requests).toHaveLength(1);
  expect(String(await count())).toBe('1');
  await page.getByRole('button', { name: 'Neue Änderung vorbereiten' }).click();
  await page.getByLabel('Aktion', { exact: true }).selectOption('index_drop');
  await page.getByLabel('Bestehender Name aus dem Katalog').selectOption(name);
  await page.getByRole('button', { name: 'Plan anzeigen' }).click();
  await page.getByRole('button', { name: 'Änderung mit Namen bestätigen' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('wrong');
  await expect(dialog.getByRole('button', { name: 'Endgültig ausführen' })).toBeDisabled();
  expect(requests).toHaveLength(1);
  await dialog.getByRole('textbox').fill(config.table.name);
  await dialog.getByRole('button', { name: 'Endgültig ausführen' }).click();
  await expect(page.getByTestId('indexes-result')).toContainText('abgeschlossen');
  expect(requests).toHaveLength(2);
  expect(String(await count())).toBe('0');
  expect(
    await query(
      `SELECT count(*) FROM ${config.table.schema ? quote(config.table.schema) + '.' : ''}${quote(config.table.name)}`,
    ),
  ).toEqual(rowsBefore);
});
