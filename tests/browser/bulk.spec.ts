// SPDX-License-Identifier: AGPL-3.0-only
// W-P13 multi row actions, file values and foreign key lookup against a mocked backend (API 0.19).
import { test, expect, type Page, type Route } from '@playwright/test';
import {
  browse,
  bulkCaps,
  description,
  hostile,
  insertEligibility,
  keyOf,
  ownersDescription,
  structure,
  updateEligibility,
  v2Caps,
  v3Caps,
  v4Caps,
  v5Caps,
} from '../../src/lib/features/bulk/testing';

const v1 = {
  contract_version: '0.1.0',
  drivers: ['sqlite', 'mysql', 'postgres'],
  credential_storage: false,
  max_rows: 10000,
  max_timeout_ms: 60000,
};
interface Options {
  /** Hang the execute answer until released. */
  hangExecute?: boolean;
  executeStatus?: number;
  executeBody?: unknown;
  noBulk?: boolean;
  autoPk?: boolean;
  uploadStatus?: number;
  uploadBody?: unknown;
}
interface Mock {
  plans: Record<string, unknown>[];
  executes: Record<string, unknown>[];
  uploads: { fields: string[]; size: number }[];
  downloads: Record<string, unknown>[];
  lookups: Record<string, unknown>[];
  release: () => void;
}
const planFor = (body: {
  action: string;
  rows: { expected: { values: { value?: string }[] } }[];
}) => ({
  table: { schema: 'main', name: 'items' },
  action: body.action,
  row_count: body.rows.length,
  rows: body.rows.map((row, i) => ({
    key: keyOf(row.expected.values[0].value ?? ''),
    stability_sha256: String(i + 1).repeat(64),
  })),
  warnings: ['Trigger und Kaskaden können weitere Wirkungen haben.'],
  plan_sha256: 'e'.repeat(64),
});
async function mockBackend(page: Page, options: Options = {}): Promise<Mock> {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const mock: Mock = { plans: [], executes: [], uploads: [], downloads: [], lookups: [], release };
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    const body =
      request.method() === 'POST' && !path.includes('values/upload')
        ? request.postDataJSON()
        : null;
    if (path === '/api/v1/capabilities') return json(v1);
    if (path === '/api/v1/connections/test') return json({ status: 'ok' });
    if (path === '/api/v1/catalog')
      return json({ tables: [{ name: 'items', schema: 'main', kind: 'table' }] });
    if (path === '/api/v2/capabilities') return json(v2Caps);
    if (path === '/api/v2/tables/describe')
      return json(body.table.name === 'owners' ? ownersDescription() : description());
    if (path === '/api/v2/tables/browse') return json(browse());
    if (path === '/api/v3/capabilities') return json(v3Caps);
    if (path === '/api/v4/capabilities') return json(v4Caps);
    if (path === '/api/v3/tables/eligibility') return json(updateEligibility());
    if (path === '/api/v4/tables/insert-eligibility')
      return json(insertEligibility(options.autoPk ?? true));
    if (path === '/api/v5/capabilities') return json(v5Caps);
    if (path === '/api/v5/tables/structure') return json(structure());
    if (path === '/api/v19/capabilities')
      return options.noBulk
        ? json({ error: { code: 'not_found', message: 'x' } }, 404)
        : json(bulkCaps());
    if (path === '/api/v19/rows/plan') {
      mock.plans.push(body);
      return json(planFor(body));
    }
    if (path === '/api/v19/rows/execute') {
      mock.executes.push(body);
      if (options.hangExecute) await gate;
      return route
        .fulfill({
          status: options.executeStatus ?? 200,
          json: options.executeBody ?? {
            outcome: 'completed',
            rows: (body.rows as unknown[]).map((_, index) => ({ index, outcome: 'completed' })),
          },
        })
        .catch(() => {});
    }
    if (path === '/api/v19/values/upload') {
      const data = request.postDataBuffer();
      const text = data?.toString('latin1') ?? '';
      mock.uploads.push({
        fields: [...text.matchAll(/Content-Disposition: form-data; name="(\w+)"/gi)].map(
          (m) => m[1],
        ),
        size: data?.length ?? 0,
      });
      return json(
        options.uploadBody ?? { outcome: 'committed', changed: true },
        options.uploadStatus ?? 200,
      );
    }
    if (path === '/api/v19/values/download') {
      mock.downloads.push(body);
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/octet-stream', 'content-length': '3' },
        body: Buffer.from([1, 2, 3]),
      });
    }
    if (path === '/api/v19/foreign-keys/lookup') {
      mock.lookups.push(body);
      return json({
        table: { schema: 'main', name: 'owners' },
        value_column: 'id',
        display_column: body.display_column,
        choices: [
          { value: { kind: 'integer', value: '42' }, display: { kind: 'text', value: hostile } },
        ],
        has_more: false,
      });
    }
    return json({ error: { code: 'not_found', message: 'x' } }, 404);
  });
  return mock;
}
async function openTable(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Backend-Zugang' }).click();
  await page.getByLabel('Zugriffstoken').fill('synthetic-token');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /items/ }).first().click();
  await expect(page.getByRole('checkbox', { name: 'Zeile 1 auswählen' })).toBeVisible();
}
const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test('selection: limit, bar, export of the selection only, hostile text stays text', async ({
  page,
}) => {
  await mockBackend(page);
  await openTable(page);
  await expect(page.getByTestId('bulk-bar')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Zeile 2 auswählen' }).check();
  await expect(page.getByTestId('bulk-count')).toContainText('1 Zeilen ausgewählt');
  await page.getByRole('checkbox', { name: 'Zeile 1 auswählen' }).check();
  await expect(page.getByTestId('bulk-count')).toContainText('2 Zeilen ausgewählt');
  await expect(page.getByText(/Nur die 2 ausgewählten Zeilen/)).toBeVisible();
  expect(await page.locator('img[src="x"]').count()).toBe(0);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Ergebnis herunterladen' }).first().click(),
  ]);
  const text = await (await download.createReadStream()).toArray();
  const content = Buffer.concat(text as Buffer[]).toString('utf8');
  expect(content).toContain('"table_selection"');
  expect(content).toContain('alpha');
  expect(content).not.toContain('"3"');
  await page.getByRole('button', { name: 'Auswahl aufheben' }).click();
  await expect(page.getByTestId('bulk-bar')).toHaveCount(0);
});

