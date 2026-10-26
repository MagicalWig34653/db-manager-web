// SPDX-License-Identifier: AGPL-3.0-only
import type { FeatureDefinition } from '$lib/features';
import SearchTab from './SearchTab.svelte';
import ReplaceTab from './ReplaceTab.svelte';
const features: FeatureDefinition[] = [
  {
    id: 'search.database',
    slot: 'database-tab',
    tab: 'suche',
    titleKey: 'search.tab',
    order: 65,
    component: SearchTab,
  },
  {
    id: 'search.replace',
    slot: 'table-tab',
    tab: 'ersetzen',
    titleKey: 'search.replaceTab',
    order: 65,
    component: ReplaceTab,
  },
];
export default features;
