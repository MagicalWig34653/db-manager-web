// SPDX-License-Identifier: AGPL-3.0-only
import type { FeatureDefinition } from '$lib/features';
import BatchPanel from './BatchPanel.svelte';
const features: FeatureDefinition[] = [
  {
    id: 'sql-batch.database',
    slot: 'database-tab',
    tab: 'sql-stapel',
    titleKey: 'sqlBatch.tab',
    order: 40,
    component: BatchPanel,
  },
  {
    id: 'sql-batch.table',
    slot: 'table-tab',
    tab: 'sql-stapel',
    titleKey: 'sqlBatch.tab',
    order: 40,
    component: BatchPanel,
  },
];
export default features;