test('delete: preview writes nothing, typed count and consent are required, double click sends one request, plan is spent', async ({
  page,
}) => {
  const mock = await mockBackend(page);
  await openTable(page);
  await page.getByRole('checkbox', { name: 'Zeile 1 auswählen' }).check();
  await page.getByRole('checkbox', { name: 'Zeile 3 auswählen' }).check();
  await page.getByTestId('bulk-delete').click();
  await expect(page.getByTestId('bulk-plan-view')).toBeVisible();
  expect(mock.plans).toHaveLength(1);
  expect(mock.plans[0]).toMatchObject({ action: 'delete' });
  expect(mock.plans[0]).not.toHaveProperty('confirm');
  expect(mock.executes).toHaveLength(0);
  await expect(page.getByTestId('bulk-plan-keys')).toContainText('id = 1');
  const run = page.getByTestId('bulk-execute');
  await expect(run).toBeDisabled();
  await page.getByRole('checkbox', { name: /Ich bestätige diesen Vorgang für 2 Zeilen/ }).check();
  await expect(run).toBeDisabled();
  await page.getByTestId('bulk-typed').fill('3');
  await expect(run).toBeDisabled();
  await page.getByTestId('bulk-typed').fill('2');
  await expect(run).toBeEnabled();
  await run.dblclick();
  await expect(page.getByTestId('bulk-result')).toBeVisible();
  expect(mock.executes).toHaveLength(1);
  expect(mock.executes[0]).toMatchObject({
    confirm: true,
    expected_plan_sha256: 'e'.repeat(64),
    action: 'delete',
  });
  expect(
    (mock.executes[0].rows as { stability_sha256: string }[]).map((r) => r.stability_sha256),
  ).toEqual(['1'.repeat(64), '2'.repeat(64)]);
  await expect(page.getByTestId('bulk-row-result')).toHaveCount(2);
  // The button stays in place (disabled): a second click can never hit something else.
  await expect(run).toBeDisabled();
});

