// SPDX-License-Identifier: AGPL-3.0-only
// Mounts the read-only overview (API 0.7): object overview as database tab "uebersicht" and the
// definition view as table tab "definition". The server information (#/server) is rendered by
// ServerInfoPanel inside the built-in server overview.
import type { FeatureDefinition } from '$lib/features';
import ObjectsTab from './ObjectsTab.svelte';
import DefinitionTab from './DefinitionTab.svelte';

const features: FeatureDefinition[] = [
  {
    id: 'overview.objects',
    slot: 'database-tab',
    tab: 'uebersicht',
    titleKey: 'overview.tabTitle',
    order: 10,
    component: ObjectsTab,
  },
  {
    id: 'overview.definition',
    slot: 'table-tab',
    tab: 'definition',
    titleKey: 'overview.definitionTab',
    order: 10,
    component: DefinitionTab,
  },
];
export default features;
