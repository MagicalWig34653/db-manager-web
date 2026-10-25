// SPDX-License-Identifier: AGPL-3.0-only
// Mounts the database and table operations (API 0.8): database tab "datenbank-aktionen" and
// table tab "operationen". No registry capability: the panels read /api/v8/capabilities themselves
// and explain unsupported actions instead of hiding them.
import type { FeatureDefinition } from '$lib/features';
import DatabaseOpsTab from './DatabaseOpsTab.svelte';
import TableOpsTab from './TableOpsTab.svelte';

const features: FeatureDefinition[] = [
  {
    id: 'object-ops.database',
    slot: 'database-tab',
    tab: 'datenbank-aktionen',
    titleKey: 'object-ops.databaseTab',
    order: 30,
    component: DatabaseOpsTab,
  },
  {
    id: 'object-ops.table',
    slot: 'table-tab',
    tab: 'operationen',
    titleKey: 'object-ops.tableTab',
    order: 30,
    component: TableOpsTab,
  },
];
export default features;
