// SPDX-License-Identifier: AGPL-3.0-only
import type { FeatureDefinition } from '$lib/features';
import MaintenancePanel from './MaintenancePanel.svelte';
const features: FeatureDefinition[] = ['table-tab', 'database-tab'].map((slot) => ({
  id: `maintenance.${slot}`,
  slot: slot as 'table-tab' | 'database-tab',
  tab: 'wartung',
  titleKey: 'maintenance.title',
  order: 50,
  component: MaintenancePanel,
}));
export default features;
