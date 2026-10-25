// SPDX-License-Identifier: AGPL-3.0-only
import type { FeatureDefinition } from '$lib/features';
import ExportPanel from './ExportPanel.svelte';

// No registry capability: the panel reads GET /api/v11/capabilities and explains instances
// without export instead of hiding the tab.
const features: FeatureDefinition[] = [
  {
    id: 'export.database',
    slot: 'database-tab',
    tab: 'export',
    titleKey: 'exportDump.tab',
    order: 30,
    component: ExportPanel,
  },
  {
    id: 'export.table',
    slot: 'table-tab',
    tab: 'export',
    titleKey: 'exportDump.tab',
    order: 30,
    component: ExportPanel,
  },
];
export default features;
