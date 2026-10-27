// SPDX-License-Identifier: AGPL-3.0-only
import type { FeatureDefinition } from '$lib/features';
import ConfigStorePanel from './ConfigStorePanel.svelte';
export default {
  id: 'config-store',
  slot: 'server-section',
  titleKey: 'configStore.title',
  order: 91,
  component: ConfigStorePanel,
} satisfies FeatureDefinition;
