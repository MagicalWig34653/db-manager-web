import type { FeatureDefinition } from '$lib/features';
import SettingsPanel from './SettingsPanel.svelte';
export default {
  id: 'settings',
  slot: 'server-section',
  titleKey: 'settings.title',
  order: 90,
  component: SettingsPanel,
} satisfies FeatureDefinition;
