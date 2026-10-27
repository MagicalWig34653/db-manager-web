// SPDX-License-Identifier: AGPL-3.0-only
// Independent review of web wave 2 (W-P12/13/17/27/28/29): adversarial acceptance against mocked backends.
// Covers what the package specs leave open: monitor auto refresh under a controlled clock (request pile-up,
// backoff, hidden page, leaving the view), a read-only inventory of every server-admin/monitor request, the write
// lock for file value uploads and for SQL import abort ("stop waiting").
import { readFileSync } from 'node:fs';
import { test, expect, type Page, type Request } from '@playwright/test';
import { browse, bulkCaps, description, v2Caps } from '../../src/lib/features/bulk/testing';
import {
  insertEligibility,
  keyOf,
  structure,
  updateEligibility,
  v3Caps,
  v4Caps,
  v5Caps,
} from '../../src/lib/features/bulk/testing';
import {
  capabilities as adminCaps,
  result as adminResult,
} from '../../src/lib/features/server-admin/testing';
import {
  capabilities as monitorCaps,
  result as monitorResult,
} from '../../src/lib/features/monitor/testing';

const v1 = {
  contract_version: '0.1.0',
  drivers: ['sqlite', 'mysql', 'postgres'],
  credential_storage: false,
  max_rows: 10000,
  max_timeout_ms: 60000,
};
const fixture = (name: string) =>
  JSON.parse(readFileSync(`src/lib/features/import/fixtures/${name}.json`, 'utf8'));

// ---------------------------------------------------------------- monitor / server administration (read-only)

interface MonitorMock {
  samples: number[];
  aborted: number;
  inflight: () => number;
  peak: () => number;
  open: () => number;
  paths: { method: string; path: string; body: unknown }[];
  mode: { sample: 'hang' | 'ok' | 'error' };
  release: () => void;
}
async function monitorBackend(page: Page): Promise<MonitorMock> {
  let release = () => {};
  let gate = new Promise<void>((resolve) => (release = resolve));
  let pending = 0;
  const mock: MonitorMock = {
    samples: [],
    aborted: 0,
    inflight: () => pending,
    peak: () => 0,
    open: () => 0,
    paths: [],
    mode: { sample: 'ok' },
    release: () => {
      release();
      gate = new Promise<void>((resolve) => (release = resolve));
    },
  };
  // Concurrency as the browser sees it: started minus (finished or failed). Aborted requests count as failed.
  let open = 0;
  let peak = 0;
  const isSample = (request: Request) => request.url().endsWith('/api/v20/monitor/sample');
  page.on('request', (request) => {
    if (!isSample(request)) return;
    open++;
    peak = Math.max(peak, open);
  });
  page.on('requestfinished', (request) => isSample(request) && open--);
  page.on('requestfailed', (request: Request) => {
    if (!isSample(request)) return;
    open--;
    mock.aborted++;
  });
  mock.peak = () => peak;
  mock.open = () => open;
  await page.route('**/api/v1/**', (route) => {
    const url = route.request().url();
    if (url.endsWith('/capabilities')) return route.fulfill({ json: v1 });
    if (url.endsWith('/connections/test')) return route.fulfill({ json: { status: 'ok' } });
    if (url.endsWith('/catalog')) return route.fulfill({ json: { tables: [] } });
    return route.fulfill({ status: 404, json: { error: { code: 'not_found', message: '' } } });
  });
  await page.route('**/api/v17/**', (route) => {
    const request = route.request();
    mock.paths.push({
      method: request.method(),
      path: new URL(request.url()).pathname,
      body: request.postData() ? JSON.parse(request.postData()!) : undefined,
    });
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/capabilities')) return route.fulfill({ json: adminCaps() });
    if (path.endsWith('/processes'))
      return route.fulfill({ json: adminResult('processes', { processes: [] }) });
    return route.fulfill({
      json: adminResult(path.endsWith('/variables') ? 'variables' : 'status', {
        values: [{ name: 'Connections', value: '1', masked: false }],
      }),
    });
  });
  await page.route('**/api/v20/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    mock.paths.push({
      method: request.method(),
      path,
      body: request.postData() ? JSON.parse(request.postData()!) : undefined,
    });
    if (path.endsWith('/capabilities')) return route.fulfill({ json: monitorCaps() });
    if (path.endsWith('/sample')) {
      mock.samples.push(Date.now());
      if (mock.samples.length > 1 && mock.mode.sample === 'hang') {
        pending++;
        try {
          await gate;
          await route.fulfill({ json: monitorResult('sample', [{ uptime: '1', questions: '1' }]) });
        } catch {
          /* aborted by the page */
        } finally {
          pending--;
        }
        return;
      }
      if (mock.mode.sample === 'error' && mock.samples.length > 1)
        return route.fulfill({
          status: 422,
          json: { error: { code: 'database_error', message: 'x' } },
        });
      return route.fulfill({
        json: monitorResult('sample', [{ uptime: '100', questions: '500' }]),
      });
    }
    return route.fulfill({ json: monitorResult('replication') });
  });
  return mock;
}
async function openServer(page: Page, tab: string) {
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
const setVisibility = (page: Page, state: 'hidden' | 'visible') =>
  page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => value === 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);

