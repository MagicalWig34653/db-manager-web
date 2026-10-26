// SPDX-License-Identifier: AGPL-3.0-only
import type { FeatureDefinition } from '$lib/features';
import IndexesTab from './IndexesTab.svelte';
const feature: FeatureDefinition = {
  id: 'indexes.table',
  slot: 'table-tab',
  tab: 'indizes',
  titleKey: 'indexes.tab',
  order: 50,
  component: IndexesTab,
};
export default feature;
