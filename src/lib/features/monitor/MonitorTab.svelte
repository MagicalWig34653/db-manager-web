<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { Activity } from '@lucide/svelte';
  import ErrorPanel from '$lib/components/shared/ErrorPanel.svelte';
  import SubTabs from '$lib/components/shared/SubTabs.svelte';
  import type { FeatureProps } from '$lib/features';
  import { t } from '$lib/i18n';
  import { Resource } from '$lib/resource.svelte';
  import BinlogView from './BinlogView.svelte';
  import { monitorClient } from './client';
  import MonitorView from './MonitorView.svelte';
  import { autoRefreshViews, views, type Capabilities, type View } from './model';
  import ProfilingView from './ProfilingView.svelte';

  let { connection, token }: FeatureProps = $props();

  const capabilities = new Resource<Capabilities>();
  let selected = $state<View>('sample');
  const tabs = $derived(views.map((view) => ({ id: view, label: t(`monitor.tab.${view}`) })));

  async function loadCapabilities() {
    await capabilities.run(
      (signal) => monitorClient.capabilities(token, signal),
      t('monitor.errGeneric'),
    );
  }
  $effect(() => {
    void connection;
    void token;
    untrack(() => {
      capabilities.reset();
      if (connection) void loadCapabilities();
    });
    return () => capabilities.abort();
  });
</script>

<section class="overview-panel" aria-label={t('monitor.title')} data-testid="monitor">
  <div class="panel-heading">
    <div class="query-tab"><Activity size={17} /><strong>{t('monitor.title')}</strong></div>
  </div>

  {#if !connection}
    <p class="catalog-message">{t('server.noConnection')}</p>
  {:else}
    <p class="catalog-message" data-testid="monitor-readonly">{t('monitor.readOnly')}</p>
    {#if capabilities.error}
      <ErrorPanel
        title={capabilities.errorCode === 'not_found'
          ? t('monitor.errNotOfferedTitle')
          : t('monitor.errTitle')}
        message={capabilities.error}
        onretry={loadCapabilities}
      />
    {:else if capabilities.busy}
      <p class="catalog-message" role="status">{t('monitor.loading')}</p>
    {:else if capabilities.data}
      {@const caps = capabilities.data}
      <SubTabs
        {tabs}
        {selected}
        onselect={(id) => (selected = id as View)}
        label={t('monitor.tabsLabel')}
        idPrefix="monitor"
      />
      <div
        role="tabpanel"
        id="monitor-panel"
        aria-labelledby={`monitor-tab-${selected}`}
        data-testid="monitor-panel"
      >
        {#key `${selected}:${connection.driver}`}
          {#if selected === 'binary-logs'}
            <BinlogView {connection} {token} capabilities={caps} />
          {:else if selected === 'profiling'}
            <ProfilingView {connection} {token} capabilities={caps} />
          {:else}
            <MonitorView
              action={selected}
              {connection}
              {token}
              capabilities={caps}
              auto={autoRefreshViews.has(selected)}
              caption={t(`monitor.tab.${selected}`)}
            />
          {/if}
        {/key}
      </div>
    {/if}
  {/if}
</section>
