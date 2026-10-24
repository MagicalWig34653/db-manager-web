// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window {
    cspViolations: string[];
    marker?: string;
  }
}

async function ready(page: Page) {
  await page.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) =>
      window.cspViolations.push(event.violatedDirective),
    );
  });
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // First load is claimed by the worker; reload so the page is controlled like on every later visit.
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
}

test('manifest is valid and the app meets the installability criteria', async ({ page }) => {
  await ready(page);
  const session = await page.context().newCDPSession(page);
  const { url, data, errors } = await session.send('Page.getAppManifest');
  expect(errors).toEqual([]);
  expect(url).toMatch(/manifest\.webmanifest$/);
  const manifest = JSON.parse(data!);
  expect(manifest).toMatchObject({
    name: 'DB Manager',
    lang: 'de',
    display: 'standalone',
    start_url: './',
    scope: './',
  });
  const sizes = manifest.icons.map((icon: { sizes: string; purpose: string }) => icon.sizes);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(manifest.icons.some((icon: { purpose: string }) => icon.purpose === 'maskable')).toBe(
    true,
  );
  const result = await session.send('Page.getInstallabilityErrors');
  expect(result.installabilityErrors).toEqual([]);
  for (const icon of manifest.icons) {
    const response = await page.request.get('/' + icon.src);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe(icon.type);
  }
  expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
});

test('worker is active with whole-origin scope and keeps only shell files in its cache', async ({
  page,
}) => {
  await ready(page);
  const state = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const names = await caches.keys();
    const keys: string[] = [];
    for (const name of names) {
      for (const request of await (await caches.open(name)).keys()) {
        keys.push(new URL(request.url).pathname);
      }
    }
    return { scope: registration.scope, active: registration.active?.state, names, keys };
  });
  expect(state.active).toBe('activated');
  expect(state.scope).toBe('http://127.0.0.1:4181/');
  expect(state.names).toHaveLength(1);
  expect(state.names[0]).toMatch(/^db-manager-shell-/);
  expect(state.keys).toContain('/index.html');
  expect(state.keys.some((path) => /\/(api|healthz|readyz)/.test(path))).toBe(false);
  expect(
    state.keys.every((path) => /^\/(assets\/|[\w.-]+\.(html|png|svg|webmanifest))/.test(path)),
  ).toBe(true);
});

test('shell starts offline with the connection hint', async ({ page, context }) => {
  await ready(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#app > *').first()).toBeAttached();
  await expect(page.getByText('Keine Verbindung zum Server')).toBeVisible();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText('Keine Verbindung zum Server')).toBeHidden();
});

test('API answers are never served from the worker or the cache', async ({ page, context }) => {
  await ready(page);
  const call = (token: string) =>
    page.evaluate(async (bearer) => {
      const response = await fetch('/api/echo', { headers: { Authorization: `Bearer ${bearer}` } });
      return response.json();
    }, token);
  const first = await call('token-one');
  const second = await call('token-two');
  expect(first.authorization).toBe('Bearer token-one');
  expect(second.authorization).toBe('Bearer token-two');
  expect(second.call).toBeGreaterThan(first.call);
  // Same request without header and a health probe also reach the network every time.
  const plain = () =>
    page.evaluate(async () => (await (await fetch('/api/echo')).json()) as { call: number });
  const a = await plain();
  const b = await plain();
  expect(b.call).toBeGreaterThan(a.call);
  await context.setOffline(true);
  const offline = await page.evaluate(async () => {
    try {
      await fetch('/api/echo');
      return 'answered';
    } catch {
      return 'network-error';
    }
  });
  expect(offline).toBe('network-error');
  await context.setOffline(false);
  expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
});

test('a new release is announced and applied only after the user accepts', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    window.marker = 'old-page';
  });
  const bump = await page.request.post('/__test/release');
  expect(bump.status()).toBe(204);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
  });
  const notice = page.getByText('Eine neue Version ist verfügbar.');
  await expect(notice).toBeVisible();
  // Nothing was applied without a click.
  expect(await page.evaluate(() => window.marker)).toBe('old-page');
  expect(await page.evaluate(async () => !!(await navigator.serviceWorker.ready).waiting)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Neue Version laden' }).click();
  await page.waitForEvent('framenavigated');
  await page.waitForLoadState('load');
  expect(await page.evaluate(() => window.marker)).toBeUndefined();
  await expect(page.locator('#app > *').first()).toBeAttached();
  expect(await page.evaluate(async () => !!(await navigator.serviceWorker.ready).waiting)).toBe(
    false,
  );
});