test('monitor auto refresh: a hanging answer never piles up requests, even after minutes', async ({
  page,
}) => {
  const mock = await monitorBackend(page);
  await page.clock.install();
  await openServer(page, 'monitor');
  await expect(page.getByTestId('sample-facts')).toBeVisible();
  mock.mode.sample = 'hang';
  await page.getByTestId('auto-refresh-toggle').check();
  await page.clock.runFor(10_500);
  await expect.poll(() => mock.open()).toBe(1); // the first answer is long finished; the poll request hangs
  await page.clock.runFor(5 * 60_000);
  // Never two sample requests at the same time, whatever the failure/abort handling does in between.
  expect(mock.peak()).toBe(1);
  expect(mock.open()).toBeLessThanOrEqual(1);
  const sent = mock.samples.length;
  // The user switches the refresh off: the hanging request is aborted and nothing new is sent.
  await page.getByTestId('auto-refresh-toggle').uncheck();
  await expect.poll(() => mock.aborted).toBeGreaterThan(0);
  await page.clock.runFor(5 * 60_000);
  expect(mock.samples.length).toBe(sent);
});

test('monitor auto refresh: a hidden page aborts the request and sends nothing until visible again', async ({
  page,
}) => {
  const mock = await monitorBackend(page);
  await page.clock.install();
  await openServer(page, 'monitor');
  await expect(page.getByTestId('sample-facts')).toBeVisible();
  mock.mode.sample = 'hang';
  await page.getByTestId('auto-refresh-toggle').check();
  await page.clock.runFor(10_500);
  await expect.poll(() => mock.open()).toBe(1);
  await setVisibility(page, 'hidden');
  await expect.poll(() => mock.aborted).toBeGreaterThan(0);
  const sent = mock.samples.length;
  await page.clock.runFor(10 * 60_000);
  expect(mock.samples.length).toBe(sent);
  await expect(page.getByTestId('auto-refresh-status')).toContainText('pausiert', {
    ignoreCase: true,
  });
  mock.mode.sample = 'ok';
  await setVisibility(page, 'visible');
  await expect.poll(() => mock.samples.length).toBe(sent + 1);
});

test('monitor auto refresh: failures back off exponentially and stop after the limit', async ({
  page,
}) => {
  const mock = await monitorBackend(page);
  await page.clock.install();
  await openServer(page, 'monitor');
  await expect(page.getByTestId('sample-facts')).toBeVisible();
  mock.mode.sample = 'error';
  const before = mock.samples.length;
  await page.getByTestId('auto-refresh-toggle').check();
  // Interval 10 s: failure n waits 10 s * 2^n. The next request must not come early.
  await page.clock.runFor(10_500);
  await expect.poll(() => mock.samples.length).toBe(before + 1);
  await page.clock.runFor(15_000); // < 20 s backoff
  expect(mock.samples.length).toBe(before + 1);
  await page.clock.runFor(6_000);
  await expect.poll(() => mock.samples.length).toBe(before + 2);
  await page.clock.runFor(30_000); // < 40 s
  expect(mock.samples.length).toBe(before + 2);
  await page.clock.runFor(60 * 60_000);
  // maxFailures (5): the polling is stopped for good, not retried forever.
  await expect(page.getByTestId('auto-refresh-status')).toContainText(/beendet|gestoppt/i);
  const total = mock.samples.length;
  await page.clock.runFor(60 * 60_000);
  expect(mock.samples.length).toBe(total);
  expect(total - before).toBeLessThanOrEqual(5);
});

