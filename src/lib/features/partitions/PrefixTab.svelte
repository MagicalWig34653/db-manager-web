<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { RefreshCw, TriangleAlert } from '@lucide/svelte';
  import { toConnection } from '$lib/api';
  import CapabilityNotice from '$lib/components/shared/CapabilityNotice.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import type { FeatureProps } from '$lib/features';
  import { t } from '$lib/i18n';
  import { getShellContext } from '$lib/shell/context';
  import { CapabilityState } from './capabilities.svelte';
  import { partitionsClient, structureErrorMessage } from './client';
  import {
    PREFIX_ACTIONS,
    prefixTitle,
    tableLabel,
    type PrefixAction,
    type PrefixResult,
  } from './model';
  import StructureCard from './StructureCard.svelte';

  let { connection, token, onwritephase }: FeatureProps = $props();
  const shell = getShellContext();
  const caps = new CapabilityState();
  const uid = $props.id();

  let prefix = $state('');
  let schema = $state('');
  let newPrefix = $state('');
  let action = $state<PrefixAction>('drop');
  let matches = $state<PrefixResult | null>(null);
  let matchError = $state('');
  let matchBusy = $state(false);
  let matchedFor = $state('');
  let generation = 0;

  const featureOn = $derived(caps.data?.features.includes('prefix_batch') ?? false);
  const needsNew = $derived(action === 'replace' || action === 'add' || action === 'copy');
  const valid = $derived(prefix !== '' && prefix.length <= 255 && (!needsNew || newPrefix !== ''));
  const scope = $derived(`${prefix}\u0000${schema}\u0000${newPrefix}`);
  const optionalSchema = () => (schema.trim() === '' ? {} : { schema });
  const fields = () => ({
    prefix,
    ...optionalSchema(),
    ...(needsNew ? { new_prefix: newPrefix } : {}),
  });

  const matchKey = () => `${prefix}\u0000${schema}`;
  async function loadMatches() {
    if (!connection || prefix === '' || matchBusy) return;
    const current = ++generation;
    matchBusy = true;
    matchError = '';
    try {
      const result = await partitionsClient.listPrefix(
        { connection: toConnection(connection), prefix, ...optionalSchema() },
        token,
      );
      if (current !== generation) return;
      matches = result;
      matchedFor = matchKey();
    } catch (cause) {
      if (current !== generation) return;
      matches = null;
      matchError = structureErrorMessage(cause);
    } finally {
      if (current === generation) matchBusy = false;
    }
  }
  const stale = $derived(matches !== null && matchedFor !== matchKey());

  $effect(() => {
    token;
    connection;
    if (!connection) return;
    untrack(() => void caps.load(token));
    return () => caps.abort();
  });
  // Inputs and match lists never survive a connection or token change.
  $effect(() => {
    token;
    connection;
    untrack(() => {
      generation++;
      prefix = '';
      schema = '';
      newPrefix = '';
      matches = null;
      matchError = '';
      matchBusy = false;
    });
  });
  function finished() {
    void shell?.session.loadCatalog();
    matches = null;
  }
</script>

<section class="ops" aria-label={t('partitions.prefixHeading')} data-testid="prefix-tab">
  <h2>{t('partitions.prefixHeading')}</h2>
  {#if !connection}
    <p class="catalog-message">{t('partitions.noConnection')}</p>
  {:else if caps.state === 'loading'}
    <p class="catalog-message" role="status">{t('partitions.capsLoading')}</p>
  {:else if caps.state === 'unsupported'}
    <CapabilityNotice title={t('partitions.unsupportedTitle')} reason={caps.message} />
  {:else if caps.state === 'failed'}
    <div class="feedback error-feedback" role="alert">
      <TriangleAlert size={18} />
      <p>{caps.message}</p>
    </div>
  {:else if !featureOn}
    <CapabilityNotice
      title={t('partitions.unsupportedTitle')}
      reason={t('partitions.errUnsupportedFeature')}
    />
  {:else}
    <p class="note">{t('partitions.prefixIntro')}</p>
    <div class="field">
      <label for="{uid}-prefix">{t('partitions.prefix')}</label>
      <Input
        id="{uid}-prefix"
        bind:value={prefix}
        autocomplete="off"
        spellcheck={false}
        data-testid="prefix-input"
      />
      <small>{t('partitions.prefixHint')}</small>
    </div>
    <div class="field">
      <label for="{uid}-schema">{t('partitions.schemaOptional')}</label>
      <Input id="{uid}-schema" bind:value={schema} autocomplete="off" spellcheck={false} />
    </div>

    <div class="list" data-testid="prefix-matches">
      <div class="row">
        <strong>{t('partitions.matches')}</strong>
        <Button
          variant="outline"
          size="sm"
          disabled={matchBusy || prefix === ''}
          onclick={() => void loadMatches()}
          ><RefreshCw size={14} />{t('partitions.showMatches')}</Button
        >
      </div>
      {#if matchError}
        <div class="feedback error-feedback" role="alert">
          <TriangleAlert size={18} />
          <p>{matchError}</p>
        </div>
      {:else if matches}
        {#if stale}<p class="note">{t('partitions.matchesStale')}</p>{/if}
        {#if matches.tables.length === 0}
          <p>{t('partitions.noMatches')}</p>
        {:else}
          <p>{t('partitions.matchCount', { n: matches.tables.length })}</p>
          <ul data-testid="match-list">
            {#each matches.tables as table, index (index)}<li>
                <code>{tableLabel(table)}</code>
              </li>{/each}
          </ul>
        {/if}
      {/if}
    </div>

    <div class="field">
      <label for="{uid}-action">{t('partitions.actionLabel')}</label>
      <select id="{uid}-action" bind:value={action} data-testid="prefix-action">
        {#each PREFIX_ACTIONS as item (item)}<option value={item}>{prefixTitle(item)}</option
          >{/each}
      </select>
    </div>
    {#key action}
      <StructureCard
        kind="prefix"
        {action}
        title={prefixTitle(action)}
        testId={`prefix-${action}`}
        {connection}
        {token}
        {onwritephase}
        {scope}
        onfinished={finished}
        {valid}
        {fields}
      >
        {#snippet form(busy)}
          {#if needsNew}
            <div class="field">
              <label for="{uid}-new">{t('partitions.newPrefix')}</label>
              <Input
                id="{uid}-new"
                bind:value={newPrefix}
                disabled={busy}
                autocomplete="off"
                spellcheck={false}
                data-testid="new-prefix-input"
              />
              <small>{t('partitions.newPrefixHint')}</small>
            </div>
          {/if}
          <p class="note">{t(`partitions.pfxHint.${action}`)}</p>
        {/snippet}
      </StructureCard>
    {/key}
    <p class="note">{t('partitions.prefixPartialHint')}</p>
  {/if}
</section>

<style>
  .ops {
    display: grid;
    gap: 0.75rem;
    min-width: 0;
    padding: 1rem;
  }
  h2,
  p {
    margin: 0;
  }
  .note,
  small {
    color: var(--color-muted-foreground);
    font-size: 0.8125rem;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .list {
    display: grid;
    gap: 0.375rem;
    min-width: 0;
  }
  .field {
    display: grid;
    gap: 0.25rem;
    min-width: 0;
  }
  .field label {
    font-size: 0.8125rem;
    font-weight: 600;
  }
  select {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 0.375rem 0.5rem;
    background: var(--color-background);
    color: inherit;
    font: inherit;
    max-width: 100%;
    box-sizing: border-box;
  }
  ul {
    margin: 0;
    padding-left: 1.25rem;
  }
  code {
    overflow-wrap: anywhere;
  }
</style>
