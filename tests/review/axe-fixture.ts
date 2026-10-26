// SPDX-License-Identifier: AGPL-3.0-only
// Review tooling: wraps the Playwright `page` fixture so that every browser spec runs axe-core
// (wcag2a/2aa/21aa) on its final page state and checks 320 px overflow. Needs `npm i --no-save axe-core`;
// writes JSON lines to $AXE_OUT. Used by scripts/review-axe.sh on a transformed copy of tests/browser.
import { test as base } from '@playwright/test';
import { appendFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

export * from '@playwright/test';
const axeSource = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
);
const out = process.env.AXE_OUT ?? '/dev/null';

async function scan(page: import('@playwright/test').Page, label: string, title: string) {
  try {
    await page.addScriptTag({ content: axeSource });
    const violations = await page.evaluate(async () => {
      // @ts-expect-error injected global
      const r = await window.axe.run(document, {
        runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      });
      return r.violations.map((v: any) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes
          .slice(0, 3)
          .map(
            (n: any) =>
              n.target.join(' ') +
              ' <' +
              String(n.html).slice(0, 140) +
              '> :: ' +
              (n.failureSummary ?? '').split('\n')[1],
          ),
        count: v.nodes.length,
      }));
    });
    const overflow = await page.evaluate(() => {
      if (document.documentElement.scrollWidth <= innerWidth + 1) return null;
      return Array.from(document.querySelectorAll('body *'))
        .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
        .slice(0, 4)
        .map(
          (el) =>
            el.tagName +
            '.' +
            String(el.className).slice(0, 40) +
            ' ' +
            (el.textContent ?? '').slice(0, 40),
        );
    });
    appendFileSync(out, JSON.stringify({ title, label, violations, overflow }) + '\n');
  } catch (error) {
    appendFileSync(
      out,
      JSON.stringify({ title, label, error: String(error).slice(0, 200) }) + '\n',
    );
  }
}

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    await use(page);
    if (page.isClosed()) return;
    await scan(page, 'final', testInfo.titlePath.join(' > '));
    await page.setViewportSize({ width: 320, height: 800 });
    await scan(page, '320px', testInfo.titlePath.join(' > '));
  },
});