test('monitor auto refresh: leaving the view aborts the request and stops the timer', async ({
  page,
}) => {
  const mock = await monitorBackend(page);
  await page.clock.install();
  await openServer(page, 'monitor');
  await expect(page.getByTestId('sample-facts')).toBeVisible();
  mock.mode.sample = 'hang';
  await page.getByTestId('auto-refresh-toggle').check();
  await page.clock.runFor(10_500);
  await expect.poll(() => mock.open()).toBe(1);
  await page.getByRole('tab', { name: 'Replikation' }).click();
  await expect.poll(() => mock.aborted).toBeGreaterThan(0);
  const sent = mock.samples.length;
  await page.clock.runFor(10 * 60_000);
  expect(mock.samples.length).toBe(sent);
});

test('server administration and monitor: only the documented read routes are ever called', async ({
  page,
}) => {
  const mock = await monitorBackend(page);
  await openServer(page, 'serververwaltung');
  await expect(page.getByTestId('admin-table-status')).toBeVisible();
  await page.getByRole('tab', { name: 'Variablen' }).click();
  await page.getByRole('tab', { name: 'Prozesse' }).click();
  await page.evaluate(() => (location.hash = '#/server/monitor'));
  await expect(page.getByTestId('sample-facts')).toBeVisible();
  for (const name of ['Abfrageanalyse', 'Replikation', 'Binärlogs']) {
    await page.getByRole('tab', { name }).click();
  }
  const allowed =
    /^\/api\/v17\/(capabilities|status|variables|processes)$|^\/api\/v20\/(capabilities|monitor\/(sample|analysis|advisor|replication|binary-logs|binary-events|profiling|engines))$/;
  for (const entry of mock.paths) {
    expect(entry.path).toMatch(allowed);
    expect(entry.method).toBe(entry.path.endsWith('/capabilities') ? 'GET' : 'POST');
    // No write intent in any body: no statement text, no set/kill/flush parameter.
    expect(JSON.stringify(entry.body ?? {})).not.toMatch(/"(sql|kill|flush|set|value|confirm)"/i);
  }
});

// ---------------------------------------------------------------- write lock: file value upload

async function bulkBackend(
  page: Page,
  options: { hangUpload?: boolean; hangExecute?: boolean; hangRow?: boolean } = {},
) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const uploads: number[] = [];
  const executes: number[] = [];
  const rowWrites: number[] = [];
  await page.route('**/api/**', async (route) => {
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
    if (path === '/api/v2/tables/describe') return json(description());
    if (path === '/api/v2/tables/browse') return json(browse());
    if (path === '/api/v3/capabilities') return json(v3Caps);
    if (path === '/api/v4/capabilities') return json(v4Caps);
    if (path === '/api/v3/tables/eligibility') return json(updateEligibility());
    if (path === '/api/v4/tables/insert-eligibility') return json(insertEligibility(true));
    if (path === '/api/v5/capabilities') return json(v5Caps);
    if (path === '/api/v5/tables/structure') return json(structure());
    if (path === '/api/v19/capabilities') return json(bulkCaps());
    if (path === '/api/v19/rows/plan')
      return json({
        table: { schema: 'main', name: 'items' },
        action: (body as { action: string }).action,
        row_count: 1,
        rows: [{ key: keyOf('1'), stability_sha256: '1'.repeat(64) }],
        warnings: [],
        plan_sha256: 'e'.repeat(64),
      });
    if (path === '/api/v19/rows/execute') {
      executes.push(1);
      if (options.hangExecute) await gate;
      return route
        .fulfill({
          json: { outcome: 'completed', rows: [{ index: 0, outcome: 'completed' }] },
        })
        .catch(() => {});
    }
    if (path === '/api/v3/rows/update') {
      rowWrites.push(1);
      if (options.hangRow) await gate;
      return route
        .fulfill({ status: 500, json: { error: { code: 'internal', message: 'x' } } })
        .catch(() => {});
    }
    if (path === '/api/v19/values/upload') {
      uploads.push(request.postDataBuffer()?.length ?? 0);
      if (options.hangUpload) await gate;
      return route.fulfill({ json: { outcome: 'committed', changed: true } }).catch(() => {});
    }
    void body;
    void keyOf;
    return json({ error: { code: 'not_found', message: 'x' } }, 404);
  });
  return { uploads, executes, rowWrites, release: () => release() };
}
async function openRowEditor(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Backend-Zugang' }).click();
  await page.getByLabel('Zugriffstoken').fill('synthetic-token');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /items/ }).first().click();
  await page.getByRole('button', { name: 'Bearbeiten' }).first().click();
  await expect(page.getByTestId('file-value-panel')).toBeVisible();
}

