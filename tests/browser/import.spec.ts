// SPDX-License-Identifier: AGPL-3.0-only
// W-P12 SQL and CSV import against a mocked backend (API 0.18).
import { mkdtempSync, readFileSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { browse, description, v2Caps } from '../../src/lib/features/bulk/testing';

const fixture = (name: string) =>
  JSON.parse(readFileSync(`src/lib/features/import/fixtures/${name}.json`, 'utf8'));
const v1 = {
  contract_version: '0.1.0',
  drivers: ['sqlite', 'mysql', 'postgres'],
  credential_storage: false,
  max_rows: 10000,
  max_timeout_ms: 60000,
};
const jobId = 'a'.repeat(32);
interface Options {
  /** Result delivered when the job finishes. */
  result?: string;
  /** Polls that answer "running" before the result. */
  runningPolls?: number;
  /** Status answers 404 after the job started. */
  vanish?: boolean;
  planFixture?: Record<string, unknown>;
  executeStatus?: number;
  executeBody?: unknown;
  hangExecute?: boolean;
}
interface Mock {
  plans: Record<string, unknown>[];
  executes: Record<string, unknown>[];
  files: number[];
  statuses: number;
  cancels: number;
  release: () => void;
}
interface Part {
  name: string;
  data: Buffer;
}
function parts(buffer: Buffer | null): Part[] {
  if (!buffer) return [];
  const text = buffer.toString('latin1');
  const boundary = /^--([^\r\n]+)/.exec(text)?.[1];
  if (!boundary) return [];
  return text
    .split(`--${boundary}`)
    .map((chunk): Part | null => {
      const name = /name="(\w+)"/.exec(chunk)?.[1];
      const start = chunk.indexOf('\r\n\r\n');
      if (!name || start < 0) return null;
      const body = chunk.slice(start + 4, chunk.length - 2);
      return { name, data: Buffer.from(body, 'latin1') };
    })
    .filter((item): item is Part => item !== null);
}
async function mockBackend(page: Page, options: Options = {}): Promise<Mock> {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const mock: Mock = { plans: [], executes: [], files: [], statuses: 0, cancels: 0, release };
  let started = false;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === '/api/v1/capabilities') return json(v1);
    if (path === '/api/v1/connections/test') return json({ status: 'ok' });
    if (path === '/api/v1/catalog')
      return json({ tables: [{ name: 'items', schema: 'main', kind: 'table' }] });
    if (path === '/api/v2/capabilities') return json(v2Caps);
    if (path === '/api/v2/tables/describe') return json(description());
    if (path === '/api/v2/tables/browse') return json(browse());
    if (path === '/api/v18/capabilities') return json(fixture('ImportCapabilities.real-http'));
    if (path === '/api/v18/imports/plan' || path === '/api/v18/imports/execute') {
      const all = parts(request.postDataBuffer());
      const metadata = JSON.parse(all.find((p) => p.name === 'metadata')!.data.toString('utf8'));
      const file = all.find((p) => p.name === 'file');
      if (path.endsWith('/plan')) {
        mock.plans.push(metadata);
        return json(options.planFixture ?? fixture('ImportPlan.real-TestSQLiteImportRoundTrip'));
      }
      mock.executes.push(metadata);
      mock.files.push(file?.data.length ?? -1);
      if (options.hangExecute) await gate;
      started = true;
      return route
        .fulfill({
          status: options.executeStatus ?? 202,
          json: options.executeBody ?? {
            id: jobId,
            state: 'running',
            cancel_requested: false,
            progress: { processed: 0, total: 3 },
          },
        })
        .catch(() => {});
    }
    if (path === `/api/v18/imports/${jobId}`) {
      mock.statuses++;
      if (options.vanish && started)
        return json({ error: { code: 'import_not_found', message: 'x' } }, 404);
      if (mock.statuses <= (options.runningPolls ?? 1))
        return json({
          id: jobId,
          state: 'running',
          cancel_requested: false,
          progress: { processed: 1, total: 3 },
        });
      return json({
        id: jobId,
        state: 'finished',
        cancel_requested: false,
        progress: { processed: 3, total: 3 },
        result: fixture(options.result ?? 'ImportResult.real-sqlite-sql'),
      });
    }
    if (path === `/api/v18/imports/${jobId}/cancel`) {
      mock.cancels++;
      return json({
        id: jobId,
        state: 'running',
        cancel_requested: true,
        progress: { processed: 1, total: 3 },
      });
    }
    return json({ error: { code: 'not_found', message: 'x' } }, 404);
  });
  return mock;
}
async function connect(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
}
async function openSql(page: Page) {
  await connect(page);
  await page
    .getByRole('navigation', { name: 'Arbeitsbereich' })
    .getByRole('button', { name: 'Import', exact: true })
    .click();
  await expect(page.getByTestId('import-sql-warning')).toBeVisible();
}
async function openCsv(page: Page) {
  await connect(page);
  await page.getByRole('button', { name: /items/ }).first().click();
  await page
    .getByRole('navigation', { name: 'Tabellenreiter' })
    .getByRole('button', { name: 'Import', exact: true })
    .click();
  await expect(page.getByTestId('import-panel')).toBeVisible();
}
const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const sqlFile = (name = 'dump.sql', content = 'SELECT 1;') => ({
  name,
  mimeType: 'text/plain',
  buffer: Buffer.from(content),
});
async function runSql(page: Page, name = 'dump.sql') {
  await page.getByTestId('import-file').setInputFiles(sqlFile(name));
  await page.getByTestId('import-sql-start').click();
  await page.getByRole('dialog').getByRole('textbox').fill(name);
  const go = page.getByRole('button', { name: 'SQL jetzt ausführen' });
  await go.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
}

