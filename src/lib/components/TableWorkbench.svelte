<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    ArrowLeft,
    ArrowRight,
    Plus,
    RefreshCw,
    Square,
    Table2,
    TriangleAlert,
    X,
  } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { t } from '$lib/i18n';
  import { rememberColumns } from '$lib/features/sql-editor/catalog-hints.svelte';
  import StructurePanel from './StructurePanel.svelte';
  import RowWorkspace from './RowWorkspace.svelte';
  import type { WritePhase } from '$lib/rows';
  import { toConnection, ApiError } from '$lib/api';
  import {
    tables,
    tableResult,
    prepareFilters,
    validateTable,
    emptyFilter,
    type TableDescription,
    type BrowseResult,
    type FilterDraft,
    type TableSort,
    type TableFilter,
  } from '$lib/tables';
  import type { ConnectionDraft, CatalogObject } from '$lib/workbench';
  let {
    connection,
    token,
    object,
    onsql,
    onwritephase,
  }: {
    connection: ConnectionDraft;
    token: string;
    object: CatalogObject;
    onsql: () => void;
    onwritephase: (phase: WritePhase) => void;
  } = $props();
  let description = $state<TableDescription | null>(null);
  let result = $state<BrowseResult | null>(null);
  let busy = $state(false);
  let writing = $state(false);
  let error = $state('');
  let cancelled = $state(false);
  let unsupported = $state(false);
  let tab = $state<'data' | 'structure'>('data');
  let pageSize = $state(100);
  let filters = $state<FilterDraft[]>([]);
  let sort = $state<TableSort[]>([]);
  let appliedQuery = $state({
    filters: [] as TableFilter[],
    sort: [] as TableSort[],
    pageSize: 100,
    snapshot: JSON.stringify({ filters: [], sort: [], pageSize: 100 }),
  });
  let version = 0;
  let destroyed = false;
  let controller = new AbortController();
  const dirty = $derived(JSON.stringify({ filters, sort, pageSize }) !== appliedQuery.snapshot);
  const display = $derived(result ? tableResult(result) : null);
  const table = $derived({
    name: object.name,
    ...(object.schema ? { schema: object.schema } : {}),
  });
  const generatedNames = {
    none: 'tableView.genNone',
    virtual: 'tableView.genVirtual',
    stored: 'tableView.genStored',
    identity: 'tableView.genIdentity',
    hidden: 'tableView.genHidden',
  };
  const kindNames = {
    table: 'tableView.kindTable',
    view: 'tableView.kindView',
    virtual: 'tableView.kindVirtual',
    foreign: 'tableView.kindForeign',
  };
  // Columns that are loaded anyway feed SQL completion; no extra request is made for it.
  function remember(loaded: TableDescription) {
    rememberColumns(
      connection,
      object,
      loaded.columns.map((column) => column.name),
    );
  }
  async function initialize() {
    const current = ++version;
    busy = true;
    try {
      await tables.capabilities(token, controller.signal);
      const metadata = await tables.describe(
        { connection: toConnection(connection), table },
        token,
        controller.signal,
      );
      if (destroyed || current !== version) return;
      description = metadata;
      remember(metadata);
      await loadPage(0);
    } catch (cause) {
      if (!destroyed && current === version) {
        if (controller.signal.aborted) cancelled = true;
        else {
          unsupported = cause instanceof ApiError && cause.code === 'unsupported_feature';
          error = cause instanceof Error ? cause.message : t('tableView.openFailed');
        }
      }
    } finally {
      if (!destroyed && current === version) busy = false;
    }
  }
  async function loadPage(offset: number) {
    controller.abort();
    controller = new AbortController();
    const request = controller;
    const current = ++version;
    busy = true;
    error = '';
    cancelled = false;
    result = null;
    try {
      const loaded = await tables.browse(
        {
          connection: toConnection(connection),
          table,
          page_size: appliedQuery.pageSize,
          offset,
          sort: appliedQuery.sort,
          filters: appliedQuery.filters,
          timeout_ms: 10000,
        },
        token,
        request.signal,
      );
      if (destroyed || current !== version) return;
      description = loaded.description;
      remember(loaded.description);
      result = loaded;
    } catch (cause) {
      if (!destroyed && current === version) {
        if (request.signal.aborted) cancelled = true;
        else {
          unsupported = cause instanceof ApiError && cause.code === 'unsupported_feature';
          error = cause instanceof Error ? cause.message : t('tableView.rowsFailed');
        }
      }
    } finally {
      if (!destroyed && current === version) busy = false;
    }
  }
  function apply() {
    if (!description || busy || writing) return;
    try {
      const nextFilters = prepareFilters(
        filters,
        description.columns.map((column) => column.name),
      );
      if (
        sort.some((order) => !description!.columns.some((column) => column.name === order.column))
      )
        throw new Error(t('tableView.pickSortColumns'));
      if (new Set(sort.map((order) => order.column)).size !== sort.length)
        throw new Error(t('tableView.sortOnce'));
      const nextSort = sort.map((order) => ({ ...order }));
      const nextPageSize = pageSize;
      if (!Number.isInteger(nextPageSize) || nextPageSize < 1 || nextPageSize > 1000)
        throw new Error(t('tableView.pageSizeRange'));
      validateTable('BrowseRequest', {
        connection: toConnection(connection),
        table,
        offset: 0,
        filters: nextFilters,
        sort: nextSort,
        page_size: nextPageSize,
        timeout_ms: 10000,
      });
      const nextQuery = {
        filters: nextFilters,
        sort: nextSort,
        pageSize: nextPageSize,
        snapshot: JSON.stringify({ filters, sort, pageSize }),
      };
      appliedQuery = nextQuery;
      void loadPage(0);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : t('tableView.checkFilters');
    }
  }
  onMount(() => {
    void initialize();
  });
  onDestroy(() => {
    destroyed = true;
    version++;
    controller.abort();
  });
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === 'Escape' && busy) controller.abort();
  }}
