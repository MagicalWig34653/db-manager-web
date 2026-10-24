<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { Table2 } from '@lucide/svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import CapabilityNotice from '$lib/components/shared/CapabilityNotice.svelte';
  import ErrorPanel from '$lib/components/shared/ErrorPanel.svelte';
  import { t } from '$lib/i18n';
  import type { FeatureProps } from '$lib/features';
  import { formatRoute } from '$lib/shell/router';
  import {
    arrangeObjects,
    driverCapability,
    formatBytes,
    overviewClient,
    rowsDisplay,
    type ObjectFilter,
    type ObjectInfo,
    type ObjectSort,
    type ObjectsResult,
    type OverviewCapabilities,
  } from './client';
  import { Resource } from './resource.svelte';

  let { connection, token, database }: FeatureProps = $props();

  const capabilities = new Resource<OverviewCapabilities>();
  const objects = new Resource<ObjectsResult>();
  let more = $state<ObjectInfo[]>([]);
  let loadingMore = $state(false);
  let moreError = $state('');
  let text = $state('');
  let kind = $state<ObjectFilter['kind']>('all');
  let sort = $state<ObjectSort>('name');
  let descending = $state(false);
  const EXACT_LIMIT = 100;
  const EXACT_TIMEOUT_MS = 8000;

  // MySQL and MariaDB list the connected database; PostgreSQL lists all user schemas.
  const schemaOf = (draft: NonNullable<typeof connection>) =>
    draft.driver === 'mysql' ? draft.database : undefined;

  const objectsCap = $derived(
    connection && capabilities.data
      ? driverCapability(capabilities.data, connection, 'objects')
      : null,
  );
  const exactCap = $derived(
    connection && capabilities.data
      ? driverCapability(capabilities.data, connection, 'exact_rows')
      : null,
  );
  const all = $derived([...(objects.data?.objects ?? []), ...more]);
  const arranged = $derived(arrangeObjects(all, { text, kind }, sort, descending));
  const isExact = $derived(objects.data?.exact_requested === true);
  const showSchema = $derived(connection?.driver === 'postgresql');

  async function load(current: NonNullable<typeof connection>, secret: string, exact = false) {
    more = [];
    moreError = '';
    if (!exact) {
      capabilities.reset();
      const caps = await capabilities.run(
        (signal) => overviewClient.capabilities(secret, signal),
        t('overview.loadFailed'),
      );
      if (!caps) return;
      if (driverCapability(caps, current, 'objects').support === 'unsupported') {
        objects.reset();
        return;
      }
    }
    await objects.run(
      (signal) =>
        overviewClient.objects(
          current,
          secret,
          {
            schema: schemaOf(current),
            ...(exact ? { exactRows: true, limit: EXACT_LIMIT, timeoutMs: EXACT_TIMEOUT_MS } : {}),
          },
          signal,
        ),
      t('overview.objectsFailed'),
      { keep: exact },
    );
  }

  async function loadMore() {
    const source = connection;
    const base = objects.data;
    if (!source || !base) return;
    loadingMore = true;
    moreError = '';
    try {
      const next = await overviewClient.objects(source, token, {
        schema: schemaOf(source),
        offset: all.length,
      });
      if (source === connection && base === objects.data) more = [...more, ...next.objects];
    } catch (cause) {
      if (source === connection)
        moreError = cause instanceof Error ? cause.message : t('overview.objectsFailed');
    } finally {
      loadingMore = false;
    }
  }

  $effect(() => {
    const current = connection;
    const secret = token;
    if (!current) return;
    untrack(() => void load(current, secret));
    return () => {
      capabilities.abort();
      objects.abort();
    };
  });

  function sortBy(column: ObjectSort) {
    if (sort === column) descending = !descending;
    else {
      sort = column;
      descending = false;
    }
  }
  const ariaSort = (column: ObjectSort) =>
    sort === column ? (descending ? 'descending' : 'ascending') : 'none';
  const shown = (value: string | null) => value ?? '';
  const kindNames: Record<string, string> = {
    table: t('overview.kindTable'),
    view: t('overview.kindView'),
    virtual: t('overview.kindVirtual'),
    materialized_view: t('overview.kindMaterialized'),
    foreign_table: t('overview.kindForeign'),
  };
  const kindName = (value: string) => kindNames[value] ?? value;
  const route = (object: ObjectInfo, tab: string) =>
    formatRoute({
      kind: 'table',
      database: database ?? connection?.database ?? '',
      ...(object.schema ? { schema: object.schema } : {}),
      table: object.name,
      tab,
    });
</script>