test('SQL import: warning first, name confirmation, one request, progress, every statement state, replay lock', async ({
  page,
}) => {
  const mock = await mockBackend(page, { result: 'ImportResult.real-sqlite-rollback' });
  await openSql(page);
  await expect(page.getByTestId('import-sql-warning')).toContainText(
    'führt beliebiges SQL ohne Plan aus',
  );
  await expect(page.getByTestId('import-sql-start')).toBeDisabled();
  const hostile = '<img src=x onerror=alert(1)>.sql';
  await runSql(page, hostile);
  await expect(page.getByTestId('import-result')).toBeVisible();
  expect(mock.executes).toHaveLength(1);
  expect(mock.executes[0]).toMatchObject({
    format: 'sql',
    confirm: { action: 'import_sql' },
    compression: 'none',
  });
  expect(mock.executes[0]).not.toHaveProperty('expected_plan_sha256');
  expect(mock.files[0]).toBe(9);
  await expect(page.getByTestId('import-file-info')).toContainText(hostile);
  expect(await page.locator('img[src="x"]').count()).toBe(0);
  await expect(
    page.locator('[data-testid="import-statement"][data-outcome="rolled_back"]').first(),
  ).toBeVisible();
  await expect(page.getByTestId('import-counts')).toContainText('zurückgerollt');
  await expect(page.getByTestId('import-sql-start')).toBeDisabled();
  expect(mock.statuses).toBeGreaterThan(0);
});

test('SQL import: an unknown statement outcome says "do not send again" and never repeats', async ({
  page,
}) => {
  const mock = await mockBackend(page, { result: 'ImportResult.real-sqlite-sql' });
  await openSql(page);
  await runSql(page);
  await expect(page.getByTestId('import-unknown')).toContainText('Nicht erneut senden');
  await expect(
    page.locator('[data-testid="import-statement"][data-outcome="not_executed"]').first(),
  ).toBeVisible();
  expect(mock.executes).toHaveLength(1);
});

test('a job that vanishes while polling ends as unknown, without retry', async ({ page }) => {
  const mock = await mockBackend(page, { vanish: true });
  await openSql(page);
  await runSql(page);
  await expect(page.getByTestId('import-error')).toContainText('Nicht erneut senden', {
    timeout: 20000,
  });
  expect(mock.executes).toHaveLength(1);
});