test('REVIEW: a pending file value upload locks navigation and unload, and releases afterwards', async ({
  page,
}) => {
  const mock = await bulkBackend(page, { hangUpload: true });
  await openRowEditor(page);
  await page.getByTestId('file-input').setInputFiles({
    name: 'v.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from([1, 2, 3]),
  });
  await page.getByTestId('file-value-panel').getByRole('checkbox').check();
  await page.getByTestId('file-upload').click();
  await expect.poll(() => mock.uploads.length).toBe(1);
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
  mock.release();
  await expect(page.getByTestId('file-message')).toContainText('bestätigt');
  expect(
    await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(false);
});

// ---------------------------------------------------------------- write lock: SQL import "stop waiting"

test('REVIEW: SQL import - cancelling an open upload releases the write lock and never repeats the request', async ({
  page,
}) => {
  const executes: number[] = [];
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === '/api/v1/capabilities') return json(v1);
    if (path === '/api/v1/connections/test') return json({ status: 'ok' });
    if (path === '/api/v1/catalog') return json({ tables: [] });
    if (path === '/api/v18/capabilities') return json(fixture('ImportCapabilities.real-http'));
    if (path === '/api/v18/imports/execute') {
      executes.push(1);
      await gate;
      return route.abort().catch(() => {});
    }
    return json({ error: { code: 'not_found', message: 'x' } }, 404);
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Arbeitsbereich' })
    .getByRole('button', { name: 'Import', exact: true })
    .click();
  await page.getByTestId('import-file').setInputFiles({
    name: 'dump.sql',
    mimeType: 'text/plain',
    buffer: Buffer.from('DELETE FROM t;'),
  });
  await page.getByTestId('import-sql-start').click();
  await page.getByRole('dialog').getByRole('textbox').fill('dump.sql');
  await page.getByRole('button', { name: 'SQL jetzt ausführen' }).click();
  await expect.poll(() => executes.length).toBe(1);
  // While the request is open: lock.
  await page.evaluate(() => (location.hash = '#/'));
  await expect(page.getByTestId('navigation-blocked')).toBeVisible();
  await page.getByTestId('import-cancel').click();
  // The cancel of an upload is reported as settled (nothing can have started): no stuck lock, no unload prompt.
  await expect(page.getByRole('status').filter({ hasText: 'Upload abgebrochen' })).toBeVisible();
  expect(executes).toHaveLength(1);
  expect(
    await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(false);
  await page.evaluate(() => (location.hash = '#/'));
  await expect(page.getByTestId('navigation-blocked')).toHaveCount(0);
  release();
});

test('REVIEW F-1: closing the bulk dialog (Escape) while the execute request is in flight keeps the write lock', async ({
  page,
}) => {
  const mock = await bulkBackend(page, { hangExecute: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Backend-Zugang' }).click();
  await page.getByLabel('Zugriffstoken').fill('synthetic-token');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /items/ }).first().click();
  await page.getByRole('checkbox', { name: 'Zeile 1 auswählen' }).check();
  await page.getByTestId('bulk-delete').click();
  await page.getByRole('checkbox', { name: /Ich bestätige/ }).check();
  await page.getByTestId('bulk-typed').fill('1');
  await page.getByTestId('bulk-execute').click();
  await expect.poll(() => mock.executes.length).toBe(1);
  await page.keyboard.press('Escape');
  // The request is still open: unload must stay guarded and navigation blocked until it settled.
  expect(
    await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
  mock.release();
});

test('REVIEW: discarding the row editor while a file value upload is open does not drop the lock silently', async ({
  page,
}) => {
  const mock = await bulkBackend(page, { hangUpload: true });
  await openRowEditor(page);
  await page.getByTestId('file-input').setInputFiles({
    name: 'v.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from([1, 2, 3]),
  });
  await page.getByTestId('file-value-panel').getByRole('checkbox').check();
  await page.getByTestId('file-upload').click();
  await expect.poll(() => mock.uploads.length).toBe(1);
  const discard = page.getByRole('button', { name: 'Verwerfen' });
  if (await discard.isEnabled().catch(() => false)) {
    await discard.click();
    // Either the lock is still held, or the user was told that the outcome is unknown.
    const locked = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    const notice = await page.locator('.global-write-notice').count();
    expect(locked || notice > 0).toBe(true);
  }
  mock.release();
});

const unloadGuarded = (page: Page) =>
  page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });

