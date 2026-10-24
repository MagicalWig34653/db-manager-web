// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import SqlTab from '$lib/shell/builtin/SqlTab.svelte';
import { collectFeatures, features, featuresFor, findTab, type FeatureDefinition } from './index';

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
  expect(features.length).toBeGreaterThanOrEqual(3);
});

it('collects glob modules, orders by order and keeps slots apart', () => {
  const list = collectFeatures({
    './p/feature.ts': {
      default: [make({ id: 'p.b', tab: 'b', order: 20 }), make({ id: 'p.a', order: 10 })],
    },
    './q/feature.ts': { default: make({ id: 'q.act', slot: 'table-action', tab: undefined }) },
  });
  expect(list.map((f) => f.id)).toEqual(['p.a', 'p.b', 'q.act']);
  expect(featuresFor('table-tab', new Set(), list)).toHaveLength(2);
  expect(featuresFor('table-action', new Set(), list)).toHaveLength(1);
});

it('marks features without the required capability as unavailable but keeps them listed', () => {
  const list = collectFeatures({
    './p/feature.ts': { default: make({ capability: 'v7.catalog' }) },
  });
  expect(findTab('table-tab', 'a', new Set(), list)?.available).toBe(false);
  expect(findTab('table-tab', 'a', new Set(['v7.catalog']), list)?.available).toBe(true);
  expect(findTab('table-tab', 'missing', new Set(), list)).toBeUndefined();
});

it('rejects duplicate ids, duplicate tabs, missing tabs and missing default exports', () => {
  const dup = { default: [make({}), make({})] };
  expect(() => collectFeatures({ './a.ts': dup })).toThrow(/Duplicate feature id/);
  const tabs = { default: [make({ id: 'x.1' }), make({ id: 'x.2' })] };
  expect(() => collectFeatures({ './a.ts': tabs })).toThrow(/Duplicate tab/);
  expect(() => collectFeatures({ './a.ts': { default: make({ tab: undefined }) } })).toThrow(
    /needs a tab/,
  );
  expect(() => collectFeatures({ './a.ts': {} })).toThrow(/no default export/);
});
