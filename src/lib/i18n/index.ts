// SPDX-License-Identifier: AGPL-3.0-only
import { de, type TextKey } from './de';
import { en } from './en';
import { language } from './locale.svelte';
export { setLocale, formatDate, formatNumber } from './locale.svelte';
export type { TextKey } from './de';

// Resolves a catalog key and substitutes {placeholders}. Unknown keys return the key itself.
export function t(
  key: TextKey | (string & {}),
  params: Record<string, string | number> = {},
): string {
  const translated = lookup(language.locale === 'en' ? en : de, key);
  const node = translated ?? lookup(de, key);
  if (typeof node !== 'string') return key;
  return node.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function lookup(catalog: unknown, key: string): string | undefined {
  let node: unknown = catalog;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node)) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}
