// SPDX-License-Identifier: AGPL-3.0-only
import { de, type TextKey } from './de';
export type { TextKey } from './de';

// Resolves a catalog key and substitutes {placeholders}. Unknown keys return the key itself.
export function t(
  key: TextKey | (string & {}),
  params: Record<string, string | number> = {},
): string {
  let node: unknown = de;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node)) return key;
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== 'string') return key;
  return node.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
