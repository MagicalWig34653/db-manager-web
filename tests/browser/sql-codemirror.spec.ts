// SPDX-License-Identifier: AGPL-3.0-only
// W-P16 CodeMirror 6 editor against a mocked backend: highlighting, search/replace, keyboard, completion,
// formatting, bookmark variables, write lock and the textarea fallback.
import { test, expect, type Page } from '@playwright/test';
import { editorText } from './editor';
import { browse, description, v2Caps } from '../../src/lib/features/bulk/testing';

interface Seen {
  queries: string[];
}
async function setup(page: Page, options: { slow?: boolean } = {}): Promise<Seen> {
  const seen: Seen = { queries: [] };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === '/api/v1/capabilities')
      return json({
        contract_version: '0.1.0',
        drivers: ['sqlite', 'mysql', 'postgres'],
        credential_storage: false,
        max_rows: 10000,
        max_timeout_ms: 60000,
      });
    if (path === '/api/v1/connections/test') return json({ status: 'ok' });
    if (path === '/api/v1/catalog')
      return json({
        tables: [
          { name: 'items', schema: 'main', kind: 'table' },
          { name: 'customers', schema: 'main', kind: 'table' },
        ],
      });
    if (path === '/api/v1/query') {
      seen.queries.push(request.postDataJSON().sql);
      if (options.slow) await new Promise((resolve) => setTimeout(resolve, 1500));
      return route
        .fulfill({
          json: { duration_ms: 1, results: [{ columns: [], rows: [], truncated: false }] },
        })
        .catch(() => {});
    }
    if (path === '/api/v2/capabilities') return json(v2Caps);
    if (path === '/api/v2/tables/describe') return json(description());
    if (path === '/api/v2/tables/browse') return json(browse());
    return json({ error: { code: 'not_found', message: 'x' } }, 404);
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Verlauf speichern' })).toBeVisible();
  return seen;
}
const box = (page: Page) => page.getByRole('textbox', { name: 'SQL-Abfrage', exact: true });
const text = (page: Page) => editorText(box(page));

test('CodeMirror loads lazily with syntax colors, line numbers, brackets and find/replace', async ({
  page,
}) => {
  await setup(page);
  await expect(page.locator('.cm-editor')).toBeVisible();
  await expect(page.locator('#sql-editor')).toHaveAttribute('role', 'textbox');
  await box(page).fill('select name, 42 from items -- note');
  const colors = await page
    .locator('.cm-line span')
    .evaluateAll((spans) => spans.map((span) => getComputedStyle(span).color));
  expect(new Set(colors).size).toBeGreaterThan(2);
  await expect(page.locator('.cm-lineNumbers')).toBeVisible();
  await box(page).fill('');
  await box(page).pressSequentially('count(');
  await expect.poll(() => text(page)).toBe('count()');
  // Find and replace through the toolbar button and the keyboard.
  await box(page).fill('select 1, 1');
  await page.getByRole('button', { name: 'Suchen und ersetzen' }).click();
  const panel = page.locator('.cm-search');
  await expect(panel).toBeVisible();
  await panel.getByRole('textbox', { name: 'Suchen' }).fill('1');
  await panel.getByRole('textbox', { name: 'Ersetzen' }).fill('2');
  await panel.getByRole('button', { name: 'Alle ersetzen' }).click();
  await expect.poll(() => text(page)).toBe('select 2, 2');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await box(page).press('ControlOrMeta+f');
  await expect(panel).toBeVisible();
});

test('Tab indents, Escape then Tab leaves the editor (no keyboard trap)', async ({ page }) => {
  await setup(page);
  await expect(page.locator('.cm-editor')).toBeVisible();
  await box(page).fill('select 1');
  await box(page).press('Home');
  await box(page).press('Tab');
  await expect.poll(() => text(page)).toBe('  select 1');
  await expect(page.getByText(/Escape, dann Tab verlässt den Editor/)).toBeVisible();
  await box(page).press('Escape');
  await expect(
    page.getByRole('status').filter({ hasText: 'Tab verlässt jetzt den Editor' }),
  ).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(box(page)).not.toBeFocused();
  await expect.poll(() => text(page)).toBe('  select 1');
});

test('Ctrl+Enter still runs the query and does not insert a line', async ({ page }) => {
  const seen = await setup(page);
  await expect(page.locator('.cm-editor')).toBeVisible();
  await box(page).fill('select 7');
  await box(page).press('ControlOrMeta+Enter');
  await expect.poll(() => seen.queries).toEqual(['select 7']);
  await expect.poll(() => text(page)).toBe('select 7');
});

