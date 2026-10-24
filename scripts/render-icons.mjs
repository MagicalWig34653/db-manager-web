// SPDX-License-Identifier: AGPL-3.0-only
// Renders the PNG icons in public/ from the vector glyph of public/icon.svg (derived from the
// project icon of the main repository). Run manually after the glyph changes: node scripts/render-icons.mjs
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const glyph = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8').match(
  /<g[\s\S]*<\/g>/,
)[0];
const green = '#196653';
// Full-bleed variant: no rounded corners, glyph scaled into the maskable safe zone.
const bleed = (scale) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="${green}"/><g transform="translate(20 20) scale(${scale}) translate(-20 -20)">${glyph}</g></svg>`;
const rounded = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8');

const targets = [
  ['icon-192.png', 192, rounded, true],
  ['icon-512.png', 512, rounded, true],
  ['icon-maskable-512.png', 512, bleed(0.7), false],
  ['apple-touch-icon.png', 180, bleed(0.8), false],
  ['favicon-32.png', 32, rounded, true],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, svg, transparent] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  const png = await page.screenshot({ omitBackground: transparent, type: 'png' });
  writeFileSync(new URL(`../public/${name}`, import.meta.url), png);
}
await browser.close();
