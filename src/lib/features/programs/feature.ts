// SPDX-License-Identifier: AGPL-3.0-only
import type { FeatureDefinition } from '$lib/features';
import ProgramsTab from './ProgramsTab.svelte';
export default {
  id: 'programs.database',
  slot: 'database-tab',
  tab: 'programmobjekte',
  titleKey: 'programs.tab',
  order: 70,
  component: ProgramsTab,
} satisfies FeatureDefinition;
