// SPDX-License-Identifier: AGPL-3.0-only
// Feature registry. Packages add src/lib/features/<name>/feature.ts (default export: one
// FeatureDefinition or an array); this file discovers them via import.meta.glob. Nobody
// maintains a manual list. A broken package never breaks the shell: modules that fail to load
// and malformed or duplicate definitions are skipped and reported as errors.
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

export const builtinFeatures: FeatureDefinition[] = [
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

export interface FeatureRegistry {
  features: FeatureDefinition[];
  /** Human readable load/validation problems; the offending feature was skipped. */
  errors: string[];
}

function problem(feature: FeatureDefinition, ids: Set<string>, tabs: Set<string>): string | null {
  if (!feature || typeof feature !== 'object') return 'is not an object';
  if (!feature.id || !feature.component || !feature.titleKey || !feature.slot)
    return 'is incomplete';
  if (ids.has(feature.id)) return 'has a duplicate id';
  if (tabSlots.has(feature.slot)) {
    if (!feature.tab) return 'needs a tab id';
    if (tabs.has(`${feature.slot}/${feature.tab}`)) return `has a duplicate tab ${feature.tab}`;
  }
  return null;
}

/** Validates and orders feature definitions. Invalid entries are skipped and reported. */
export function collectFeatures(
  modules: Record<string, unknown>,
  base: FeatureDefinition[] = [],
): FeatureRegistry {
  const errors: string[] = [];
  const accepted: FeatureDefinition[] = [];
  const ids = new Set<string>();
  const tabs = new Set<string>();
  const add = (feature: FeatureDefinition, origin: string) => {
    const reason = problem(feature, ids, tabs);
    if (reason) {
      errors.push(`${origin}: feature ${feature?.id ?? '(unknown)'} ${reason}.`);
      return;
    }
    ids.add(feature.id);
    if (tabSlots.has(feature.slot)) tabs.add(`${feature.slot}/${feature.tab}`);
    accepted.push(feature);
  };
  for (const feature of base) add(feature, 'builtin');
  for (const [path, module] of Object.entries(modules)) {
    const value = (module as { default?: FeatureDefinition | FeatureDefinition[] } | null)?.default;
    if (!value) {
      errors.push(`${path}: no default export.`);
      continue;
    }
    for (const feature of Array.isArray(value) ? value : [value]) add(feature, path);
  }
  accepted.sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id));
  return { features: accepted, errors };
}

/** Imports every feature module separately; a module that throws is reported, not fatal. */
export async function loadFeatures(
  loaders: Record<string, () => Promise<unknown>>,
  base: FeatureDefinition[] = builtinFeatures,
): Promise<FeatureRegistry> {
  const entries = Object.entries(loaders);
  const settled = await Promise.allSettled(entries.map(([, load]) => load()));
  const modules: Record<string, unknown> = {};
  const failures: string[] = [];
  settled.forEach((result, index) => {
    const path = entries[index][0];
    if (result.status === 'fulfilled') modules[path] = result.value;
    else failures.push(`${path}: failed to load (${String(result.reason)}).`);
  });
  const registry = collectFeatures(modules, base);
  return { features: registry.features, errors: [...failures, ...registry.errors] };
}

/** Features of one slot; entries whose capability is missing stay listed as unavailable. */
export function featuresFor(
  slot: FeatureSlot,
  capabilities: ReadonlySet<string>,
  list: FeatureDefinition[] = builtinFeatures,
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
  list: FeatureDefinition[] = builtinFeatures,
): ResolvedFeature | undefined {
  return featuresFor(slot, capabilities, list).find((entry) => entry.feature.tab === tab);
}

/** Lazy loaders for all packages (src/lib/features/<name>/feature.ts). */
export const featureLoaders = import.meta.glob('./*/feature.ts');
