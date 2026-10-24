// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync(process.env.DBM_REAL_CONFIG!, 'utf8'));
for (const driver of ['sqlite', 'postgresql']) {
  test(`${driver}: real server info, database list, object overview, exact count and definition`, async ({
    page,
  }) => {
    const database = driver === 'sqlite' ? 'p06_fixture' : 'p06_probe';
    const urls: string[] = [];
    const bodies: Record<string, unknown>[] = [];
    page.on('request', (request) => {
      urls.push(request.url());
      if (request.url().includes('/api/v7/') && request.method() === 'POST')
        bodies.push(request.postDataJSON());
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Backend-Zugang' }).click();
    await page.getByLabel('Zugriffstoken').fill(config.token);
    await page.getByRole('button', { name: 'Übernehmen' }).click();
    await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
    if (driver === 'postgresql') await page.getByRole('button', { name: 'PostgreSQL' }).click();
    await page.getByLabel('Datenbank', { exact: true }).fill(database);
    if (driver === 'postgresql') {
      await page.getByLabel('Host', { exact: true }).fill('localhost');
      await page.getByLabel('Port', { exact: true }).fill(String(config.postgresPort));
      await page.getByLabel('Benutzername').fill('postgres');
      await page.getByLabel('Passwort', { exact: true }).fill(config.password);
    }
    await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
    await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();

    // Server context and database list.
    await page.goto('/#/server');
    await expect(page.getByTestId('server-facts')).toContainText(
      driver === 'sqlite' ? 'SQLite' : 'PostgreSQL',
    );
    await expect(page.getByTestId('database-table')).toBeVisible();
    await expect(
      page.getByTestId('database-table').getByRole('link', { name: database }),
    ).toHaveAttribute('href', `#/db/${database}/uebersicht`);
    if (driver === 'postgresql') {
      await page.getByText(/^Zeichensätze \(/).click();
      await expect(
        page.getByRole('table', { name: 'Zeichensätze, Kollationen, Engines' }),
      ).toBeVisible();
    }

    // Object overview: table versus view, estimated or unknown versus exact.
    await page.goto(`/#/db/${database}/uebersicht`);
    const table = page.getByTestId('objects-table');
    await expect(table).toBeVisible();
    const row = (name: string) => table.getByRole('row').filter({ hasText: name });
    await expect(row('t_a')).toContainText('Tabelle');
    await expect(row('v_a')).toContainText('Sicht');
    await expect(row('odd"name')).toBeVisible();
    await expect(row('v_a').getByTestId('row-count')).toHaveAttribute('data-state', 'unknown');
    if (driver === 'postgresql') {
      await expect(row('t_a').getByTestId('row-count')).toHaveAttribute('data-state', 'estimated');
      await expect(row('t_a')).toContainText('geschätzt');
    }
    await page.getByTestId('count-exact').click();
    await expect(page.getByTestId('exact-done')).toBeVisible();
    await expect(row('t_a').getByTestId('row-count')).toHaveAttribute('data-state', 'exact');
    await expect(row('t_a').getByTestId('row-count')).toContainText('1.000');
    await expect(row('odd"name').getByTestId('row-count')).toContainText('3');
    await expect(row('v_a').getByTestId('row-count')).toHaveAttribute('data-state', 'unknown');

    // Definition of a table with a special character in its name.
    await row('odd"name').getByRole('link', { name: 'Definition' }).click();
    await expect(page.getByTestId('definition-text')).toContainText('odd');
    await expect(page.getByTestId('definition-text')).toContainText('CREATE');
    if (driver === 'postgresql') await expect(page.getByTestId('definition-derived')).toBeVisible();
    else await expect(page.getByTestId('definition-derived')).toHaveCount(0);

    expect(bodies.length).toBeGreaterThan(0);
    expect(urls.join('\n')).not.toContain(config.token);
    expect(urls.join('\n')).not.toContain(config.password);
    expect(page.url()).not.toMatch(/password|token|SELECT/i);
  });
}
