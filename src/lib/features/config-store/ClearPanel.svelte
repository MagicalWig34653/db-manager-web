<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { t, formatNumber } from '$lib/i18n';
  import type { WritePhase } from '$lib/rows';
  import { ClearFlow } from './clear.svelte';
  import type { Kind } from './client';
  import type { ConfigStore } from './store.svelte';

  let {
    store,
    kinds,
    scope,
    label,
    onwritephase = () => {},
    ondone = () => {},
  }: {
    store: ConfigStore;
    kinds: Kind[];
    scope?: string;
    label: string;
    onwritephase?: (phase: WritePhase) => void;
    ondone?: () => void;
  } = $props();
  const flow = $derived(new ClearFlow(store, () => onwritephase));
  const uid = $props.id();
  async function execute() {
    await flow.execute();
    if (flow.phase === 'done') ondone();
  }
</script>

<div class="clear-flow">
  {#if flow.phase === 'idle' || flow.phase === 'failed'}
    <button type="button" onclick={() => flow.loadPlan(kinds, scope)}>{label}</button>
  {/if}
  {#if flow.phase === 'planning'}<p role="status">{t('configStore.library.loading')}</p>{/if}
  {#if flow.plan && (flow.phase === 'planned' || flow.phase === 'executing')}
    <p>{t('configStore.clear.intro')}</p>
    <ul>
      {#each flow.plan.kinds as line (line.kind)}
        <li>
          {t('configStore.clear.planLine', {
            kind: t(`configStore.kind.${line.kind}`),
            count: formatNumber(line.count),
            bytes: formatNumber(line.bytes),
          })}
        </li>
      {/each}
    </ul>
    <p>
      {t('configStore.clear.total', {
        count: formatNumber(flow.plan.total_items),
        bytes: formatNumber(flow.plan.total_bytes),
      })}
    </p>
    {#if flow.plan.total_items === 0}
      <p role="status">{t('configStore.clear.nothing')}</p>
      <button type="button" onclick={() => flow.reset()}>{t('configStore.clear.cancel')}</button>
    {:else}
      <label for="{uid}-confirm"
        >{t('configStore.clear.typeLabel', { text: flow.plan.confirmation })}</label
      >
      <input
        id="{uid}-confirm"
        autocomplete="off"
        spellcheck="false"
        bind:value={flow.typed}
        disabled={flow.phase === 'executing'}
      />
      <div class="row">
        <button type="button" class="danger" disabled={!flow.canExecute} onclick={execute}
          >{t('configStore.clear.execute')}</button
        >
        <button type="button" disabled={flow.phase === 'executing'} onclick={() => flow.reset()}
          >{t('configStore.clear.cancel')}</button
        >
      </div>
    {/if}
  {/if}
  {#if flow.phase === 'done' && flow.result}
    <p role="status">{t('configStore.clear.done', { count: formatNumber(flow.result.total) })}</p>
    <button type="button" onclick={() => flow.reset()}>{t('configStore.clear.cancel')}</button>
  {/if}
  {#if flow.error}
    <p role="alert">{flow.error}{flow.unknown ? ` ${t('configStore.clear.unknown')}` : ''}</p>
  {/if}
</div>

<style>
  .clear-flow {
    display: grid;
    gap: 0.5rem;
    justify-items: start;
    min-width: 0;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  input {
    max-width: 100%;
    border: 1px solid var(--border);
    padding: 0.3rem;
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
  p {
    margin: 0.25rem 0;
    overflow-wrap: anywhere;
  }
</style>