{#snippet header(column: ObjectSort, label: string)}
  <th scope="col" aria-sort={ariaSort(column)}>
    <button type="button" class="sort-button" onclick={() => sortBy(column)}>
      {label}<span aria-hidden="true">{sort === column ? (descending ? ' ▼' : ' ▲') : ''}</span>
    </button>
  </th>
{/snippet}

<section class="overview-panel" aria-label={t('overview.title')} data-testid="objects-overview">
  <div class="panel-heading">
    <div class="query-tab">
      <Table2 size={17} /><strong>{t('overview.title')}</strong>
      {#if database}<Badge variant="secondary">{database}</Badge>{/if}
    </div>
  </div>

  {#if !connection}
    <p class="catalog-message">{t('server.noConnection')}</p>
  {:else}
    {#if capabilities.error}
      <ErrorPanel message={capabilities.error} onretry={() => load(connection, token)} />
    {/if}
    {#if objectsCap && objectsCap.support !== 'supported'}
      <CapabilityNotice
        title={objectsCap.support === 'unsupported'
          ? t('overview.unsupportedTitle')
          : t('overview.limitedTitle')}
        reason={objectsCap.reason ?? t('shared.unsupportedReason')}
      />
    {/if}
    {#if objects.busy || capabilities.busy}
      <p class="catalog-message" role="status">{t('overview.loading')}</p>
    {/if}
    {#if objects.error}
      <ErrorPanel
        title={t('overview.objectsFailedTitle')}
        message={objects.error}
        onretry={() => load(connection, token)}
      />
    {/if}

    {#if objects.data}
      <div class="overview-controls">
        <label>
          <span>{t('overview.filter')}</span>
          <input
            type="search"
            class="overview-input"
            bind:value={text}
            placeholder={t('overview.filterPlaceholder')}
            autocomplete="off"
            data-testid="objects-filter"
          />
        </label>
        <label>
          <span>{t('overview.kindFilter')}</span>
          <select class="overview-input" bind:value={kind} data-testid="objects-kind">
            <option value="all">{t('overview.kindAll')}</option>
            <option value="table">{t('overview.kindTable')}</option>
            <option value="view">{t('overview.kindView')}</option>
            <option value="other">{t('overview.kindOther')}</option>
          </select>
        </label>
        {#if exactCap && exactCap.support !== 'unsupported'}
          <Button
            variant="outline"
            size="sm"
            onclick={() => load(connection, token, true)}
            disabled={objects.busy}
            data-testid="count-exact">{t('overview.countExact')}</Button
          >
        {/if}
      </div>
      {#if exactCap?.support === 'limited' && exactCap.reason}
        <p class="catalog-message">{exactCap.reason}</p>
      {/if}

      {#if isExact && objects.data.exact_incomplete}
        <p class="limit-note" role="status" data-testid="exact-incomplete">
          {t('overview.exactIncomplete')}
        </p>
      {:else if isExact}
        <p class="limit-note" role="status" data-testid="exact-done">
          {objects.data.total > all.length
            ? t('overview.exactPartial', { n: all.length })
            : t('overview.exactDone')}
        </p>
      {:else}
        <p class="catalog-message" data-testid="estimate-hint">{t('overview.estimateHint')}</p>
      {/if}

      {#if all.length === 0}
        <p class="catalog-message">{t('overview.noObjects')}</p>
      {:else}
        <div class="table-scroll">
          <table class="result-table" data-testid="objects-table">
            <caption class="sr-only">{t('overview.title')}</caption>
            <thead>
              <tr>
                {@render header('name', t('overview.colName'))}
                {@render header('kind', t('overview.colKind'))}
                {@render header('rows', t('overview.colRows'))}
                {@render header('engine', t('overview.colEngine'))}
                {@render header('collation', t('overview.colCollation'))}
                {@render header('size', t('overview.colSize'))}
                <th scope="col">{t('overview.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {#each arranged as object (object.schema + '\u0000' + object.name)}
                {@const rows = rowsDisplay(object.rows)}
                <tr>
                  <th scope="row" title={object.comment ?? undefined}>
                    <a href={route(object, 'daten')}
                      >{showSchema ? `${object.schema}.` : ''}{object.name}</a
                    >
                  </th>
                  <td>
                    <Badge
                      variant={object.kind === 'table' ? 'secondary' : 'outline'}
                      data-testid="object-kind">{kindName(object.kind)}</Badge
                    >
                  </td>
                  <td class="numeric" data-testid="row-count" data-state={rows.state}>
                    {#if rows.state === 'unknown'}
                      <span title={t('overview.rowsUnknownHint')}>{t('overview.unknown')}</span>
                    {:else if rows.state === 'estimated'}
                      <span title={t('overview.rowsEstimatedHint')}>≈ {rows.text}</span>
                      <Badge variant="outline">{t('overview.estimated')}</Badge>
                    {:else}
                      {rows.text} <Badge variant="secondary">{t('overview.exact')}</Badge>
                    {/if}
                  </td>
                  <td>{shown(object.engine)}</td>
                  <td>{shown(object.collation)}</td>
                  <td class="numeric">{formatBytes(object.size_bytes)}</td>
                  <td><a href={route(object, 'definition')}>{t('overview.showDefinition')}</a></td>
                </tr>
              {:else}
                <tr><td colspan="7">{t('overview.noMatch')}</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
      {#if objects.data.total > all.length}
        <p class="limit-note" data-testid="objects-limit">
          {t('overview.limitNote', { shown: all.length, total: objects.data.total })}
          {#if !isExact}<Button
              variant="outline"
              size="sm"
              onclick={loadMore}
              disabled={loadingMore}>{t('overview.loadMore')}</Button
            >{/if}
        </p>
      {/if}
      {#if moreError}<p class="error-text catalog-message" role="alert">{moreError}</p>{/if}
    {/if}
  {/if}
</section>

<style>
  .overview-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: flex-end;
    padding: 12px 16px;
  }
  .overview-controls label {
    display: grid;
    gap: 4px;
    font-size: 11px;
    color: #62738f;
  }
  .overview-input {
    min-width: 0;
    border: 1px solid #d9e2ee;
    border-radius: 6px;
    padding: 6px 8px;
    font-size: 12px;
    background: white;
  }
  .sort-button {
    border: 0;
    background: transparent;
    font: inherit;
    color: inherit;
    padding: 0;
    cursor: pointer;
  }
  .result-table th[scope='row'] {
    text-align: left;
    font-weight: 500;
  }
  .result-table td {
    white-space: normal;
  }
  .numeric {
    text-align: right;
  }
</style>
