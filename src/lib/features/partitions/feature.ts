// SPDX-License-Identifier: AGPL-3.0-only
// Mounts partitions (API 0.22) as a table tab "partitionen" and the table prefix batch as a database
// tab "praefix-stapel". No registry capability: the panels read /api/v22/capabilities themselves and
// explain unsupported drivers (SQLite has no partitions) instead of hiding the tabs.
import type { FeatureDefinition } from '$lib/features';
import PartitionsTab from './PartitionsTab.svelte';
import PrefixTab from './PrefixTab.svelte';

const features: FeatureDefinition[] = [
  {
    id: 'partitions.table',
    slot: 'table-tab',
    tab: 'partitionen',
    titleKey: 'partitions.tableTab',
    order: 55,
    component: PartitionsTab,
  },
  {
    id: 'partitions.prefix',
    slot: 'database-tab',
    tab: 'praefix-stapel',
    titleKey: 'partitions.prefixTab',
    order: 55,
    component: PrefixTab,
  },
];
export default features;
