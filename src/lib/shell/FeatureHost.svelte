<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import type { Component } from 'svelte';
  import ErrorPanel from '$lib/components/shared/ErrorPanel.svelte';
  import { t } from '$lib/i18n';
  import type { FeatureProps } from '$lib/features';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let { component, props }: { component: Component<any>; props: FeatureProps } = $props();
  const Feature = $derived(component);
</script>

<svelte:boundary>
  <Feature {...props} />
  {#snippet failed(error, reset)}
    <ErrorPanel
      title={t('shell.featureCrashed')}
      message={error instanceof Error ? error.message : String(error)}
      onretry={reset}
    />
  {/snippet}
</svelte:boundary>
