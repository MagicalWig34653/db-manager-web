import { afterEach, expect, it } from 'vitest';
import { de } from './de';
import { en } from './en';
import { formatDate, formatNumber, lookup, setLocale, t } from './index';
function flatten(value: object, prefix = ''): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) =>
      typeof item === 'string'
        ? [[prefix + key, item]]
        : Object.entries(flatten(item, `${prefix}${key}.`)),
    ),
  );
}
afterEach(() => setLocale('de'));
it('translates every German source key and preserves all placeholder occurrences', () => {
  const source = flatten(de),
    target = flatten(en);
  expect(Object.keys(target).sort()).toEqual(Object.keys(source).sort());
  for (const [key, value] of Object.entries(source)) {
    expect(target[key].trim(), key).not.toBe('');
    expect([...target[key].matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort(), key).toEqual(
      [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort(),
    );
  }
});
it('switches language and document metadata and uses locale-aware Intl formatting', () => {
  setLocale('en');
  expect(t('shell.sqlWorkspace')).toBe('SQL workspace');
  expect(t('sql.resultTab', { n: 4 })).toBe('Result 4');
  expect(document.documentElement.lang).toBe('en');
  expect(document.documentElement.dir).toBe('ltr');
  expect(formatNumber(12345.6)).toBe('12,345.6');
  expect(formatDate(new Date(2026, 9, 26), { dateStyle: 'long' })).toBe('October 26, 2026');
  setLocale('ar');
  expect(document.documentElement.lang).toBe('de');
  expect(t('settings.title')).toBe('Einstellungen');
  expect(formatNumber(12345.6)).toBe('12.345,6');
  expect(lookup({ missing: {} }, 'missing.title')).toBeUndefined();
  expect(t('missing.key')).toBe('missing.key');
  expect(t('toString')).toBe('toString');
});
