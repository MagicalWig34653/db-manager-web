<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { Database } from '@lucide/svelte';
  import { t } from '$lib/i18n';
  import type { FeatureDefinition, FeatureProps } from '$lib/features';
  import FeatureHost from '../FeatureHost.svelte';

  let props: FeatureProps = $props();
  const connection = $derived(props.connection);
  const driverNames = { sqlite: 'SQLite', mysql: 'MySQL / MariaDB', postgresql: 'PostgreSQL' };
  let sections = $state<FeatureDefinition[]>([]);

  // Packages add sections via slot 'server-section'. The registry is imported lazily to avoid a
  // load-time cycle (the registry imports this tab).
  onMount(() => {
    let alive = true;
    void import('$lib/features').then(async (registry) => {
      const loaded = await registry.loadFeatures(registry.featureLoaders);
      if (alive) sections = loaded.features.filter((feature) => feature.slot === 'server-section');
    });
    return () => {
      alive = false;
    };
  });
</script>

<section class="editor-panel" aria-label={t('shell.serverOverview')}>
  <div class="panel-heading">
    <div class="query-tab">
      <Database size={17} /><strong>{t('server.connectionLabel')}</strong>
    </div>
  </div>
  {#if connection}
    <div class="table-facts">
      <span>{t('server.driverLabel')}: {driverNames[connection.driver]}</span>
      <span>{t('server.databaseLabel')}: {connection.database}</span>
    </div>
  {:else}
    <p class="catalog-message">{t('server.noConnection')}</p>
  {/if}
</section>
{#each sections as section (section.id)}
  <FeatureHost component={section.component} props={{ ...props }} />
{/each}
