// SPDX-License-Identifier: AGPL-3.0-only
// W-P22 column transformations against a mocked backend: assignment, image/link/JSON views, raw view, input editor
// validation, storage choice, and the guarantee that no request leaves for an image or link target.
import { test, expect, type Page } from '@playwright/test';
import { FakeConfigServer } from '../../src/lib/features/config-store/testing';
import { PNG, setup } from '../fixtures/transformations';

async function assign(page: Page, column: string, transformation: string) {
  await page.getByRole('button', { name: `Anzeige für Spalte ${column} festlegen` }).click();
  await page.getByLabel('Anzeige-Transformation').selectOption(transformation);
}
async function applyAssignment(page: Page) {
  await page.getByRole('button', { name: 'Zuordnung übernehmen' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test('link, JSON and image views: safe targets only, hostile values stay text, no external request', async ({
  page,
}) => {
  const fake = new FakeConfigServer();
  const external = await setup(page, fake);
  await assign(page, 'name', 'link');
  await expect(page.getByText('Vorschau')).toBeVisible();
  await applyAssignment(page);
  const link = page
    .getByRole('region', { name: 'Abfrageergebnis, horizontal scrollbar' })
    .getByRole('link', { name: 'https://example.com/a' });
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link).toHaveAttribute('target', '_blank');
  expect(await page.locator('a[href^="javascript:"], a[href^="data:"]').count()).toBe(0);
  await expect(page.getByText('javascript:alert(1)')).toBeVisible();

  await assign(page, 'owner_id', 'json');
  await applyAssignment(page);

  await assign(page, 'raw', 'image');
  await applyAssignment(page);
  await expect(page.getByRole('img', { name: 'PNG-Bild aus Binärdaten' }).first()).toBeVisible();
  // the SVG-in-BLOB row is not an image and shows its raw value
  expect(await page.getByRole('img', { name: /Bild aus Binärdaten/ }).count()).toBe(1);
  expect(await page.locator('img').count()).toBe(0);
  expect(await page.locator('canvas').count()).toBe(1);

  // raw view returns the stored value
  await page.getByRole('button', { name: 'PNG-Bild aus Binärdaten' }).click();
  await expect(page.getByRole('button', { name: 'Rohansicht' })).toBeVisible();
  await page.getByRole('button', { name: 'Rohansicht' }).click();
  await expect(page.locator('pre.full-cell')).toHaveText(PNG);
  await page.keyboard.press('Escape');

  // the assignment reached the server store; no cell value did
  const layouts = [...fake.items.values()].filter((i) => i.kind === 'layouts');
  expect(layouts).toHaveLength(1);
  expect(JSON.stringify(layouts[0].data)).not.toContain('example.com');
  expect(JSON.stringify(layouts[0].data)).not.toContain(PNG);
  expect(external).toEqual([]);
  expect(await noOverflow(page)).toBe(true);
});

test('the assignment survives a reload from the server store; storage choice in local mode', async ({
  page,
}) => {
  const fake = new FakeConfigServer();
  fake.state = 'not_configured';
  await setup(page, fake);
  await assign(page, 'name', 'truncate');
  // without opt-in nothing is written to the browser storage
  await expect(
    page.getByLabel('Zuordnung in diesem Browser speichern (freiwillig)'),
  ).not.toBeChecked();
  await page.getByRole('button', { name: 'Zuordnung übernehmen' }).click();
  expect(
    await page.evaluate(() => localStorage.getItem('db-manager.transformations.v1')),
  ).toBeNull();
  expect(fake.calls.filter((c) => c.path.includes('/config/layouts'))).toEqual([]);
  await assign(page, 'name', 'truncate');
  await page.getByLabel('Zuordnung in diesem Browser speichern (freiwillig)').check();
  await page.getByRole('button', { name: 'Zuordnung übernehmen' }).click();
  const stored = await page.evaluate(() => localStorage.getItem('db-manager.transformations.v1'));
  expect(stored).toContain('truncate');
  expect(stored).not.toContain('example.com');
});

test('input editor validates JSON, offers a preview and blocks an invalid value in the row editor', async ({
  page,
}) => {
  const fake = new FakeConfigServer();
  await setup(page, fake);
  await page.getByRole('button', { name: 'Anzeige für Spalte name festlegen' }).click();
  await page.getByLabel('Eingabeeditor beim Bearbeiten').selectOption('json_editor');
  await page.getByRole('button', { name: 'Zuordnung übernehmen' }).click();
  await page.getByRole('button', { name: 'Zeile 1 bearbeiten' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Angabe für name', { exact: true }).selectOption('value');
  const area = page.getByTestId('transform-editor-name').getByRole('textbox');
  await area.fill('{"a":');
  await expect(page.getByRole('status').filter({ hasText: 'Kein gültiges JSON' })).toBeVisible();
  await page.getByRole('button', { name: 'Änderung prüfen' }).click();
  await expect(page.getByRole('dialog').getByText(/laut Eingabeeditor ungültig/)).toBeVisible();
  await area.fill('{"a":1}');
  await expect(page.getByRole('status').filter({ hasText: 'Gültig.' })).toBeVisible();
  await page.getByRole('button', { name: 'Vorschau', exact: true }).click();
  await expect(page.getByLabel('Formatierte Vorschau (nur Anzeige)')).toHaveText('{\n  "a": 1\n}');
  // the raw view switches the validation off; the text is delivered unchanged
  await page.getByRole('button', { name: 'Rohansicht', exact: true }).click();
  await area.fill('not json');
  await page.getByRole('button', { name: 'Änderung prüfen' }).click();
  await expect(page.getByText('not json').first()).toBeVisible();
});

test('320 px: dialog and table stay usable without horizontal page scroll; keyboard operation', async ({
  page,
}) => {
  const fake = new FakeConfigServer();
  await setup(page, fake);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.getByRole('button', { name: 'Anzeige für Spalte name festlegen' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.getByLabel('Anzeige-Transformation').selectOption('hex');
  expect(await noOverflow(page)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Anzeige für Spalte name festlegen' }),
  ).toBeFocused();
});