/>
<section
  id="table-workspace"
  tabindex="-1"
  class="table-workspace"
  aria-label={t('tableView.workspace')}
  aria-busy={busy}
>
  <div class="table-heading">
    <div>
      <p class="eyebrow">{description ? t(kindNames[description.kind]) : t('tableView.object')}</p>
      <h2><Table2 size={20} />{object.schema ? `${object.schema}.` : ''}{object.name}</h2>
      <p>{t('tableView.rowActionsNote')}</p>
    </div>
    <Button
      variant="outline"
      disabled={writing || busy || !description || dirty}
      onclick={() => loadPage(result?.offset ?? 0)}
      ><RefreshCw size={15} />{t('tableView.refresh')}</Button
    >
  </div>
  {#if description}
    <div class="table-facts">
      <span
        >{t('tableView.primaryKey', {
          value: description.primary_key.length
            ? description.primary_key.join(', ')
            : t('tableView.none'),
        })}</span
      ><span
        >{t('tableView.transactions', {
          value:
            description.transactional === 'yes'
              ? t('tableView.supported')
              : description.transactional === 'no'
                ? t('tableView.unsupported')
                : t('tableView.notReported'),
        })}</span
      ><span
        >{t('tableView.storage', {
          value: description.storage_engine || t('tableView.notReported'),
        })}</span
      >
    </div>
    <div class="table-tabs" role="tablist" aria-label={t('tableView.tabArea')}>
      <button role="tab" aria-selected={tab === 'data'} onclick={() => (tab = 'data')}
        >{t('tableView.tabData')}</button
      ><button role="tab" aria-selected={tab === 'structure'} onclick={() => (tab = 'structure')}
        >{t('tableView.tabStructure', { count: description.columns.length })}</button
      >
    </div>
    {#if tab === 'structure'}
      <div class="metadata-scroll" role="region" aria-label={t('tableView.structureRegion')}>
        <table class="metadata-table">
          <thead
            ><tr
              ><th>{t('tableView.thColumn')}</th><th>{t('tableView.thType')}</th><th
                >{t('tableView.thNullable')}</th
              ><th>{t('tableView.thDefault')}</th><th>{t('tableView.thPk')}</th><th
                >{t('tableView.thGenerated')}</th
              ><th>{t('tableView.thAccess')}</th></tr
            ></thead
          ><tbody
            >{#each description.columns as column}<tr
                ><th scope="row">{column.name}</th><td
                  >{column.database_type || t('tableView.notReported')}</td
                ><td>{column.nullable ? t('tableView.yes') : t('tableView.no')}</td><td
                  ><code
                    >{column.default_value === undefined
                      ? t('tableView.notReported')
                      : column.default_value === ''
                        ? '""'
                        : column.default_value}</code
                  ></td
                ><td>{column.pk_position || '–'}</td><td>{t(generatedNames[column.generated])}</td
                ><td>{column.read_only ? t('tableView.readOnly') : t('tableView.notReported')}</td
                ></tr
              >{/each}</tbody
          >
        </table>
      </div>
      <StructurePanel {connection} {table} {token} />
    {:else}
      <form
        class="table-controls"
        onsubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <details>
          <summary
            >{t('tableView.sortFilter', {
              counts: filters.length || sort.length ? `(${sort.length} / ${filters.length})` : '',
            })}</summary
          >
          <fieldset disabled={writing || busy}>
            <legend>{t('tableView.legendSort')}</legend>
            {#each sort as order, index}<div class="sort-row">
                <label
                  >{t('tableView.sortColumn', { n: index + 1 })}<select bind:value={order.column}
                    >{#each description.columns as column}<option value={column.name}
                        >{column.name}</option
                      >{/each}</select
                  ></label
                ><label
                  >{t('tableView.direction', { n: index + 1 })}<select bind:value={order.direction}
                    ><option value="asc">{t('tableView.asc')}</option><option value="desc"
                      >{t('tableView.desc')}</option
                    ></select
                  ></label
                ><Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('tableView.removeSort', { n: index + 1 })}
                  onclick={() => (sort = sort.filter((_, i) => i !== index))}
                  ><X size={15} /></Button
                >
              </div>{/each}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={sort.length >= 16 || !description.columns.length}
              onclick={() =>
                (sort = [
                  ...sort,
                  {
                    column:
                      description!.columns.find(
                        (column) => !sort.some((order) => order.column === column.name),
                      )?.name ?? description!.columns[0].name,
                    direction: 'asc',
                  },
                ])}><Plus size={14} />{t('tableView.addSort')}</Button
            >
          </fieldset>
          <fieldset disabled={writing || busy}>
            <legend>{t('tableView.legendFilter')}</legend>
            {#each filters as filter, index}<div class="filter-row">
                <label
                  >{t('tableView.filterColumn', { n: index + 1 })}<select bind:value={filter.column}
                    >{#each description.columns as column}<option value={column.name}
                        >{column.name}</option
                      >{/each}</select
                  ></label
                ><label
                  >{t('tableView.condition', { n: index + 1 })}<select bind:value={filter.operator}
                    ><option value="eq">{t('tableView.opEq')}</option><option value="is_null"
                      >{t('tableView.opNull')}</option
                    ><option value="is_not_null">{t('tableView.opNotNull')}</option></select
                  ></label
                >{#if filter.operator === 'eq'}<label
                    >{t('tableView.valueType', { n: index + 1 })}<select bind:value={filter.kind}
                      ><option value="text">{t('tableView.kindText')}</option><option
                        value="integer">{t('tableView.kindInteger')}</option
                      ><option value="decimal">{t('tableView.kindDecimal')}</option><option
                        value="float">{t('tableView.kindFloat')}</option
                      ><option value="boolean">{t('tableView.kindBoolean')}</option><option
                        value="binary">{t('tableView.kindBinary')}</option
                      ><option value="timestamp">{t('tableView.kindTimestamp')}</option></select
                    ></label
                  ><label
                    >{t('tableView.filterValue', { n: index + 1 })}<Input
                      bind:value={filter.value}
                      placeholder={filter.kind === 'boolean'
                        ? t('tableView.phBoolean')
                        : filter.kind === 'text'
                          ? t('tableView.phText')
                          : t('tableView.phValue')}
                    /></label
                  >{/if}<Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('tableView.removeFilter', { n: index + 1 })}
                  onclick={() => (filters = filters.filter((_, i) => i !== index))}
                  ><X size={15} /></Button
                >
              </div>{/each}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={filters.length >= 16 || !description.columns.length}
              onclick={() => (filters = [...filters, emptyFilter(description!.columns[0].name)])}
              ><Plus size={14} />{t('tableView.addFilter')}</Button
            >
          </fieldset>
          <p class="control-hint">
            {t('tableView.hint')}
          </p>
        </details>
        <div class="table-actions">
          <label
            >{t('tableView.pageSize')}<select bind:value={pageSize} disabled={writing || busy}
              ><option value={25}>25</option><option value={100}>100</option><option value={500}
                >500</option
              ><option value={1000}>1.000</option></select
            ></label
          ><Button type="submit" disabled={writing || busy}>{t('tableView.apply')}</Button
          >{#if dirty}<span class="control-hint">{t('tableView.dirty')}</span>{/if}
        </div>
      </form>
      {#if result && display}<RowWorkspace
          {connection}
          {token}
          {result}
          onreload={() => loadPage(result?.offset ?? 0)}
          onwritephase={(phase) => {
            writing = phase === 'sending';
            onwritephase(phase);
          }}
        />
        <div class="pagination" aria-label={t('tableView.pagination')}>
          <span
            >{result.result.rows.length
              ? t('tableView.rowsRange', {
                  from: result.offset + 1,
                  to: result.offset + result.result.rows.length,
                })
              : t('tableView.noRows')} · {t('tableView.totalUnknown')}</span
          >
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={writing || busy || dirty || result.offset === 0}
              onclick={() => loadPage(Math.max(0, result!.offset - result!.page_size))}
              ><ArrowLeft size={14} />{t('tableView.prev')}</Button
            ><Button
              variant="outline"
              size="sm"
              disabled={writing ||
                busy ||
                dirty ||
                !result.has_more ||
                result.offset + result.page_size > 1000000}
              onclick={() => loadPage(result!.offset + result!.page_size)}
              >{t('tableView.next')}<ArrowRight size={14} /></Button
            >
          </div>
        </div>
        {#if !result.stable_order}<p class="table-warning">
            <TriangleAlert size={15} />{t('tableView.unstable')}
          </p>{:else}<p class="control-hint">
            {t('tableView.stable')}
          </p>{/if}
        {#if result.has_more}<p class="control-hint">
            {t('tableView.more')}{result.offset + result.page_size > 1000000
              ? t('tableView.limitReached')
              : ''}
          </p>{/if}
        {#if result.result.truncated && !result.has_more}<p class="table-warning">
            {t('tableView.truncated')}
          </p>{/if}
      {/if}
    {/if}
  {/if}
  {#if busy}<div class="table-feedback" role="status">
      <p>{t('tableView.loading')}</p>
      <Button variant="outline" onclick={() => controller.abort()}
        ><Square size={14} />{t('tableView.abortLoad')}</Button
      >
    </div>{/if}
  {#if error}<div class="table-feedback table-error" role="alert">
      {error}{#if unsupported}<Button variant="outline" onclick={onsql}
          >{t('tableView.toSql')}</Button
        >{/if}
    </div>{/if}
  {#if cancelled}<div class="table-feedback" role="status">
      {t('tableView.cancelled')}
    </div>{/if}
</section>