test('update: only chosen columns are sent; copy with automatic key needs no input', async ({
  page,
}) => {
  const mock = await mockBackend(page);
  await openTable(page);
  await page.getByRole('checkbox', { name: 'Zeile 1 auswählen' }).check();
  await page.getByTestId('bulk-update').click();
  await page.getByRole('button', { name: 'Vorschau erstellen' }).click();
  await expect(page.getByTestId('bulk-message')).toBeVisible();
  expect(mock.plans).toHaveLength(0);
  await page.getByLabel('Angabe für name', { exact: true }).selectOption('value');
  await page.getByLabel('Wert für name', { exact: true }).fill(hostile);
  await page.getByRole('button', { name: 'Vorschau erstellen' }).click();
  await expect(page.getByTestId('bulk-plan-view')).toBeVisible();
  expect(mock.plans[0]).toMatchObject({
    action: 'update',
    changes: [{ column: 'name', value: { kind: 'text', value: hostile } }],
  });
  await expect(page.getByTestId('bulk-plan-view')).toContainText(hostile);
  expect(await page.locator('[data-testid="bulk-plan-view"] img').count()).toBe(0);
  await page.getByTestId('bulk-plan-view').getByRole('button', { name: 'Zurück' }).click();
  await page.getByRole('button', { name: 'Verwerfen' }).click();
  // Closing clears the selection: a stale selection never survives a dialog.
  await expect(page.getByTestId('bulk-bar')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Zeile 1 auswählen' }).check();
  await page.getByTestId('bulk-copy').click();
  await expect(page.getByTestId('bulk-plan-view')).toBeVisible();
  expect(mock.plans[1]).toMatchObject({ action: 'copy' });
  expect(mock.plans[1].rows).toEqual([
    expect.not.objectContaining({ copy_values: expect.anything() }),
  ]);
});

test('copy without an automatic key asks for explicit new key values', async ({ page }) => {
  const mock = await mockBackend(page, { autoPk: false });
  await openTable(page);
  await page.getByRole('checkbox', { name: 'Zeile 1 auswählen' }).check();
  await page.getByTestId('bulk-copy').click();
  await page.getByRole('button', { name: 'Vorschau erstellen' }).click();
  await expect(page.getByTestId('bulk-message')).toBeVisible();
  expect(mock.plans).toHaveLength(0);
  await page.getByLabel('Neuer Schlüsselwert id (Kopie 1)').fill('100');
  await page.getByLabel('Werttyp von id (Kopie 1)').selectOption('integer');
  await page.getByRole('button', { name: 'Vorschau erstellen' }).click();
  await expect(page.getByTestId('bulk-plan-view')).toBeVisible();
  expect(mock.plans[0].rows).toMatchObject([
    { copy_values: [{ column: 'id', value: { kind: 'integer', value: '100' } }] },
  ]);
});

test('plan_conflict (spent or changed plan) is explained and nothing is repeated', async ({
  page,
}) => {
  const mock = await mockBackend(page, {
    executeStatus: 409,
    executeBody: {
      outcome: 'rejected',
      reason: 'plan_conflict',
      rows: [{ index: 0, outcome: 'rejected' }],
    },
  });
  await openTable(page);
  await page.getByRole('checkbox', { name: 'Zeile 1 auswählen' }).check();
  await page.getByTestId('bulk-delete').click();
  await page.getByRole('checkbox', { name: /Ich bestätige/ }).check();
  await page.getByTestId('bulk-typed').fill('1');
  await page.getByTestId('bulk-execute').click();
  await expect(page.getByTestId('bulk-result')).toHaveAttribute('data-outcome', 'rejected');
  await expect(page.getByTestId('bulk-reason')).toContainText(
    'Plan geändert oder bereits ausgeführt',
  );
  await expect(page.getByTestId('bulk-stale')).toBeVisible();
  expect(mock.executes).toHaveLength(1);
  await expect(page.getByTestId('bulk-execute')).toBeDisabled();
});

test('a pending bulk request locks navigation', async ({ page }) => {
  const mock = await mockBackend(page, { hangExecute: true });
  await openTable(page);
  await page.getByRole('checkbox', { name: 'Zeile 1 auswählen' }).check();
  await page.getByTestId('bulk-delete').click();
  await page.getByRole('checkbox', { name: /Ich bestätige/ }).check();
  await page.getByTestId('bulk-typed').fill('1');
  await page.getByTestId('bulk-execute').click();
  await expect.poll(() => mock.executes.length).toBe(1);
  const hash = await page.evaluate(() => location.hash);
  await page.evaluate(() => (location.hash = '#/'));
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(hash);
  await expect(page.getByTestId('navigation-blocked')).toBeVisible();
  mock.release();
});

test('outcome_unknown result: no retry, honest message', async ({ page }) => {
  const mock = await mockBackend(page, {
    executeStatus: 503,
    executeBody: {
      outcome: 'outcome_unknown',
      reason: 'outcome_unknown',
      rows: [{ index: 0, outcome: 'outcome_unknown' }],
    },
  });
  await openTable(page);
  await page.getByRole('checkbox', { name: 'Zeile 1 auswählen' }).check();
  await page.getByTestId('bulk-delete').click();
  await page.getByRole('checkbox', { name: /Ich bestätige/ }).check();
  await page.getByTestId('bulk-typed').fill('1');
  await page.getByTestId('bulk-execute').click();
  await expect(page.getByTestId('bulk-unknown')).toContainText('Nicht erneut senden');
  expect(mock.executes).toHaveLength(1);
});

test('instances without v19 keep the single row editor and say so', async ({ page }) => {
  await mockBackend(page, { noBulk: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Backend-Zugang' }).click();
  await page.getByLabel('Zugriffstoken').fill('synthetic-token');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await page.getByRole('button', { name: /items/ }).first().click();
  await expect(page.getByTestId('bulk-unavailable')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zeile hinzufügen', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Zeile 1 auswählen' }).check();
  await expect(page.getByTestId('bulk-delete')).toHaveCount(0);
});

test('file value: oversize file is stopped locally, upload sends metadata then file once, download is byte-exact', async ({
  page,
}) => {
  const mock = await mockBackend(page);
  await openTable(page);
  await page.getByRole('button', { name: 'Bearbeiten' }).first().click();
  const panel = page.getByTestId('file-value-panel');
  await expect(panel).toBeVisible();
  await page.getByTestId('file-input').setInputFiles({
    name: 'big.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(512 * 1024 + 1),
  });
  await expect(page.getByTestId('file-too-large')).toBeVisible();
  await expect(page.getByTestId('file-upload')).toBeDisabled();
  await page.getByTestId('file-input').setInputFiles({
    name: '<img src=x onerror=alert(1)>.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from([1, 2, 3]),
  });
  await expect(page.getByTestId('file-info')).toContainText('<img src=x onerror=alert(1)>.bin');
  expect(await page.locator('img[src="x"]').count()).toBe(0);
  await expect(page.getByTestId('file-upload')).toBeDisabled();
  await panel.getByRole('checkbox').check();
  await page.getByTestId('file-upload').dblclick();
  await expect(page.getByTestId('file-message')).toContainText('bestätigt');
  expect(mock.uploads).toHaveLength(1);
  expect(mock.uploads[0].fields).toEqual(['metadata', 'file']);
  await expect(page.getByTestId('file-upload')).toBeDisabled();
});

test('file value download saves the exact bytes with a harmless name', async ({ page }) => {
  const mock = await mockBackend(page);
  await openTable(page);
  await page.getByRole('button', { name: 'Bearbeiten' }).first().click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('file-download').click(),
  ]);
  expect(download.suggestedFilename()).toBe('items-raw.bin');
  const bytes = Buffer.concat((await (await download.createReadStream()).toArray()) as Buffer[]);
  expect([...bytes]).toEqual([1, 2, 3]);
  expect(mock.downloads[0]).toMatchObject({ column: 'raw' });
  expect(mock.downloads[0]).not.toHaveProperty('preview');
  await expect(page.getByTestId('file-download')).toBeEnabled();
});

