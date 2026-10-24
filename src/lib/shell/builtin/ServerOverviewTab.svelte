<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { Database } from '@lucide/svelte';
  import { t } from '$lib/i18n';
  import type { FeatureProps } from '$lib/features';
  import ServerInfoPanel from '$lib/features/overview/ServerInfoPanel.svelte';

  let { connection, token }: FeatureProps = $props();
  const driverNames = { sqlite: 'SQLite', mysql: 'MySQL / MariaDB', postgresql: 'PostgreSQL' };
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

<ServerInfoPanel {connection} {token} />