test('running import locks navigation and unload; cancel is requested once and the result still comes from the server', async ({
  page,
}) => {
  const mock = await mockBackend(page, { runningPolls: 3 });
  await openSql(page);
  await page.getByTestId('import-file').setInputFiles(sqlFile());
  await page.getByTestId('import-sql-start').click();
  await page.getByRole('dialog').getByRole('textbox').fill('dump.sql');
  await page.getByRole('button', { name: 'SQL jetzt ausführen' }).click();
  await expect(page.getByTestId('import-running')).toBeVisible();
  const hash = await page.evaluate(() => location.hash);
  await page.evaluate(() => (location.hash = '#/'));
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(hash);
  await expect(page.getByTestId('navigation-blocked')).toBeVisible();
  expect(
    await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
  await page.getByTestId('import-cancel').click();
  await expect.poll(() => mock.cancels).toBe(1);
  await expect(page.getByTestId('import-result')).toBeVisible({ timeout: 15000 });
  expect(mock.cancels).toBe(1);
});

test('oversized and empty files are stopped before any upload', async ({ page }) => {
  const mock = await mockBackend(page);
  await openSql(page);
  // A sparse file: one byte over the 64 MiB limit without holding 64 MiB in memory.
  const big = join(mkdtempSync(join(tmpdir(), 'dbm-import-')), 'big.sql');
  writeFileSync(big, '');
  truncateSync(big, 64 * 1024 * 1024 + 1);
  await page.getByTestId('import-file').setInputFiles(big);
  await expect(page.getByText(/größer als das erlaubte Limit/)).toBeVisible();
  await expect(page.getByTestId('import-sql-start')).toBeDisabled();
  await page.getByTestId('import-file').setInputFiles({
    name: 'empty.sql',
    mimeType: 'text/plain',
    buffer: Buffer.alloc(0),
  });
  await expect(page.getByText('Die Datei ist leer.')).toBeVisible();
  expect(mock.executes).toHaveLength(0);
});

test('CSV import: preview first, issues listed, one execute, plan spent, new preview required, hostile text stays text', async ({
  page,
}) => {
  const plan = fixture('ImportPlan.real-TestSQLiteImportRoundTrip');
  plan.preview[0][1] = { kind: 'text', value: '<img src=x onerror=alert(1)>' };
  plan.errors = [{ row: 2, column: 1, code: 'invalid_integer' }];
  plan.rows = 4;
  const mock = await mockBackend(page, {
    planFixture: plan,
    result: 'ImportResult.real-TestSQLiteImportRoundTrip',
  });
  await openCsv(page);
  // The file can only be chosen once the table description is there: the mapping follows the header.
  await expect(page.getByTestId('import-file')).toBeEnabled();
  await page.getByTestId('import-file').setInputFiles({
    name: 'rows.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('id,name\n1,a\n'),
  });
  await expect(page.getByTestId('csv-header-peek')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Feld 3' })).toHaveCount(0);
  await page.getByTestId('import-plan').click();
  await expect(page.getByTestId('import-plan-view')).toBeVisible();
  expect(mock.plans).toHaveLength(1);
  expect(mock.executes).toHaveLength(0);
  expect(mock.plans[0]).toMatchObject({
    format: 'csv',
    csv: { header: true, columns: ['id', 'name'] },
  });
  await expect(page.getByTestId('import-preview')).toContainText('<img src=x onerror=alert(1)>');
  expect(await page.locator('[data-testid="import-plan-view"] img').count()).toBe(0);
  await expect(page.getByTestId('import-plan-issues')).toContainText('Zeile 2, Spalte 1');
  // Stop mode with faulty rows: nothing to confirm.
  await expect(page.getByTestId('import-csv-start')).toBeDisabled();
  await page.getByRole('button', { name: 'Plan verwerfen und Optionen ändern' }).click();
  await page.getByTestId('import-mode').selectOption('skip');
  await page.getByTestId('import-plan').click();
  await expect(page.getByTestId('import-csv-start')).toBeEnabled();
  expect(mock.plans[1]).toMatchObject({ mode: 'skip' });
  await page.getByTestId('import-csv-start').click();
  await page.getByRole('dialog').getByRole('textbox').fill('main.items');
  await page.getByRole('button', { name: 'Jetzt einfügen' }).evaluate((b: HTMLButtonElement) => {
    b.click();
    b.click();
  });
  await expect(page.getByTestId('import-result')).toBeVisible();
  expect(mock.executes).toHaveLength(1);
  expect(mock.executes[0]).toMatchObject({
    format: 'csv',
    confirm: { action: 'import_csv' },
    expected_plan_sha256: plan.plan_sha256,
    mode: 'skip',
    table: { schema: 'main', name: 'items' },
  });
  await expect(page.getByTestId('import-plan-consumed')).toBeVisible();
  await expect(page.getByTestId('import-csv-start')).toHaveCount(0);
  await expect(page.getByTestId('import-plan')).toHaveText('Neue Vorschau erstellen');
});

test('CSV import: a refused execute (spent or changed plan) keeps the plan spent', async ({
  page,
}) => {
  const mock = await mockBackend(page, {
    executeStatus: 409,
    executeBody: { error: { code: 'plan_mismatch', message: 'serverseitig' } },
  });
  await openCsv(page);
  await page.getByTestId('import-file').setInputFiles({
    name: 'rows.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('id,name\n1,a\n'),
  });
  await page.getByTestId('import-plan').click();
  await page.getByTestId('import-csv-start').click();
  await page.getByRole('dialog').getByRole('textbox').fill('main.items');
  await page.getByRole('button', { name: 'Jetzt einfügen' }).click();
  await expect(page.getByTestId('import-error')).toContainText('bereits ausgeführt');
  await expect(page.getByTestId('import-error')).not.toContainText('serverseitig');
  await expect(page.getByTestId('import-plan-consumed')).toBeVisible();
  expect(mock.executes).toHaveLength(1);
});

test('import panels stay usable at 320px without horizontal scroll', async ({ page }) => {
  await mockBackend(page);
  await openSql(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.getByTestId('import-file').setInputFiles(sqlFile());
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.getByTestId('import-sql-start').click();
  const box = await page.getByRole('dialog').boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
});
