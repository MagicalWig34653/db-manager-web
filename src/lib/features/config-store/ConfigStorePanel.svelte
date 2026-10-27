<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { t, formatNumber } from '$lib/i18n';
  import type { WritePhase } from '$lib/rows';
  import type { ConnectionDraft } from '$lib/workbench';
  import { preferences, updatePreferences } from '../settings/preferences.svelte';
  import { AppearanceSync } from './appearance.svelte';
  import ClearPanel from './ClearPanel.svelte';
  import { KINDS } from './client';
  import FavoritesPanel from './FavoritesPanel.svelte';
  import MigrationPanel from './MigrationPanel.svelte';
  import { errorText, reasonText } from './model';
  import PrivacyInfo from './PrivacyInfo.svelte';
  import { configStoreFor } from './store.svelte';

  let {
    connection,
    token,
    onwritephase = () => {},
  }: {
    connection: ConnectionDraft | null;
    token: string;
    onwritephase?: (phase: WritePhase) => void;
  } = $props();
  const store = $derived(configStoreFor(token));
  const uid = $props.id();
  let historyMessage = $state('');
  let busy = $state(false);
  let exportMessage = $state('');
  let exporting = $state(false);
  let appearance = $state<AppearanceSync>();

  $effect(() => store.observe((phase) => onwritephase(phase)));
  $effect(() => {
    const current = store;
    historyMessage = '';
    exportMessage = '';
    // Opening the panel re-checks immediately after an outage (no wait for the throttle).
    void untrack(() => current.ensureReady(current.degraded));
  });
  // Theme and language follow the server once it is the storage; the sync object lives as long as the store.
  $effect(() => {
    const current = store;
    if (current.phase !== 'ready' || current.mode !== 'server') {
      appearance = undefined;
      return;
    }
    const sync = new AppearanceSync(current, (value) =>
      updatePreferences({
        theme: value.theme as 'light' | 'dark' | 'system',
        locale: value.locale as 'de' | 'en',
      }),
    );
    appearance = sync;
    void sync.load();
    return () => sync.destroy();
  });
  $effect(() => {
    const theme = preferences.theme;
    const locale = preferences.locale;
    untrack(() => appearance?.push(theme, locale));
  });
  $effect(() => {
    if (store.mode === 'server') void untrack(() => store.refreshUsage());
  });

  async function toggleHistory(value: boolean) {
    if (busy) return;
    busy = true;
    historyMessage = '';
    try {
      const result = await store.setHistoryEnabled(value);
      if (!result.ok)
        historyMessage =
          result.code === 'version_conflict' || result.code === 'already_exists'
            ? t('configStore.historyChanged')
            : errorText(result.code);
    } finally {
      busy = false;
    }
  }
  async function download() {
    if (exporting) return;
    exporting = true;
    exportMessage = '';
    try {
      const result = await store.exportAll();
      if (!result.ok) {
        exportMessage = t('configStore.export.failed');
        return;
      }
      const url = URL.createObjectURL(new Blob([result.value.text], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'db-manager-konfiguration.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      exportMessage = t('configStore.export.done', { count: formatNumber(result.value.count) });
    } finally {
      exporting = false;
    }
  }
</script>

<section class="config-store editor-panel" aria-labelledby="{uid}-h" id="config-store">
  <h2 id="{uid}-h">{t('configStore.title')}</h2>
  {#if store.phase !== 'ready'}
    <p role="status">{t('configStore.checking')}</p>
  {:else if store.mode === 'local'}
    <p role="status">{t('configStore.modeLocal')}</p>
    <p>{reasonText(store.reason)}</p>
    <button type="button" onclick={() => store.ensureReady(true)}>{t('configStore.retry')}</button>
  {:else}
    <p role="status">{t('configStore.modeServer')}</p>
    {#if store.caps?.owner_model === 'single'}<p>{t('configStore.single')}</p>{/if}
    {#if store.degraded}
      <p role="alert">
        {t('configStore.degraded', { count: formatNumber(store.buffer.entries.length) })}
      </p>
      <button type="button" onclick={() => store.ensureReady(true)}>{t('configStore.retry')}</button
      >
    {/if}
    {#if store.buffer.storageFailed}<p role="alert">{t('configStore.bufferFailed')}</p>{/if}
    {#if store.droppedOnReplay}<p role="status">
        {t('configStore.dropped', { count: formatNumber(store.droppedOnReplay) })}
      </p>{/if}

    <h3>{t('configStore.historyTitle')}</h3>
    <label
      ><input
        type="checkbox"
        checked={store.historyEnabled}
        disabled={busy || store.degraded}
        onchange={(event) => toggleHistory(event.currentTarget.checked)}
      />
      {t('configStore.historyOptIn')}</label
    >
    {#if store.historyPaused}<p role="status">{t('configStore.historyPaused')}</p>{/if}
    <p>{store.historyEnabled ? t('configStore.historyHint') : t('configStore.historyOffHint')}</p>
    {#if historyMessage}<p role="alert">{historyMessage}</p>{/if}
    {#if !store.historyEnabled}
      <ClearPanel
        {store}
        kinds={['history']}
        label={t('configStore.clear.history')}
        {onwritephase}
      />
    {/if}
    {#if appearance?.notice}<p role="status">{appearance.notice}</p>{/if}

    <h3>{t('configStore.usageTitle')}</h3>
    {#if store.usage}
      <ul>
        {#each store.usage.usage as line (line.kind)}
          <li>
            {t('configStore.usageLine', {
              kind: t(`configStore.kind.${line.kind}`),
              count: formatNumber(line.count),
              max: formatNumber(line.max_items),
              bytes: formatNumber(line.bytes),
            })}
          </li>
        {/each}
      </ul>
      <p>
        {t('configStore.usageTotal', {
          bytes: formatNumber(store.usage.total_bytes),
          max: formatNumber(store.usage.max_owner_bytes),
        })}
      </p>
    {/if}
    <button type="button" onclick={() => store.refreshUsage()}
      >{t('configStore.usageRefresh')}</button
    >

    <FavoritesPanel {store} {connection} />
    <MigrationPanel {store} secrets={() => [connection?.password ?? '', token]} {onwritephase} />

    <h3>{t('configStore.export.button')}</h3>
    <button type="button" disabled={exporting} onclick={download}
      >{t('configStore.export.button')}</button
    >
    {#if exportMessage}<p role="status">{exportMessage}</p>{/if}

    <h3>{t('configStore.clear.title')}</h3>
    <ClearPanel
      {store}
      kinds={[...KINDS]}
      label={t('configStore.clear.all')}
      {onwritephase}
      ondone={() => void store.refreshUsage()}
    />
  {/if}
  <PrivacyInfo server={store.mode === 'server'} />
</section>

<style>
  .config-store {
    padding: 1rem;
    min-width: 0;
    display: grid;
    gap: 0.5rem;
    justify-items: start;
  }
  h2,
  h3 {
    font-weight: 600;
    margin: 0.5rem 0;
  }
  p,
  li {
    margin: 0.25rem 0;
    overflow-wrap: anywhere;
  }
  button {
    border: 1px solid var(--border);
    padding: 0.3rem 0.6rem;
    border-radius: 0.3rem;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
