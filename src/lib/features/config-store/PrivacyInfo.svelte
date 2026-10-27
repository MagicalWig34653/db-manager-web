<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { t } from '$lib/i18n';
  let { server }: { server: boolean } = $props();
  const id = $props.id();
</script>

<section aria-labelledby="{id}-h" class="privacy-info">
  <h3 id="{id}-h">{t('configStore.data.title')}</h3>
  <ul>
    <li>{t('configStore.data.what')}</li>
    <li>{server ? t('configStore.data.where') : t('configStore.data.localOnly')}</li>
    {#if server}<li>{t('configStore.data.who')}</li>{/if}
    <li>{t('configStore.data.secrets')}</li>
    <li>{t('configStore.data.delete')}</li>
    {#if server}<li>{t('configStore.data.backups')}</li>{/if}
  </ul>
</section>

<style>
  h3 {
    font-weight: 600;
    margin: 0.5rem 0;
  }
  li {
    overflow-wrap: anywhere;
    margin: 0.25rem 0;
  }
</style>
