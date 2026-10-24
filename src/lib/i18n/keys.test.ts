// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { de } from './de';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(svelte|ts)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}
function exists(key: string): boolean {
  let node: unknown = de;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string';
}

it('every text key used in src exists in the catalog', () => {
  const missing: string[] = [];
  for (const file of sources('src')) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\bt\(\s*'([a-zA-Z][\w]*(?:\.[\w]+)+)'/g))
      if (!exists(match[1])) missing.push(`${file}: ${match[1]}`);
    for (const match of text.matchAll(/titleKey:\s*'([\w.]+)'/g))
      if (!exists(match[1])) missing.push(`${file}: ${match[1]}`);
  }
  expect(missing).toEqual([]);
});