test('foreign key lookup: bound search, hostile display text as text, pick fills the field', async ({
  page,
}) => {
  const mock = await mockBackend(page);
  await openTable(page);
  await page.getByRole('button', { name: 'Bearbeiten' }).first().click();
  await page.getByLabel('Angabe für owner_id', { exact: true }).selectOption('value');
  await page.getByTestId('fk-open-owner_id').click();
  await expect(page.getByTestId('fk-lookup')).toBeVisible();
  await expect(page.getByTestId('fk-choice')).toContainText(hostile);
  expect(await page.locator('[data-testid="fk-lookup"] img').count()).toBe(0);
  await page.getByTestId('fk-search').fill("x'%_!");
  await page.getByRole('button', { name: 'Suchen', exact: true }).click();
  await expect.poll(() => mock.lookups.length).toBeGreaterThan(1);
  expect(mock.lookups.at(-1)).toMatchObject({
    table: { schema: 'main', name: 'items' },
    column: 'owner_id',
    display_column: 'label',
    search: "x'%_!",
    page_size: 50,
  });
  await page.getByTestId('fk-choice').click();
  await expect(page.getByLabel('Wert für owner_id', { exact: true })).toHaveValue('42');
  await expect(page.getByTestId('fk-lookup')).toHaveCount(0);
});

test('bulk dialog and selection stay usable at 320px without horizontal scroll', async ({
  page,
}) => {
  await mockBackend(page);
  await openTable(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.getByRole('checkbox', { name: 'Zeile 2 auswählen' }).check();
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.getByTestId('bulk-delete').click();
  await expect(page.getByTestId('bulk-plan-view')).toBeVisible();
  const box = await page.getByTestId('bulk-dialog').boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  await expect(page.getByTestId('bulk-plan-view')).toContainText(hostile.slice(0, 0));
});
