// SPDX-License-Identifier: AGPL-3.0-only
import type { FeatureDefinition } from '$lib/features';
import AccountsTab from './AccountsTab.svelte';
const feature: FeatureDefinition = {
  id: 'accounts.server',
  slot: 'server-tab',
  tab: 'benutzer',
  titleKey: 'accounts.title',
  order: 40,
  component: AccountsTab,
};
export default feature;
