// SPDX-License-Identifier: AGPL-3.0-only
// Requires an API 0.16 backend and an isolated disposable SQLite database named
// programs_fixture (DBM_REAL_CONFIG follows playwright.real.config.ts).
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync(process.env.DBM_REAL_CONFIG!, 'utf8'));
test('SQLite view create/replace/drop through UI with independent catalog readback', async ({
  page,
  request,
}) => {
  const connection = { driver: 'sqlite', database: 'programs_fixture' };
  const name = 'web_p19_";--';
  async function query(sql: string) {
    const response = await request.post(`${config.backendURL}/api/v1/query`, {
      headers: { Authorization: `Bearer ${config.token}` },
      data: { connection, sql },
    });
    expect(response.status()).toBe(200);
    return response.json();
  }
  await query('CREATE TABLE IF NOT EXISTS web_p19_neighbor (value INTEGER)');
  const baseline = await query('SELECT count(*) FROM web_p19_neighbor');
  await page.goto('/');
  await page.getByRole('button', { name: 'Backend-Zugang' }).click();
  await page.getByLabel('Zugriffstoken').fill(config.token);
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill('programs_fixture');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Arbeitsbereich' })
    .getByRole('button', { name: 'Programmobjekte' })
    .click();
  let writes = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/api/v16/programs/execute')) writes++;
  });
  const quoted = '"' + name.replaceAll('"', '""') + '"';
  async function execute(typed = false) {
    await page.getByRole('button', { name: 'Plan anzeigen', exact: true }).click();
    await expect(page.getByTestId('program-plan')).toBeVisible();
    await page.getByRole('checkbox', { name: /Exakte Anweisungen/ }).check();
    if (typed) {
      await page.getByLabel(/Zur Bestätigung den Namen/).fill('wrong');
      await expect(page.getByRole('button', { name: 'Ausführen', exact: true })).toBeDisabled();
      await page.getByLabel(/Zur Bestätigung den Namen/).fill(name);
    }
    const before = writes;
    await page.getByRole('button', { name: 'Ausführen', exact: true }).dblclick();
    await expect(page.getByText(/Diese Ausführung ist gesperrt/)).toBeVisible();
    expect(writes).toBe(before + 1);
  }
  try {
    await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Definitionskörper').fill('SELECT 42 AS value');
    await execute();
    expect(JSON.stringify(await query(`SELECT value FROM ${quoted}`))).toContain('42');
    await page.getByRole('button', { name: 'Neuen Plan vorbereiten' }).click();
    await page.getByRole('button', { name: `main.${name}`, exact: true }).click();
    await page.getByRole('button', { name: 'Ersetzen', exact: true }).click();
    await page.getByLabel('Definitionskörper').fill('SELECT 43 AS value');
    await page.getByRole('checkbox', { name: /Parameter und sämtliche Optionen/ }).check();
    await execute(true);
    expect(JSON.stringify(await query(`SELECT value FROM ${quoted}`))).toContain('43');
    await page.getByRole('button', { name: 'Neuen Plan vorbereiten' }).click();
    await page.getByRole('button', { name: `main.${name}`, exact: true }).click();
    await page.getByRole('button', { name: 'Löschen', exact: true }).click();
    await execute(true);
    const absent = await query(
      "SELECT name FROM sqlite_schema WHERE type='view' AND name='" +
        name.replaceAll("'", "''") +
        "'",
    );
    expect(absent.results[0].rows).toHaveLength(0);
    // Compare rows only: timings and result metadata can differ.
    expect((await query('SELECT count(*) FROM web_p19_neighbor')).results[0].rows).toEqual(
      baseline.results[0].rows,
    );
  } finally {
    await query(`DROP VIEW IF EXISTS ${quoted}`);
    await query('DROP TABLE IF EXISTS web_p19_neighbor');
  }
});
