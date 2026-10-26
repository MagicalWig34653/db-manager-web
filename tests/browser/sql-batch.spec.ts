// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, type Page } from '@playwright/test';
import capabilities from '../../src/lib/features/sql-batch/fixtures/SQLBatchCapabilities.real-sqlite-http.json' with { type: 'json' };
import stopResult from '../../src/lib/features/sql-batch/fixtures/SQLBatchResult.real-sqlite.json' with { type: 'json' };

async function open(page: Page, pending = false) {
  const calls: Record<string, unknown>[] = [];
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/capabilities')
      return route.fulfill({
        json: {
          contract_version: '0.1.0',
          drivers: ['sqlite'],
          credential_storage: false,
          max_rows: 10000,
          max_timeout_ms: 60000,
        },
      });
    if (path === '/api/v1/connections/test') return route.fulfill({ json: { status: 'ok' } });
    if (path === '/api/v1/catalog')
      return route.fulfill({
        json: { tables: [{ name: 'synthetic', schema: 'main', kind: 'table' }] },
      });
    if (path === '/api/v12/capabilities') return route.fulfill({ json: capabilities });
    if (path.startsWith('/api/v12/sql/')) {
      calls.push(route.request().postDataJSON());
      if (pending) await gate;
      return route.fulfill({ json: stopResult }).catch(() => {});
    }
    return route.fulfill({
      status: 404,
      json: { error: { code: 'not_found', message: 'synthetic' } },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'SQL-Stapel', exact: true }).click();
  await expect(page.getByTestId('batch-driver-reason')).toBeVisible();
  return { calls, release };
}
async function consent(page: Page) {
  for (const checkbox of await page.getByTestId('sql-batch-panel').getByRole('checkbox').all())
    await checkbox.check();
}

test('batch requires separate consent, sends once, and displays per-statement failure and skipped results', async ({
  page,
}) => {
  const { calls } = await open(page);
  await page.getByTestId('batch-sql').fill('SELECT 1; SELECT 2;');
  const run = page.getByRole('button', { name: 'Bestätigt ausführen' });
  await expect(run).toBeDisabled();
  await page.getByRole('checkbox').first().check();
  await expect(run).toBeDisabled();
  await page.getByRole('checkbox').nth(1).check();
  await run.dblclick();
  await expect(page.getByTestId('batch-statement')).toHaveCount(5);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ confirm: true, mode: 'stop', sql: 'SELECT 1; SELECT 2;' });
  await expect(page.getByTestId('batch-statement').nth(2)).toHaveAttribute(
    'data-outcome',
    'outcome_unknown',
  );
  await expect(page.getByTestId('batch-statement').nth(3)).toHaveAttribute(
    'data-outcome',
    'not_executed',
  );
  await expect(run).toBeDisabled();
});

test('in-flight batch blocks hash navigation and beforeunload; cancellation warns without replay', async ({
  page,
}) => {
  const { calls, release } = await open(page, true);
  try {
    await page.getByTestId('batch-sql').fill('SELECT 1;');
    await consent(page);
    await page.getByRole('button', { name: 'Bestätigt ausführen' }).click();
    await expect.poll(() => calls.length).toBe(1);
    const hash = await page.evaluate(() => location.hash);
    await page.evaluate(() => {
      location.hash = '#/db/synthetic/sql';
    });
    await expect(page.getByTestId('navigation-blocked')).toBeVisible();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(hash);
    expect(
      await page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    ).toBe(true);
    await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await expect(page.getByTestId('sql-batch-panel').getByRole('alert')).toContainText(
      'Ausgang unbekannt',
    );
    expect(calls).toHaveLength(1);
  } finally {
    release();
  }
});

test('DELIMITER help, explicit analyze warning and editor stay usable at 320px', async ({
  page,
}) => {
  await open(page);
  await page.setViewportSize({ width: 320, height: 800 });
  const panel = page.getByTestId('sql-batch-panel');
  await expect(panel.getByText(/BEGIN … END mit inneren Semikolons/)).toBeVisible();
  await expect(panel.getByText(/EXPLAIN ANALYZE <DML>/)).toBeVisible();
  await page.getByRole('combobox', { name: /^Aktion/ }).selectOption('explain');
  await expect(panel.getByText(/SQLite verwendet EXPLAIN QUERY PLAN/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
