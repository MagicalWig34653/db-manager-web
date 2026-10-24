// SPDX-License-Identifier: AGPL-3.0-only
// Feature registry. Packages add src/lib/features/<name>/feature.ts (default export: one
// FeatureDefinition or an array); this file discovers them via import.meta.glob. Nobody
// maintains a manual list.
import type { Component } from 'svelte';
import type { WritePhase } from '$lib/rows';
import type { CatalogObject, ConnectionDraft } from '$lib/workbench';
import SqlTab from '$lib/shell/builtin/SqlTab.svelte';
import TableTab from '$lib/shell/builtin/TableTab.svelte';
import ServerOverviewTab from '$lib/shell/builtin/ServerOverviewTab.svelte';

/** Where a feature is mounted. */
export type FeatureSlot = 'server-tab' | 'database-tab' | 'table-tab' | 'table-action';

/** Props every feature component receives from the shell. */
export interface FeatureProps {
  connection: ConnectionDraft | null;
  token: string;
  database?: string;
  object?: CatalogObject;
  tab: string;
  onsql: () => void;
  onwritephase: (phase: WritePhase) => void;
}

export interface FeatureDefinition {
  /** Unique id, conventionally "<package>.<name>". */
  id: string;
  slot: FeatureSlot;
  /** Route segment of the tab; required for the *-tab slots, unique per slot. */
  tab?: string;
  /** Key in the text catalog (src/lib/i18n/de.ts). */
  titleKey: string;
  /** Capability key that must be offered by the connection; absent means always available. */
  capability?: string;
  order?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: Component<any>;
}

export interface ResolvedFeature {
  feature: FeatureDefinition;
  available: boolean;
}

const builtin: FeatureDefinition[] = [
  {
    id: 'shell.server-overview',
    slot: 'server-tab',
    tab: 'uebersicht',
    titleKey: 'server.overviewTitle',
    order: 0,
    component: ServerOverviewTab,
  },
  {
    id: 'shell.sql',
    slot: 'database-tab',
    tab: 'sql',
    titleKey: 'shell.tabSql',
    order: 0,
    component: SqlTab,
  },
  {
    id: 'shell.table',
    slot: 'table-tab',
    tab: 'daten',
    titleKey: 'shell.tabTable',
    order: 0,
    component: TableTab,
  },
];

const tabSlots: ReadonlySet<FeatureSlot> = new Set(['server-tab', 'database-tab', 'table-tab']);

/** Validates, de-duplicates and orders feature definitions. Throws on a malformed definition. */
export function collectFeatures(
  modules: Record<string, unknown>,
  base: FeatureDefinition[] = [],
): FeatureDefinition[] {
  const all: FeatureDefinition[] = [...base];
  for (const [path, module] of Object.entries(modules)) {
    const value = (module as { default?: FeatureDefinition | FeatureDefinition[] }).default;
    if (!value) throw new Error(`Feature module ${path} has no default export.`);
    all.push(...(Array.isArray(value) ? value : [value]));
  }
  const ids = new Set<string>();
  const tabs = new Set<string>();
  for (const feature of all) {
    if (!feature.id || !feature.component || !feature.titleKey)
      throw new Error(`Feature ${feature.id || '(without id)'} is incomplete.`);
    if (ids.has(feature.id)) throw new Error(`Duplicate feature id ${feature.id}.`);
    ids.add(feature.id);
    if (tabSlots.has(feature.slot)) {
      if (!feature.tab) throw new Error(`Feature ${feature.id} needs a tab id.`);
      const key = `${feature.slot}/${feature.tab}`;
      if (tabs.has(key)) throw new Error(`Duplicate tab ${key}.`);
      tabs.add(key);
    }
  }
  return all.sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id));
}

/** Features of one slot; entries whose capability is missing stay listed as unavailable. */
export function featuresFor(
  slot: FeatureSlot,
  capabilities: ReadonlySet<string>,
  list: FeatureDefinition[] = features,
): ResolvedFeature[] {
  return list
    .filter((feature) => feature.slot === slot)
    .map((feature) => ({
      feature,
      available: !feature.capability || capabilities.has(feature.capability),
    }));
}

export function findTab(
  slot: FeatureSlot,
  tab: string,
  capabilities: ReadonlySet<string>,
  list: FeatureDefinition[] = features,
): ResolvedFeature | undefined {
  return featuresFor(slot, capabilities, list).find((entry) => entry.feature.tab === tab);
}

export const features: FeatureDefinition[] = collectFeatures(
  import.meta.glob('./*/feature.ts', { eager: true }),
  builtin,
);
