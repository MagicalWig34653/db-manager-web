<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { Copy, FileCode } from '@lucide/svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import CapabilityNotice from '$lib/components/shared/CapabilityNotice.svelte';
  import ErrorPanel from '$lib/components/shared/ErrorPanel.svelte';
  import { t } from '$lib/i18n';
  import type { FeatureProps } from '$lib/features';
  import {
    driverCapability,
    overviewClient,
    type DefinitionResult,
    type OverviewCapabilities,
  } from './client';
  import { Resource } from './resource.svelte';

  let { connection, token, object }: FeatureProps = $props();

  const capabilities = new Resource<OverviewCapabilities>();
  const definition = new Resource<DefinitionResult>();
  let copyState = $state<'idle' | 'done' | 'failed'>('idle');
  const cap = $derived(
    connection && capabilities.data
      ? driverCapability(capabilities.data, connection, 'definition')
      : null,
  );

  async function load(
    current: NonNullable<typeof connection>,
    secret: string,
    target: { schema?: string; name: string },
  ) {
    copyState = 'idle';
    definition.reset();
    const caps = await capabilities.run(
      (signal) => overviewClient.capabilities(secret, signal),
      t('overview.loadFailed'),
    );
    if (!caps || driverCapability(caps, current, 'definition').support === 'unsupported') return;
    await definition.run(
      (signal) => overviewClient.definition(current, secret, target, signal),
      t('overview.definitionFailed'),
    );
  }

  $effect(() => {
    const current = connection;
    const secret = token;
    const target = object ? { schema: object.schema, name: object.name } : null;
    if (!current || !target) return;
    untrack(() => void load(current, secret, target));
    return () => {
      capabilities.abort();
      definition.abort();
    };
  });

  async function copy() {
    if (!definition.data) return;
    try {
      await navigator.clipboard.writeText(definition.data.definition);
      copyState = 'done';
    } catch {
      copyState = 'failed';
    }
  }
</script>

<section class="overview-panel" aria-label={t('overview.definitionTitle')} data-testid="definition">
  <div class="panel-heading">
    <div class="query-tab">
      <FileCode size={17} /><strong>{t('overview.definitionTitle')}</strong>
      {#if object}<Badge variant="secondary">{object.name}</Badge>{/if}
    </div>
  </div>
  {#if !connection || !object}
    <p class="catalog-message">{t('server.noConnection')}</p>
  {:else}
    {#if capabilities.error}
      <ErrorPanel
        message={capabilities.error}
        onretry={() => load(connection, token, { schema: object.schema, name: object.name })}
      />
    {/if}
    {#if cap && cap.support !== 'supported'}
      <CapabilityNotice
        title={cap.support === 'unsupported'
          ? t('overview.unsupportedTitle')
          : t('overview.limitedTitle')}
        reason={cap.reason ?? t('shared.unsupportedReason')}
      />
    {/if}
    {#if definition.busy}<p class="catalog-message" role="status">{t('overview.loading')}</p>{/if}
    {#if definition.error}
      <ErrorPanel
        title={t('overview.definitionFailedTitle')}
        message={definition.error}
        onretry={() => load(connection, token, { schema: object.schema, name: object.name })}
      />
    {/if}
    {#if definition.data}
      {@const data = definition.data}
      {#if data.derived}
        <p class="warning-feedback definition-note" role="note" data-testid="definition-derived">
          <strong>{t('overview.derivedTitle')}</strong>
          {data.notice ?? t('overview.derivedNotice')}
        </p>
        {#if data.warnings.length}
          <ul class="definition-warnings">
            {#each data.warnings as warning, index (index)}<li>{warning}</li>{/each}
          </ul>
        {/if}
      {/if}
      <div class="definition-actions">
        <Button variant="outline" size="sm" onclick={copy} data-testid="copy-definition"
          ><Copy size={14} />{t('overview.copy')}</Button
        >
        <span role="status" data-testid="copy-state"
          >{copyState === 'done'
            ? t('overview.copied')
            : copyState === 'failed'
              ? t('overview.copyFailed')
              : ''}</span
        >
      </div>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <pre
        class="definition-code"
        tabindex="0"
        aria-label={t('overview.definitionCode')}
        data-testid="definition-text">{data.definition}</pre>
    {/if}
  {/if}
</section>

<style>
  .definition-note {
    margin: 12px 16px;
    padding: 10px 12px;
    border-radius: 6px;
    font-size: 11px;
    line-height: 1.6;
  }
  .definition-warnings {
    margin: 0 16px 8px 32px;
    font-size: 11px;
    color: #9b7339;
  }
  .definition-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 16px;
    font-size: 11px;
  }
  .definition-code {
    margin: 8px 16px 16px;
    padding: 12px;
    max-height: 480px;
    overflow: auto;
    white-space: pre;
    border: 1px solid #e5ebf3;
    border-radius: 6px;
    background: #f9fbfe;
    font-size: 11px;
    line-height: 1.55;
    user-select: text;
  }
</style>
