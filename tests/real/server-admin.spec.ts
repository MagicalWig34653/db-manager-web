// SPDX-License-Identifier: AGPL-3.0-only
// Real acceptance of the read-only server administration (API 0.17) and monitor (API 0.20) views
// against a disposable backend and database (driven by scripts/test-real-server-admin.py).
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(process.env.DBM_REAL_CONFIG!, 'utf8')) as {
  token: string;
  backendURL: string;
  system: 'sqlite' | 'mysql' | 'maria' | 'postgres';
  connection: Record<string, string | number>;
};
const network = config.system !== 'sqlite';

async function connect(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Backend-Zugang' }).click();
  await page.getByLabel('Zugriffstoken').fill(config.token);
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  if (config.system === 'postgres') await page.getByRole('button', { name: 'PostgreSQL' }).click();
  if (config.system === 'mysql' || config.system === 'maria')
    await page.getByRole('button', { name: /MySQL \/ MariaDB/ }).click();
  await page.getByLabel('Datenbank', { exact: true }).fill(String(config.connection.database));
  if (network) {
    await page.getByLabel('Host', { exact: true }).fill(String(config.connection.host));
    await page.getByLabel('Port', { exact: true }).fill(String(config.connection.port));
    await page.getByLabel('Benutzername').fill(String(config.connection.username));
    await page.getByLabel('Passwort', { exact: true }).fill(String(config.connection.password));
  }
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    location.hash = '#/server/serververwaltung';
  });
}

async function independentValue(
  request: import('@playwright/test').APIRequestContext,
  sql: string,
) {
  const response = await request.post(`${config.backendURL}/api/v1/query`, {
    headers: { Authorization: `Bearer ${config.token}` },
    data: { connection: config.connection, sql },
  });
  expect(response.status(), await response.text()).toBe(200);
  const cell = (await response.json()).results[0].rows[0][0];
  return String(cell.value);
}

test(`${config.system}: server administration reads status, variables and processes`, async ({
  page,
  request,
}) => {
  const paths: string[] = [];
  page.on('request', (r) => paths.push(new URL(r.url()).pathname));
  await connect(page);
  const panel = page.getByTestId('server-admin');
  await expect(panel.getByTestId('admin-readonly')).toBeVisible();
  const status = page.getByTestId('admin-table-status');
  await expect(status).toBeVisible();
  await expect(status.getByRole('row')).not.toHaveCount(1);

  if (!network) {
    await expect(status).toContainText(/\d+\.\d+/);
    await page.getByRole('tab', { name: 'Variablen' }).click();
    await expect(page.getByText(/SQLite/).first()).toBeVisible();
    await expect(page.getByTestId('admin-pager')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Prozesse' }).click();
    await expect(page.getByTestId('admin-pager')).toHaveCount(0);
  } else {
    // Variables: a known non-secret number must equal an independent query; secrets stay masked.
    await page.getByRole('tab', { name: 'Variablen' }).click();
    await expect(page.getByTestId('admin-table-variables')).toBeVisible();
    await page.getByTestId('admin-filter').fill('max_connections');
    await page.getByRole('button', { name: 'Filter anwenden' }).click();
    const row = page
      .getByTestId('admin-table-variables')
      .getByRole('row')
      .filter({ hasText: /^max_connections/ });
    await expect(row).toHaveCount(1);
    const expected = await independentValue(
      request,
      config.system === 'postgres' ? 'SHOW max_connections' : 'SELECT @@max_connections',
    );
    await expect(row.getByRole('cell')).toHaveText(new RegExp(`^${expected}$`));
    await page.getByTestId('admin-filter').fill('ssl');
    await page.getByRole('button', { name: 'Filter anwenden' }).click();
    await expect(page.getByTestId('admin-table-variables')).not.toContainText(
      /BEGIN|\.pem|\/fixture/,
    );
    if (config.system !== 'postgres') {
      await page.getByTestId('admin-scope').selectOption('GLOBAL');
      await expect(page.getByTestId('admin-meta')).toBeVisible();
    }
    // Processes: the own connection is marked.
    await page.getByRole('tab', { name: 'Prozesse' }).click();
    await expect(page.getByTestId('admin-table-processes')).toBeVisible();
    await expect(page.getByTestId('self-badge')).toHaveCount(1);
    await expect(page.getByTestId('admin-visibility')).toBeVisible();
  }
  expect(paths.filter((p) => /kill|flush|\/set/i.test(p))).toEqual([]);
});

test(`${config.system}: monitor samples, rates, engines and honest unavailable states`, async ({
  page,
}) => {
  await connect(page);
  await page.evaluate(() => {
    location.hash = '#/server/monitor';
  });
  await expect(page.getByTestId('monitor-readonly')).toBeVisible();
  await expect(page.getByTestId('sample-facts')).toBeVisible();
  if (network) {
    await page.getByTestId('monitor-refresh').click();
    await expect(page.getByTestId('rates-first')).toHaveCount(0, { timeout: 15000 });
    await expect(page.getByTestId('monitor-rates')).toContainText('/ s');
  } else {
    await expect(page.getByTestId('sample-facts')).toContainText(/\d+\.\d+/);
  }
  // Engines
  await page.getByRole('tab', { name: 'Engines' }).click();
  await expect(
    page
      .getByTestId('monitor-table')
      .or(page.getByTestId('monitor-unavailable'))
      .or(page.getByTestId('monitor-empty')),
  ).toBeVisible();
  // Analysis, advisor, replication: data, empty or an explained unavailable state, never an error.
  for (const name of ['Abfrageanalyse', 'Hinweise', 'Replikation']) {
    await page.getByRole('tab', { name }).click();
    if (!network && name !== 'Hinweise') {
      await expect(page.getByText('Für diesen Treiber nicht unterstützt')).toBeVisible();
      continue;
    }
    await expect(
      page
        .getByTestId('monitor-table')
        .or(page.getByTestId('monitor-unavailable'))
        .or(page.getByTestId('monitor-empty'))
        .or(page.getByTestId('sample-facts'))
        .or(page.getByTestId('monitor-no-hints'))
        .or(page.getByTestId('monitor-hints'))
        .first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  if (network) {
    // Binary logs: MySQL lists logs, MariaDB (log_bin off) and PostgreSQL explain the missing source.
    await page.getByRole('tab', { name: 'Binärlogs' }).click();
    await expect(
      page
        .getByTestId('monitor-table')
        .or(page.getByTestId('monitor-unavailable'))
        .or(page.getByTestId('monitor-empty'))
        .or(page.getByText(/nicht unterstützt/).first())
        .first(),
    ).toBeVisible({ timeout: 15000 });
    if (config.system === 'mysql') {
      await expect(page.getByTestId('open-events').first()).toBeVisible();
      await page.getByTestId('open-events').first().click();
      await expect(page.getByTestId('binlog-events')).toBeVisible();
      await expect(
        page
          .getByTestId('binlog-events')
          .getByTestId('monitor-table')
          .or(page.getByTestId('binlog-events').getByTestId('monitor-empty'))
          .first(),
      ).toBeVisible({ timeout: 15000 });
    }
    // EXPLAIN of a trivial statement; a faulty statement is an error, not "unavailable".
    await page.getByRole('tab', { name: /Profiling/ }).click();
    await page.getByTestId('profiling-sql').fill('SELECT 1');
    await page.getByTestId('profiling-run').click();
    await expect(page.getByTestId('monitor-table')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('profiling-sql').fill('SELECT nope FROM missing_table_xyz');
    await page.getByTestId('profiling-run').click();
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('monitor-unavailable')).toHaveCount(0);
  }
});