test('REVIEW F-1 (all writers): the row editor cannot be dismissed while its write request is open', async ({
  page,
}) => {
  const mock = await bulkBackend(page, { hangRow: true });
  await openRowEditor(page);
  await page.getByLabel('Angabe für name').selectOption('value');
  await page.getByLabel('Wert für name').fill('changed');
  await page.getByRole('button', { name: 'Änderung prüfen' }).click();
  await page.getByRole('checkbox', { name: /Ich bestätige/ }).check();
  await page.getByRole('button', { name: 'Änderung verbindlich speichern' }).click();
  await expect.poll(() => mock.rowWrites.length).toBe(1);
  // Escape, the close icon and a click outside must all leave the dialog open and the lock held.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await unloadGuarded(page)).toBe(true);
  expect(mock.rowWrites.length).toBe(1);
  mock.release();
  // After the answer the lock is released and the dialog can be closed again.
  await expect.poll(() => unloadGuarded(page)).toBe(false);
});

test('REVIEW F-1 (all writers): the bulk dialog also ignores the close icon and a click outside while executing', async ({
  page,
}) => {
  const mock = await bulkBackend(page, { hangExecute: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Backend-Zugang' }).click();
  await page.getByLabel('Zugriffstoken').fill('synthetic-token');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /items/ }).first().click();
  await page.getByRole('checkbox', { name: 'Zeile 1 auswählen' }).check();
  await page.getByTestId('bulk-delete').click();
  await page.getByRole('checkbox', { name: /Ich bestätige/ }).check();
  await page.getByTestId('bulk-typed').fill('1');
  await page.getByTestId('bulk-execute').click();
  await expect.poll(() => mock.executes.length).toBe(1);
  await page.getByRole('button', { name: 'Schließen', exact: true }).click();
  await page.mouse.click(2, 2);
  await expect(page.getByTestId('bulk-dialog')).toBeVisible();
  expect(await unloadGuarded(page)).toBe(true);
  mock.release();
  await expect(page.getByTestId('bulk-close')).toBeVisible();
  expect(await unloadGuarded(page)).toBe(false);
  await page.getByTestId('bulk-close').click();
  await expect(page.getByTestId('bulk-dialog')).toBeHidden();
});

test('opening a table reads no structure; the foreign key read happens once when an editor opens', async ({
  page,
}) => {
  await bulkBackend(page);
  let structureReads = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/v5/tables/structure')) structureReads++;
  });
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
  await page.waitForLoadState('networkidle');
  expect(structureReads).toBe(0);
  await page.getByRole('button', { name: 'Bearbeiten' }).first().click();
  await expect(page.getByTestId('file-value-panel')).toBeVisible();
  await expect.poll(() => structureReads).toBe(1);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Bearbeiten' }).first().click();
  await expect(page.getByTestId('file-value-panel')).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(structureReads).toBe(1);
});
