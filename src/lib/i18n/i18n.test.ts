// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { t } from './index';

it('resolves keys, substitutes placeholders and falls back to the key', () => {
  expect(t('shell.sqlWorkspace')).toBe('SQL-Arbeitsbereich');
  expect(t('shared.confirmTypeName', { name: 'orders' })).toBe(
    'Zur Bestätigung den Namen „orders“ eingeben',
  );
  expect(t('shell.noConnectionForDatabase')).toContain('{database}');
  expect(t('missing.key')).toBe('missing.key');
  expect(t('shell')).toBe('shell');
});
