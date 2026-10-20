// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');
test('visible source and original license links match the production commit and preserve focus', async ({
  page,
}) => {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const origins = new Set<string>();
  page.on('request', (request) => origins.add(new URL(request.url()).origin));
  await page.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) =>
      window.cspViolations.push(event.violatedDirective),
    );
  });
  await page.route('**/', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        'content-security-policy':
          "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; connect-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    });
  });
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Quellcode & Lizenzen', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Quellcode & Lizenzen' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Web-Quellcode dieses Builds' })).toHaveAttribute(
    'href',
    `https://github.com/MagicalWig34653/db-manager-web/tree/${commit}`,
  );
  for (const link of await dialog.getByRole('link').all()) {
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
  for (const [route, file] of [
    ['/LICENSE.txt', 'LICENSE'],
    ['/THIRD-PARTY-NOTICES.txt', 'src/third-party-notices.txt'],
  ]) {
    const response = await page.request.get(route);
    expect(response.status()).toBe(200);
    expect(sha(await response.body())).toBe(sha(readFileSync(file)));
  }
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
  expect([...origins]).toEqual(['http://127.0.0.1:4180']);
});
