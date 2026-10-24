// SPDX-License-Identifier: AGPL-3.0-only
import type { FeatureDefinition } from '$lib/features';
import CreateTablePanel from './CreateTablePanel.svelte';

// No registry-level capability: the panel itself reads GET /api/v6/capabilities and explains
// instances without table creation instead of hiding the tab.
const feature: FeatureDefinition = {
  id: 'create-table.create',
  slot: 'database-tab',
  tab: 'tabelle-anlegen',
  titleKey: 'table-create.tab',
  order: 20,
  component: CreateTablePanel,
};
export default feature;
