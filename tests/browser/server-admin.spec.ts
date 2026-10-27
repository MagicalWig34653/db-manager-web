// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic browser acceptance for read-only server administration (API 0.17) and monitor (API 0.20).
import { test, expect, type Page } from '@playwright/test';
import {
  capabilities as adminCaps,
  result as adminResult,
} from '../../src/lib/features/server-admin/testing';
import {
  capabilities as monitorCaps,
  result as monitorResult,
} from '../../src/lib/features/monitor/testing';

type Seen = { url: string; body: Record<string, unknown> | undefined }[];

async function mockBackend(
  page: Page,
  seen: Seen = [],
  mode: { monitorError?: boolean; hostile?: boolean } = {},
) {
  await page.route('**/api/v1/**', (route) => {
    const url = route.request().url();
    if (url.endsWith('/capabilities'))
      return route.fulfill({
        json: {
          contract_version: '0.1.0',
          drivers: ['sqlite', 'mysql', 'postgres'],
          credential_storage: false,
          max_rows: 10000,
          max_timeout_ms: 60000,
        },
      });
    if (url.endsWith('/connections/test')) return route.fulfill({ json: { status: 'ok' } });
    if (url.endsWith('/catalog')) return route.fulfill({ json: { tables: [] } });
    return route.fulfill({ status: 404, json: { error: { code: 'not_found', message: '' } } });
  });
  await page.route('**/api/v17/**', (route) => {
    const request = route.request();
    const url = request.url();
    seen.push({ url, body: request.postData() ? JSON.parse(request.postData()!) : undefined });
    if (url.endsWith('/capabilities')) return route.fulfill({ json: adminCaps() });
    if (url.endsWith('/processes'))
      return route.fulfill({
        json: adminResult('processes', {
          processes: [
            { id: '7', user: 'app', database: 'synthetic', seconds: 3, self: true },
            {
              id: '9',
              user: mode.hostile ? '<img src=x onerror=alert(1)>' : 'batch',
              database: '',
              seconds: 90061,
              self: false,
            },
          ],
        }),
      });
    if (url.endsWith('/variables'))
      return route.fulfill({
        json: adminResult('variables', {
          values: [
            { name: 'max_connections', value: '151', masked: false },
            { name: 'ssl_key', value: null, masked: true },
          ],
        }),
      });
    return route.fulfill({
      json: adminResult('status', {
        values: [{ name: 'Connections', value: '1234567890123456789', masked: false }],
        has_more: true,
      }),
    });
  });
  let sampleCount = 0;
  await page.route('**/api/v20/**', (route) => {
    const request = route.request();
    const url = request.url();
    seen.push({ url, body: request.postData() ? JSON.parse(request.postData()!) : undefined });
    if (url.endsWith('/capabilities')) return route.fulfill({ json: monitorCaps() });
    if (mode.monitorError && !url.endsWith('/sample'))
      return route.fulfill({
        status: 422,
        json: { error: { code: 'database_error', message: 'x' } },
      });
    if (url.endsWith('/analysis'))
      return route.fulfill({
        json: monitorResult('analysis', [], {
          state: 'unavailable',
          source: 'none',
          reason: 'performance_schema ist deaktiviert.',
        }),
      });
    if (url.endsWith('/replication')) return route.fulfill({ json: monitorResult('replication') });
    sampleCount += 1;
    return route.fulfill({
      json: monitorResult(
        'sample',
        [{ uptime: String(100 + sampleCount * 10), questions: String(sampleCount * 500) }],
        {
          sampled_at: new Date(Date.UTC(2026, 9, 27, 9, 0, sampleCount * 10)).toISOString(),
        },
      ),
    });
  });
}
async function open(page: Page, tab: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByRole('button', { name: /MySQL \/ MariaDB/ }).click();
  await page.getByLabel('Host', { exact: true }).fill('fixture.invalid');
  await page.getByLabel('Benutzername', { exact: true }).fill('synthetic');
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
  await page.evaluate((hash) => {
    location.hash = hash;
  }, `#/server/${tab}`);
}
const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('server administration: tabs by keyboard, big counters, masking and paging', async ({
  page,
}) => {
  const seen: Seen = [];
  await mockBackend(page, seen);
  await open(page, 'serververwaltung');
  await expect(page.getByTestId('admin-table-status')).toContainText('1.234.567.890.123.456.789');
  await expect(page.getByTestId('admin-readonly')).toBeVisible();
  const tabs = page.getByRole('tablist', { name: 'Bereiche der Serververwaltung' });
  await tabs.getByRole('tab', { name: 'Status' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Variablen' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByTestId('masked-badge')).toHaveText('maskiert');
  await expect(page.getByTestId('admin-table-variables')).not.toContainText('null');
  await page.keyboard.press('End');
  await expect(page.getByTestId('admin-table-processes')).toBeVisible();
  await expect(page.getByTestId('self-badge')).toHaveCount(1);
  expect(seen.map((entry) => new URL(entry.url).pathname).sort()).toEqual(
    expect.arrayContaining([
      '/api/v17/capabilities',
      '/api/v17/processes',
      '/api/v17/status',
      '/api/v17/variables',
    ]),
  );
  expect(
    seen.every((entry) => !/kill|flush|set/i.test(new URL(entry.url).pathname.split('/').pop()!)),
  ).toBe(true);
});

test('server administration: hostile process names are text and 320 px has no horizontal scroll', async ({
  page,
}) => {
  await mockBackend(page, [], { hostile: true });
  await open(page, 'serververwaltung');
  await page.setViewportSize({ width: 320, height: 700 });
  await page.getByRole('tab', { name: 'Prozesse' }).click();
  await expect(page.getByTestId('admin-table-processes')).toContainText(
    '<img src=x onerror=alert(1)>',
  );
  expect(await page.locator('img[src="x"]').count()).toBe(0);
  expect(await noHorizontalScroll(page)).toBe(true);
});

test('server administration: the filter is sent to the server and paging uses the offset', async ({
  page,
}) => {
  const seen: Seen = [];
  await mockBackend(page, seen);
  await open(page, 'serververwaltung');
  await expect(page.getByTestId('admin-table-status')).toBeVisible();
  await page.getByTestId('admin-filter').fill('Conn');
  await page.getByRole('button', { name: 'Filter anwenden' }).click();
  await expect.poll(() => seen.some((entry) => entry.body?.filter === 'Conn')).toBe(true);
  await page.getByTestId('admin-next').click();
  await expect.poll(() => seen.some((entry) => entry.body?.offset === 100)).toBe(true);
});

test('monitor: unavailable source is explained, errors are errors, rates need two samples', async ({
  page,
}) => {
  await mockBackend(page);
  await open(page, 'monitor');
  await expect(page.getByTestId('sample-facts')).toBeVisible();
  await expect(page.getByTestId('rates-first')).toBeVisible();
  await page.getByTestId('monitor-refresh').click();
  await expect(page.getByTestId('rate-questions')).toContainText('50 / s');
  await expect(page.getByTestId('sparkline')).toBeVisible();
  await page.getByRole('tab', { name: 'Abfrageanalyse' }).click();
  await expect(page.getByTestId('monitor-unavailable')).toContainText(
    'performance_schema ist deaktiviert.',
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Replikation' }).click();
  await expect(page.getByTestId('monitor-empty')).toContainText('kein Beweis');
});

test('monitor: a rights error is shown as an error, not as unavailable', async ({ page }) => {
  await mockBackend(page, [], { monitorError: true });
  await open(page, 'monitor');
  await page.getByRole('tab', { name: 'Binärlogs' }).click();
  await expect(page.getByRole('alert')).toContainText('Monitordaten nicht verfügbar');
  await expect(page.getByTestId('monitor-unavailable')).toHaveCount(0);
});

test('monitor: auto refresh is opt-in and stops when switched off; 320 px', async ({ page }) => {
  const seen: Seen = [];
  await mockBackend(page, seen);
  await open(page, 'monitor');
  await page.setViewportSize({ width: 320, height: 700 });
  await expect(page.getByTestId('sample-facts')).toBeVisible();
  const samples = () => seen.filter((entry) => entry.url.endsWith('/sample')).length;
  const initial = samples();
  await page.waitForTimeout(1500);
  expect(samples()).toBe(initial);
  await page.getByTestId('auto-refresh-toggle').check();
  await expect(page.getByTestId('auto-refresh-status')).toContainText('Aktiv');
  await page.getByTestId('auto-refresh-toggle').uncheck();
  await expect(page.getByTestId('auto-refresh-status')).toHaveText('');
  expect(await noHorizontalScroll(page)).toBe(true);
});
