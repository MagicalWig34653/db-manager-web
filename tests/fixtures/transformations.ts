// SPDX-License-Identifier: AGPL-3.0-only
// Mocked backend for the W-P22 browser specs (table with a URL, a JSON and a BLOB column).
import { expect, type Page } from '@playwright/test';
import { FakeConfigServer } from '../../src/lib/features/config-store/testing';
import {
  description,
  insertEligibility,
  structure,
  updateEligibility,
  v2Caps,
  v3Caps,
  v4Caps,
  v5Caps,
} from '../../src/lib/features/bulk/testing';

export const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
export const v1 = {
  contract_version: '0.1.0',
  drivers: ['sqlite'],
  credential_storage: false,
  max_rows: 10000,
  max_timeout_ms: 60000,
};
const rows = [
  [
    { kind: 'integer', value: '1' },
    { kind: 'text', value: 'https://example.com/a' },
    { kind: 'text', value: '{"a":[1,2]}' },
    { kind: 'binary', value: PNG },
  ],
  [
    { kind: 'integer', value: '2' },
    { kind: 'text', value: 'javascript:alert(1)' },
    { kind: 'text', value: '<img src=x onerror=alert(1)>' },
    { kind: 'binary', value: btoa('<svg onload="alert(1)"/>') },
  ],
];
const browse = () => {
  const d = description();
  return {
    description: d,
    result: {
      columns: d.columns.map((c) => ({ name: c.name, database_type: c.database_type })),
      rows,
      truncated: false,
    },
    offset: 0,
    page_size: 100,
    has_more: false,
    stable_order: true,
    duration_ms: 1,
  };
};
export async function setup(page: Page, fake: FakeConfigServer) {
  const external: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol === 'data:')
      external.push(request.url());
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path.startsWith('/api/v24/')) {
      const answer = await fake.fetch(path + url.search, {
        method: request.method(),
        headers: request.headers(),
        body: request.postData() ?? undefined,
      });
      return route.fulfill({
        status: answer.status,
        headers: Object.fromEntries(answer.headers.entries()),
        body: answer.status === 204 ? undefined : await answer.text(),
      });
    }
    if (path === '/api/v1/capabilities') return json(v1);
    if (path === '/api/v1/connections/test') return json({ status: 'ok' });
    if (path === '/api/v1/catalog')
      return json({ tables: [{ name: 'items', schema: 'main', kind: 'table' }] });
    if (path === '/api/v2/capabilities') return json(v2Caps);
    if (path === '/api/v2/tables/describe') return json(description());
    if (path === '/api/v2/tables/browse') return json(browse());
    if (path === '/api/v3/capabilities') return json(v3Caps);
    if (path === '/api/v4/capabilities') return json(v4Caps);
    if (path === '/api/v3/tables/eligibility') return json(updateEligibility());
    if (path === '/api/v4/tables/insert-eligibility') return json(insertEligibility(true));
    if (path === '/api/v5/capabilities') return json(v5Caps);
    if (path === '/api/v5/tables/structure') return json(structure());
    return json({ error: { code: 'not_found', message: 'x' } }, 404);
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Backend-Zugang' }).click();
  await page.getByLabel('Zugriffstoken').fill(fake.token);
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /items/ }).first().click();
  await expect(
    page.getByRole('button', { name: 'Anzeige für Spalte name festlegen' }),
  ).toBeEnabled();
  return external;
}
