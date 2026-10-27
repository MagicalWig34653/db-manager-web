// SPDX-License-Identifier: AGPL-3.0-only
// Independent re-review (W-P16) attack specs for the hidden-character warning and the variable dialog.
// test.fail() marks a CONFIRMED defect (assertion = correct behavior); it turns red as soon as the defect is fixed.
import { test, expect, type Page } from '@playwright/test';
import { editorText } from './editor';
import { browse, description, v2Caps } from '../../src/lib/features/bulk/testing';

async function setup(page: Page): Promise<string[]> {
  const queries: string[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === '/api/v1/capabilities')
      return json({
        contract_version: '0.1.0',
        drivers: ['sqlite'],
        credential_storage: false,
        max_rows: 10000,
        max_timeout_ms: 60000,
      });
    if (path === '/api/v1/connections/test') return json({ status: 'ok' });
    if (path === '/api/v1/catalog')
      return json({ tables: [{ name: 'items', schema: 'main', kind: 'table' }] });
    if (path === '/api/v1/query') {
      queries.push(route.request().postDataJSON().sql);
      return json({ duration_ms: 1, results: [{ columns: [], rows: [], truncated: false }] });
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
  await expect(page.locator('.cm-editor')).toBeVisible();
  return queries;
}
const box = (page: Page) => page.getByRole('textbox', { name: 'SQL-Abfrage', exact: true });
const warning = (page: Page) =>
  page.getByRole('alert').filter({ hasText: 'Unsichtbare oder umkehrende Zeichen' });
const BIDI = 'select ‮1, 2';

test('every way to run SQL with a bidi character asks first (shortcut, button, bookmark, history, variables)', async ({
  page,
}) => {
  const queries = await setup(page);
  // 1. shortcut
  await box(page).fill(BIDI);
  // The shortcut is ignored while the connection is still busy (catalog loading); retry until the warning shows.
  await expect(async () => {
    await box(page).press('ControlOrMeta+Enter');
    await expect(warning(page)).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10000 });
  expect(queries).toEqual([]);
  await warning(page).getByRole('button', { name: 'Abbrechen' }).click();
  // 2. button
  await page.getByRole('button', { name: 'Abfrage ausführen' }).click();
  await expect(warning(page)).toBeVisible();
  expect(queries).toEqual([]);
  await warning(page).getByRole('button', { name: 'Abbrechen' }).click();
  // 3. bookmark restored into the editor, then run
  await page.getByLabel('Name des Lesezeichens').fill('hostile');
  await page.getByRole('button', { name: 'Als Lesezeichen speichern' }).click();
  await box(page).fill('select 1');
  await page.getByRole('button', { name: 'In Editor übernehmen' }).first().click();
  await expect(page.locator('.cm-specialChar').first()).toBeVisible();
  await page.getByRole('button', { name: 'Abfrage ausführen' }).click();
  await expect(warning(page)).toBeVisible();
  expect(queries).toEqual([]);
  await warning(page).getByRole('button', { name: 'Abbrechen' }).click();
  // 4. variable value with a bidi character (template itself is clean)
  await box(page).fill('select :v');
  await box(page).press('ControlOrMeta+Enter');
  const dialog = page.getByRole('dialog', { name: 'Variablen ausfüllen' });
  await dialog.getByLabel('Wert für :v').fill('a‮b');
  await dialog.getByRole('button', { name: 'Ausführen', exact: true }).click();
  await expect(warning(page)).toBeVisible();
  expect(queries).toEqual([]);
  await warning(page).getByRole('button', { name: 'Abbrechen' }).click();
  // 5. "run unchanged" with a bidi template
  await box(page).fill('select ‮:v');
  await box(page).press('ControlOrMeta+Enter');
  await dialog.getByRole('button', { name: 'Unverändert ausführen' }).click();
  await expect(warning(page)).toBeVisible();
  expect(queries).toEqual([]);
  // confirmed run happens exactly once even on a double click
  await warning(page).getByRole('button', { name: 'Trotzdem ausführen' }).dblclick();
  await expect.poll(() => queries.length).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  expect(queries).toEqual(['select ‮:v']);
});

test.fail(
  'the confirmed statement is the one that was warned about, and history records what ran',
  async ({ page }) => {
    const queries = await setup(page);
    await page.getByRole('checkbox', { name: 'Verlauf speichern' }).check();
    await box(page).fill(BIDI);
    await box(page).press('ControlOrMeta+Enter');
    await expect(warning(page)).toBeVisible();
    // The editor is still editable while the warning stands; the user replaces the text.
    await box(page).fill('select 42');
    await warning(page).getByRole('button', { name: 'Trotzdem ausführen' }).click();
    await expect.poll(() => queries.length).toBe(1);
    // Correct behavior: either the stale warning is withdrawn on edit (nothing runs) or what runs is what history shows.
    const history = await page.locator('.sql-library pre').allTextContents();
    expect(history.length === 0 || history[0] === queries[0]).toBe(true);
  },
);

// Invisible characters that are identifier characters in PostgreSQL/MySQL but neither highlighted nor warned about.
for (const [name, char] of [
  ['Hangul filler U+3164', 'ㅤ'],
  ['variation selector U+FE0F', '️'],
  ['tag character U+E0041', '\u{e0041}'],
  ['braille blank U+2800', '⠀'],
] as const)
  test.fail(`${name} inside SQL is warned about before running`, async ({ page }) => {
    const queries = await setup(page);
    await box(page).fill(`select 1 as a${char}b`);
    await box(page).press('ControlOrMeta+Enter');
    await expect(warning(page)).toBeVisible({ timeout: 1500 });
    expect(queries).toEqual([]);
  });

test('negative numbers after any operator are parenthesised and never form a comment', async ({
  page,
}) => {
  const queries = await setup(page);
  await box(page).fill('select 10 -:n, 10 +:n, 10 *:n, 10 /:n, 1 <:n, 1 >:n, 1 =:n');
  await expect.poll(() => editorText(box(page))).toContain(':n, 1 =:n');
  await box(page).press('ControlOrMeta+Enter');
  const dialog = page.getByRole('dialog', { name: 'Variablen ausfüllen' });
  await dialog.getByLabel('Art des Werts für :n').selectOption('number');
  await dialog.getByLabel('Wert für :n').fill('-5');
  await dialog.getByRole('button', { name: 'Ausführen', exact: true }).click();
  await expect
    .poll(() => queries)
    .toEqual(['select 10 -(-5), 10 +(-5), 10 *(-5), 10 /(-5), 1 <(-5), 1 >(-5), 1 =(-5)']);
});