test('completion offers catalog tables and columns of tables that were already opened', async ({
  page,
}) => {
  await setup(page);
  await expect(page.locator('.cm-editor')).toBeVisible();
  await box(page).pressSequentially('select * from cus');
  const list = page.getByRole('listbox');
  await expect(list.getByRole('option', { name: /customers/ })).toBeVisible();
  await page.keyboard.press('Escape');
  // Open the table once: its columns are then known for completion without any extra request.
  await box(page).fill('');
  const requests: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await page.getByRole('button', { name: 'items' }).click();
  await expect(
    page.getByRole('region', { name: 'Tabellenarbeitsplatz', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Tabelleninformationen werden geladen')).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Arbeitsbereich' })
    .getByRole('button', { name: 'SQL', exact: true })
    .click();
  await expect(page.locator('.cm-editor')).toBeVisible();
  requests.length = 0;
  await box(page).pressSequentially('select * from items where owner_i');
  await expect(page.getByRole('listbox').getByRole('option', { name: /owner_id/ })).toBeVisible();
  await box(page).pressSequentially('d');
  expect(requests.filter((path) => path.includes('/api/'))).toEqual([]);
});

test('format button restyles whitespace only, can be undone and refuses unsafe text', async ({
  page,
}) => {
  await setup(page);
  await expect(page.locator('.cm-editor')).toBeVisible();
  await box(page).fill("select a,b from t where x='a  b' and y=1");
  await page.getByRole('button', { name: 'Formatieren', exact: true }).click();
  await expect
    .poll(() => text(page))
    .toBe("select\n  a,\n  b\nfrom t\nwhere x = 'a  b'\n  and y = 1");
  await box(page).press('ControlOrMeta+z');
  await expect.poll(() => text(page)).toBe("select a,b from t where x='a  b' and y=1");
  await box(page).fill("select 'open");
  await page.getByRole('button', { name: 'Formatieren', exact: true }).click();
  await expect(page.getByText(/Nicht formatiert/)).toBeVisible();
  await expect.poll(() => text(page)).toBe("select 'open");
});

test('bookmark variables are replaced as text in the browser only, with a visible warning', async ({
  page,
}) => {
  const seen = await setup(page);
  await expect(page.locator('.cm-editor')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Verlauf speichern' }).check();
  await box(page).fill('select * from items where name = :name and id > :id');
  await box(page).press('ControlOrMeta+Enter');
  const dialog = page.getByRole('dialog', { name: 'Variablen ausfüllen' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Reine Textersetzung im Browser/)).toBeVisible();
  expect(seen.queries).toEqual([]);
  await dialog.getByLabel('Wert für :name').fill("o'neil");
  await dialog.getByLabel('Art des Werts für :id').selectOption('number');
  await dialog.getByLabel('Wert für :id').fill('5; drop table items');
  await expect(dialog.getByRole('alert')).toContainText('keine Zahl');
  await expect(dialog.getByRole('button', { name: 'Ausführen', exact: true })).toBeDisabled();
  await dialog.getByLabel('Wert für :id').fill('5');
  await expect(dialog.locator('pre')).toHaveText(
    "select * from items where name = 'o''neil' and id > 5",
  );
  await dialog.getByRole('button', { name: 'Ausführen', exact: true }).click();
  await expect
    .poll(() => seen.queries)
    .toEqual(["select * from items where name = 'o''neil' and id > 5"]);
  await expect.poll(() => text(page)).toBe('select * from items where name = :name and id > :id');
  // History keeps the template, never the entered values.
  await expect(page.locator('.sql-library pre').first()).toHaveText(
    'select * from items where name = :name and id > :id',
  );
  // Cancel runs nothing; "unchanged" sends the text as written.
  await page.getByRole('button', { name: 'Abfrage ausführen' }).click();
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(dialog).toHaveCount(0);
  expect(seen.queries).toHaveLength(1);
  await page.getByRole('button', { name: 'Abfrage ausführen' }).click();
  await dialog.getByRole('button', { name: 'Unverändert ausführen' }).click();
  await expect.poll(() => seen.queries.length).toBe(2);
  expect(seen.queries[1]).toBe('select * from items where name = :name and id > :id');
});

test('the editor is read-only while a query runs (write lock unchanged) and fits 320 px', async ({
  page,
}) => {
  await setup(page, { slow: true });
  await expect(page.locator('.cm-editor')).toBeVisible();
  await box(page).fill('update items set name = 1');
  await box(page).press('ControlOrMeta+Enter');
  await expect(page.getByRole('button', { name: 'Abbrechen' })).toBeVisible();
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
  await expect(page.getByRole('button', { name: 'Formatieren', exact: true })).toBeDisabled();
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true');
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('when the editor chunk cannot be loaded a plain textarea keeps SQL usable', async ({
  page,
}) => {
  await page.route(/sql-editor\/cm(\.ts)?(\?.*)?$|assets\/cm-.*\.js/, (route) => route.abort());
  const seen = await setup(page);
  const area = page.locator('textarea#sql-editor');
  await expect(area).toBeVisible();
  await area.fill('select 5');
  await area.press('Control+Enter');
  await expect.poll(() => seen.queries).toEqual(['select 5']);
  await expect(page.locator('.cm-editor')).toHaveCount(0);
});

test('hidden and bidi characters ask for confirmation before the query runs', async ({ page }) => {
  const seen = await setup(page);
  await expect(page.locator('.cm-editor')).toBeVisible();
  await box(page).fill('select \u202e1, 2');
  await expect(page.locator('.cm-specialChar').first()).toBeVisible();
  await box(page).press('ControlOrMeta+Enter');
  const alert = page.getByRole('alert').filter({ hasText: 'Unsichtbare oder umkehrende Zeichen' });
  await expect(alert).toBeVisible();
  expect(seen.queries).toEqual([]);
  await alert.getByRole('button', { name: 'Abbrechen' }).click();
  expect(seen.queries).toEqual([]);
  await box(page).press('ControlOrMeta+Enter');
  await alert.getByRole('button', { name: 'Trotzdem ausführen' }).click();
  await expect.poll(() => seen.queries).toEqual(['select \u202e1, 2']);
});

test('suggestion list stays usable at 320 px and is not a scroll container', async ({ page }) => {
  await setup(page);
  await expect(page.getByRole('button', { name: /customers/ })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 700 });
  await box(page).pressSequentially('select * from cus');
  const option = page.getByRole('listbox').getByRole('option', { name: /customers/ });
  await expect(option).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
