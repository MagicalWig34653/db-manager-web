// SPDX-License-Identifier: AGPL-3.0-only
// Read-only monitor and replication views (API 0.20): samples, advisor hints, query analysis,
// replication status, binary logs, EXPLAIN, engines.
import type { FeatureDefinition } from '$lib/features';
import MonitorTab from './MonitorTab.svelte';

const feature: FeatureDefinition = {
  id: 'monitor.server',
  slot: 'server-tab',
  tab: 'monitor',
  titleKey: 'monitor.title',
  order: 60,
  component: MonitorTab,
};
export default feature;
