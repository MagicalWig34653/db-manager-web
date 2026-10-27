// SPDX-License-Identifier: AGPL-3.0-only
import type { FeatureDefinition } from '$lib/features';
import ImportPanel from './ImportPanel.svelte';

// No registry capability: the panel reads GET /api/v18/capabilities and explains instances without import
// instead of hiding the tab. Database tab: SQL files. Table tab: CSV into that table.
const features: FeatureDefinition[] = [
  {
    id: 'import.database',
    slot: 'database-tab',
    tab: 'import',
    titleKey: 'importData.tab',
    order: 35,
    component: ImportPanel,
  },
  {
    id: 'import.table',
    slot: 'table-tab',
    tab: 'import',
    titleKey: 'importData.tab',
    order: 35,
    component: ImportPanel,
  },
];
export default features;
