<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { Gauge } from '@lucide/svelte';
  import CapabilityNotice from '$lib/components/shared/CapabilityNotice.svelte';
  import ErrorPanel from '$lib/components/shared/ErrorPanel.svelte';
  import SubTabs from '$lib/components/shared/SubTabs.svelte';
  import type { FeatureProps } from '$lib/features';
  import { t } from '$lib/i18n';
  import { Resource } from '$lib/resource.svelte';
  import AdminPanel from './AdminPanel.svelte';
  import { serverAdminClient } from './client';
  import { kinds, supportOf, type Capabilities, type Kind } from './model';

  let { connection, token }: FeatureProps = $props();

  const capabilities = new Resource<Capabilities>();
  let selected = $state<Kind>('status');

  const support = $derived(
    connection && capabilities.data
      ? supportOf(capabilities.data, connection.driver, selected)
      : null,
  );
  const tabs = $derived(kinds.map((kind) => ({ id: kind, label: t(`serverAdmin.tab.${kind}`) })));

  async function loadCapabilities() {
    await capabilities.run(
      (signal) => serverAdminClient.capabilities(token, signal),
      t('serverAdmin.errGeneric'),
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

<section class="overview-panel" aria-label={t('serverAdmin.title')} data-testid="server-admin">
  <div class="panel-heading">
    <div class="query-tab"><Gauge size={17} /><strong>{t('serverAdmin.title')}</strong></div>
  </div>

  {#if !connection}
    <p class="catalog-message">{t('server.noConnection')}</p>
  {:else}
    <p class="catalog-message" data-testid="admin-readonly">{t('serverAdmin.readOnly')}</p>
    {#if capabilities.error}
      <ErrorPanel
        title={capabilities.errorCode === 'not_found'
          ? t('serverAdmin.errNotOfferedTitle')
          : t('serverAdmin.errTitle')}
        message={capabilities.error}
        onretry={loadCapabilities}
      />
    {:else if capabilities.busy}
      <p class="catalog-message" role="status">{t('serverAdmin.loading')}</p>
    {:else if capabilities.data}
      <SubTabs
        {tabs}
        {selected}
        onselect={(id) => (selected = id as Kind)}
        label={t('serverAdmin.tabsLabel')}
        idPrefix="server-admin"
      />
      <div
        role="tabpanel"
        id="server-admin-panel"
        aria-labelledby={`server-admin-tab-${selected}`}
        data-testid="server-admin-panel"
      >
        {#if support && support.support !== 'supported'}
          <CapabilityNotice
            title={support.support === 'unsupported'
              ? t('serverAdmin.unsupportedTitle')
              : t('serverAdmin.limitedTitle')}
            reason={support.reason ?? t('shared.unsupportedReason')}
          />
        {/if}
        {#if support?.support !== 'unsupported'}
          {#key `${selected}:${connection.driver}`}
            <AdminPanel kind={selected} {connection} {token} />
          {/key}
        {/if}
      </div>
    {/if}
  {/if}
</section>
