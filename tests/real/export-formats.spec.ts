// SPDX-License-Identifier: AGPL-3.0-only
// Real run: the extended export formats (API 0.21) through the wizard against the Go backend. The files are
// saved for independent checks by scripts/test-real-export-formats.py (ElementTree, PyYAML, php, entities).
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const config = JSON.parse(readFileSync(process.env.DBM_REAL_CONFIG!, 'utf8'));

async function select(page: Page, wanted: RegExp[]) {
  const boxes = page.locator('.table-pick input[type=checkbox]');
  for (let i = 0; i < (await boxes.count()); i++) {
    const label = (await boxes.nth(i).locator('xpath=..').innerText()).trim();
    await boxes.nth(i).setChecked(wanted.some((re) => re.test(label)));
  }
}
const FORMATS: [string, string][] = [
  ['xml', 'XML'],
  ['yaml', 'YAML'],
  ['php', 'PHP-Array'],
  ['latex', 'LaTeX (tabular)'],
  ['latexlongtable', 'LaTeX (longtable)'],
  ['mediawiki', 'MediaWiki-Tabelle'],
  ['texy', 'Texy-Tabelle'],
  ['codegen', 'CodeGen-Text (JSON-Zeilen)'],
];

for (const driver of ['sqlite', 'postgresql']) {
  test(`${driver}: real extended formats download only after the verified closing structure`, async ({
    page,
  }) => {
    const database = driver === 'sqlite' ? 'w4_exp' : 'w4_probe';
    const dir = config.dumpDir;
    mkdirSync(dir, { recursive: true });
    const urls: string[] = [];
    page.on('request', (request) => urls.push(request.url()));
    await page.addInitScript(() => {
      delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Backend-Zugang' }).click();
    await page.getByLabel('Zugriffstoken').fill(config.token);
    await page.getByRole('button', { name: 'Übernehmen' }).click();
    await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
    if (driver === 'postgresql') await page.getByRole('button', { name: 'PostgreSQL' }).click();
    await page.getByLabel('Datenbank', { exact: true }).fill(database);
    if (driver === 'postgresql') {
      await page.getByLabel('Host', { exact: true }).fill('localhost');
      await page.getByLabel('Port', { exact: true }).fill(String(config.postgresPort));
      await page.getByLabel('Benutzername').fill('postgres');
      await page.getByLabel('Passwort', { exact: true }).fill(config.password);
    }
    await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
    await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /t_big$/ })).toBeVisible();

    await page.goto(`/#/db/${database}/export`);
    await expect(page.getByTestId('export-panel')).toBeVisible();
    await expect(page.getByTestId('driver-reason')).toBeVisible();
    await expect(page.getByTestId('text-formats')).toBeVisible();

    for (const [key, label] of FORMATS) {
      await select(page, [/odd"name$/]);
      await page.getByLabel(label, { exact: true }).check();
      const download = page.waitForEvent('download', { timeout: 15000 });
      await page.getByTestId('start').click();
      const file = await download;
      await file.saveAs(join(dir, `${driver}-${key}-${file.suggestedFilename()}`));
      await expect(page.getByTestId('export-done')).toBeVisible();
    }

    // Excel-CSV: semicolon profile with the apostrophe formula guard, verified by the control record.
    await select(page, [/odd"name$/]);
    await page.getByLabel('Excel-CSV', { exact: true }).check();
    const csv = page.waitForEvent('download', { timeout: 15000 });
    await page.getByTestId('start').click();
    await (await csv).saveAs(join(dir, `${driver}-excelcsv-export.csv`));
    await expect(page.getByTestId('export-done')).toBeVisible();

    // A row limit cuts the stream: 200 OK without the format's closing structure is reported as faulty.
    await select(page, [/t_big$/]);
    await page.getByLabel('XML', { exact: true }).check();
    await page.getByTestId('max-rows').fill('10');
    let downloaded = false;
    page.on('download', () => (downloaded = true));
    await page.getByTestId('start').click();
    await expect(page.getByTestId('incomplete-hint')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('unvollständig');
    await expect(page.getByTestId('export-done')).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(downloaded).toBe(false);

    expect(urls.some((url) => url.endsWith('/api/v21/export'))).toBe(true);
    expect(urls.join('\n')).not.toContain(config.token);
    expect(urls.join('\n')).not.toContain(config.password);
    expect(page.url()).not.toMatch(/password|token|SELECT/i);
  });
}
