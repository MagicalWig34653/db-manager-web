<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { t, formatNumber } from '$lib/i18n';
  import type { WritePhase } from '$lib/rows';
  import { Migration } from './migration.svelte';
  import { errorText } from './model';
  import type { ConfigStore } from './store.svelte';

  let {
    store,
    secrets = () => [],
    onwritephase = () => {},
  }: {
    store: ConfigStore;
    secrets?: () => string[];
    onwritephase?: (phase: WritePhase) => void;
  } = $props();
  const migration = $derived(
    new Migration(
      store,
      () => onwritephase,
      () => secrets(),
    ),
  );
  const uid = $props.id();
  $effect(() => {
    void migration.includeHistory;
    untrack(() => void migration.refreshPreview());
  });
</script>

<section class="migration" aria-labelledby="{uid}-h">
  <h3 id="{uid}-h">{t('configStore.migration.title')}</h3>
  {#if migration.phase === 'deleted'}
    <p role="status">
      {t('configStore.migration.deleted', { count: formatNumber(migration.deletedCount) })}
    </p>
  {:else if migration.phase !== 'done' && migration.phase !== 'failed' && (!migration.preview || (!migration.preview.items.length && !migration.preview.hasHistory))}
    <p>{t('configStore.migration.nothing')}</p>
  {:else}
    <p>{t('configStore.migration.intro')}</p>
    {#if migration.preview}
      <p>
        {t('configStore.migration.preview', {
          bookmarks: formatNumber(migration.preview.bookmarks),
          history: formatNumber(migration.preview.history),
        })}
      </p>
      {#if migration.preview.hasHistory}
        <label
          ><input
            type="checkbox"
            bind:checked={migration.includeHistory}
            disabled={migration.phase === 'running'}
          />
          {t('configStore.migration.includeHistory', {
            count: formatNumber(migration.preview.history),
          })}</label
        >
        {#if migration.includeHistory}<p>{t('configStore.migration.historyWarn')}</p>{/if}
      {/if}
      {#if migration.preview.skipped}
        <p>
          {t('configStore.migration.skipped', { count: formatNumber(migration.preview.skipped) })}
        </p>
      {/if}
    {/if}
    {#if migration.phase === 'ready' || migration.phase === 'running' || migration.phase === 'failed'}
      <label
        ><input
          type="checkbox"
          bind:checked={migration.confirmed}
          disabled={migration.phase === 'running'}
        />
        {t('configStore.migration.confirm')}</label
      >
      <button type="button" disabled={!migration.canRun} onclick={() => migration.run()}
        >{migration.phase === 'running'
          ? t('configStore.migration.running')
          : t('configStore.migration.run')}</button
      >
    {/if}
    {#if migration.summary && migration.phase !== 'running'}
      <p role="status">
        {t('configStore.migration.result', {
          created: formatNumber(migration.summary.created),
          exists: formatNumber(migration.summary.exists),
          updated: formatNumber(migration.summary.updated),
          rejected: formatNumber(migration.summary.rejected),
        })}
      </p>
      {#if migration.summary.rejected}
        <ul>
          {#each Object.entries(migration.summary.reasons) as [reason, count] (reason)}
            <li>{errorText(reason)} ({formatNumber(count)})</li>
          {/each}
        </ul>
        <p>{t('configStore.migration.rejectedHint')}</p>
      {/if}
    {/if}
    {#if migration.phase === 'failed'}<p role="alert">
        {migration.error}
        {t('configStore.migration.failed')}
      </p>{/if}
    {#if migration.phase === 'done'}
      <p>{t('configStore.migration.deleteLocalHint')}</p>
      <button type="button" onclick={() => migration.deleteLocal()}
        >{t('configStore.migration.deleteLocal')}</button
      >
    {/if}
  {/if}
</section>

<style>
  .migration {
    display: grid;
    gap: 0.5rem;
    justify-items: start;
    min-width: 0;
  }
  h3 {
    font-weight: 600;
    margin: 0.5rem 0;
  }
  p {
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
