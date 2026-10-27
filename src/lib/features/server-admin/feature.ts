// SPDX-License-Identifier: AGPL-3.0-only
// Read-only server administration (API 0.17): status counters, variables, process list.
import type { FeatureDefinition } from '$lib/features';
import ServerAdminTab from './ServerAdminTab.svelte';

const feature: FeatureDefinition = {
  id: 'server-admin.server',
  slot: 'server-tab',
  tab: 'serververwaltung',
  titleKey: 'serverAdmin.title',
  order: 50,
  component: ServerAdminTab,
};
export default feature;
