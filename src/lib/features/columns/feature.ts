// SPDX-License-Identifier: AGPL-3.0-only
// Mounts the column editor (API 0.9) as table tab "spalten". No registry capability: the panel
// reads /api/v9/capabilities itself and explains unsupported actions instead of hiding them.
import type { FeatureDefinition } from '$lib/features';
import ColumnsTab from './ColumnsTab.svelte';

const feature: FeatureDefinition = {
  id: 'columns.table',
  slot: 'table-tab',
  tab: 'spalten',
  titleKey: 'columns.tab',
  order: 40,
  component: ColumnsTab,
};
export default feature;
