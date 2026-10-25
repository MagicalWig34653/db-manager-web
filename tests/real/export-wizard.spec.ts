// SPDX-License-Identifier: AGPL-3.0-only
// Real run: the export wizard against the Go backend. Files are saved for independent checks by
// scripts/test-real-export.py (restore into a fresh database, JSON/CSV readers, row comparison).
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
interface Run {
  driver: string;
  name: string;
  format: 'SQL-Dump' | 'JSON' | 'CSV';
  tables: RegExp[];
  gzip?: boolean;
  maxRows?: string;
}
async function exportFile(page: Page, run: Run, dir: string): Promise<string | null> {
  await select(page, run.tables);
  await page.getByLabel(run.format, { exact: true }).check();
  await page.getByLabel('Mit GZip komprimieren (.gz)').setChecked(!!run.gzip);
  await page.getByTestId('max-rows').fill(run.maxRows ?? '');
  const download = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  await page.getByTestId('start').click();
  const file = await download;
  if (!file) return null;
  const path = join(dir, `${run.driver}-${run.name}-${file.suggestedFilename()}`);
  await file.saveAs(path);
  return path;
}

for (const driver of ['sqlite', 'postgresql']) {
  test(`${driver}: real export wizard downloads verified dumps and rejects a cut stream`, async ({
    page,
  }) => {
    const database = driver === 'sqlite' ? 'p11_src' : 'p11_probe';
    const dir = config.dumpDir;
    mkdirSync(dir, { recursive: true });
    const urls: string[] = [];
    page.on('request', (request) => urls.push(request.url()));
    // Headless Chromium has showSaveFilePicker but nobody to answer it: use the memory path.
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

    const both = [/odd"name$/, /t_big$/];
    const sql = await exportFile(
      page,
      { driver, name: 'sql', format: 'SQL-Dump', tables: both },
      dir,
    );
    expect(sql).not.toBeNull();
    await expect(page.getByTestId('export-done')).toBeVisible();
    const gz = await exportFile(
      page,
      { driver, name: 'sqlgz', format: 'SQL-Dump', tables: both, gzip: true },
      dir,
    );
    expect(gz).not.toBeNull();
    await expect(page.getByTestId('export-done')).toContainText('.gz');
    const json = await exportFile(
      page,
      { driver, name: 'json', format: 'JSON', tables: both },
      dir,
    );
    expect(json).not.toBeNull();
    const csv = await exportFile(
      page,
      { driver, name: 'csv', format: 'CSV', tables: [/odd"name$/] },
      dir,
    );
    expect(csv).not.toBeNull();

    // A row limit that cuts the stream: 200 OK without closing marker must be reported as faulty.
    const cut = await exportFile(
      page,
      { driver, name: 'cut', format: 'SQL-Dump', tables: [/t_big$/], maxRows: '10' },
      dir,
    );
    expect(cut).toBeNull();
    await expect(page.getByTestId('incomplete-hint')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('unvollständig');
    await expect(page.getByTestId('export-done')).toHaveCount(0);

    expect(urls.join('\n')).not.toContain(config.token);
    expect(urls.join('\n')).not.toContain(config.password);
    expect(page.url()).not.toMatch(/password|token|SELECT/i);
  });
}
