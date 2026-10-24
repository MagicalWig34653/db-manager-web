// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import SqlTab from '$lib/shell/builtin/SqlTab.svelte';
import {
  builtinFeatures,
  collectFeatures,
  featuresFor,
  findTab,
  loadFeatures,
  type FeatureDefinition,
} from './index';

const make = (over: Partial<FeatureDefinition>): FeatureDefinition => ({
  id: 'x.a',
  slot: 'table-tab',
  tab: 'a',
  titleKey: 'shell.tabSql',
  component: SqlTab,
  ...over,
});

it('registers the built-in tabs', () => {
  expect(findTab('database-tab', 'sql', new Set())?.available).toBe(true);
  expect(findTab('table-tab', 'daten', new Set())?.available).toBe(true);
  expect(findTab('server-tab', 'uebersicht', new Set())?.available).toBe(true);
  expect(builtinFeatures.length).toBeGreaterThanOrEqual(3);
});

it('collects glob modules, orders by order and keeps slots apart', () => {
  const { features: list, errors } = collectFeatures({
    './p/feature.ts': {
      default: [make({ id: 'p.b', tab: 'b', order: 20 }), make({ id: 'p.a', order: 10 })],
    },
    './q/feature.ts': { default: make({ id: 'q.act', slot: 'table-action', tab: undefined }) },
  });
  expect(errors).toEqual([]);
  expect(list.map((f) => f.id)).toEqual(['p.a', 'p.b', 'q.act']);
  expect(featuresFor('table-tab', new Set(), list)).toHaveLength(2);
  expect(featuresFor('table-action', new Set(), list)).toHaveLength(1);
});

it('marks features without the required capability as unavailable but keeps them listed', () => {
  const { features: list } = collectFeatures({
    './p/feature.ts': { default: make({ capability: 'v7.catalog' }) },
  });
  expect(findTab('table-tab', 'a', new Set(), list)?.available).toBe(false);
  expect(findTab('table-tab', 'a', new Set(['v7.catalog']), list)?.available).toBe(true);
  expect(findTab('table-tab', 'missing', new Set(), list)).toBeUndefined();
});

it('skips broken definitions and reports them instead of throwing', () => {
  const ok = make({ id: 'ok.1', tab: 'ok' });
  const result = collectFeatures(
    {
      './dup/feature.ts': {
        default: [make({ id: 'ok.1', tab: 'other' }), make({ id: 'x.2', tab: 'ok' })],
      },
      './notab/feature.ts': { default: make({ id: 'n.1', tab: undefined }) },
      './empty/feature.ts': {},
      './null/feature.ts': null,
      './good/feature.ts': { default: make({ id: 'good.1', tab: 'good' }) },
    },
    [ok],
  );
  expect(result.features.map((f) => f.id).sort()).toEqual(['good.1', 'ok.1']);
  expect(result.errors).toHaveLength(5);
  expect(result.errors.join('\n')).toMatch(/duplicate id/);
  expect(result.errors.join('\n')).toMatch(/duplicate tab/);
  expect(result.errors.join('\n')).toMatch(/needs a tab/);
  expect(result.errors.join('\n')).toMatch(/no default export/);
});

it('isolates modules that throw while loading', async () => {
  const registry = await loadFeatures({
    './bad/feature.ts': () => Promise.reject(new Error('boom')),
    './good/feature.ts': () => Promise.resolve({ default: make({ id: 'good.1', tab: 'good' }) }),
  });
  expect(registry.features.map((f) => f.id)).toContain('good.1');
  expect(registry.features.length).toBeGreaterThanOrEqual(4);
  expect(registry.errors).toHaveLength(1);
  expect(registry.errors[0]).toMatch(/bad\/feature\.ts: failed to load.*boom/);
});
