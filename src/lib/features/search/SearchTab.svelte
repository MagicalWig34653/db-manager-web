<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { toConnection, apiDriver } from '$lib/api';
  import type { FeatureProps } from '$lib/features';
  import { t } from '$lib/i18n';
  import { tables } from '$lib/tables';
  import { displayCell } from '$lib/workbench';
  import { overviewClient, type ObjectInfo } from '$lib/features/overview/client';
  import { formatRoute } from '$lib/shell/router';
  import { searchClient, searchError } from './client';
  import { Resource } from './resource.svelte';
  import {
    modes,
    modeLabel,
    textColumns,
    validText,
    type Schemas,
    type Target,
    type Mode,
  } from './model';
  import Highlight from './Highlight.svelte';
  let { connection, token, database }: FeatureProps = $props();
  const setup = new Resource<Schemas['SearchCapabilities']>();
  const results = new Resource<Schemas['SearchResult']>();
  let objects = $state<ObjectInfo[]>([]);
  let total = $state(0);
  let catalogBusy = $state(false);
  let catalogError = $state('');
  let selected = $state<{ target: Target; available: string[] }[]>([]);
  let term = $state('');
  let mode = $state<Mode>('substring');
  let maxRows = $state(100);
  let previewRows = $state(5);
  let timeout = $state(10000);
  let submitted = $state({ term: '', mode: 'substring' as Mode });
  let generation = 0;
  let controller: AbortController | null = null;
  const support = $derived(
    connection && setup.data ? setup.data.drivers[apiDriver(connection.driver)] : null,
  );
  const available = $derived(
    !!setup.data?.features.includes('search') && !!support?.search_modes.length,
  );
  const valid = $derived(
    validText(term) &&
      (mode !== 'all_words' || term.trim().split(/\s+/).length <= 32) &&
      support?.search_modes.includes(mode) &&
      selected.length > 0 &&
      selected.every((item) => item.target.columns.length > 0) &&
      Number.isInteger(maxRows) &&
      maxRows >= 1 &&
      maxRows <= 1000 &&
      Number.isInteger(previewRows) &&
      previewRows >= 1 &&
      previewRows <= 20 &&
      Number.isInteger(timeout) &&
      timeout >= 1 &&
      timeout <= 10000,
  );
  const ref = (object: ObjectInfo) => ({
    ...(object.schema ? { schema: object.schema } : {}),
    name: object.name,
  });
  const key = (table: Schemas['TableRef']) => JSON.stringify([table.schema, table.name]);
  $effect(() => {
    const current = connection;
    const secret = token;
    database;
    untrack(() => {
      generation++;
      controller?.abort();
      controller = new AbortController();
      objects = [];
      total = 0;
      selected = [];
      term = '';
      mode = 'substring';
      maxRows = 100;
      previewRows = 5;
      timeout = 10000;
      results.reset();
      setup.reset();
      catalogError = '';
      catalogBusy = false;
      if (current)
        void setup.run(async (signal) => {
          const caps = await searchClient.capabilities(secret, signal);
          return caps;
        });
    });
    return () => {
      generation++;
      controller?.abort();
      setup.abort();
      results.abort();
    };
  });
  async function loadObjects() {
    if (!connection || catalogBusy) return;
    const current = generation;
    const signal = controller!.signal;
    catalogBusy = true;
    catalogError = '';
    try {
      const data = await overviewClient.objects(
        connection,
        token,
        {
          limit: 200,
          offset: objects.length,
          ...(connection.driver === 'mysql' ? { schema: connection.database } : {}),
        },
        signal,
      );
      if (current !== generation) return;
      objects = [...objects, ...data.objects];
      total = data.total;
    } catch (cause) {
      if (current === generation) catalogError = searchError(cause);
    } finally {
      if (current === generation) catalogBusy = false;
    }
  }
  $effect(() => {
    if (setup.data && available) untrack(() => void loadObjects());
  });
  async function select(object: ObjectInfo) {
    const table = ref(object);
    const existing = selected.find((item) => key(item.target.table) === key(table));
    if (existing) {
      selected = selected.filter((item) => item !== existing);
      return;
    }
    if (!connection || selected.length >= 20 || catalogBusy) return;
    const current = generation;
    catalogBusy = true;
    catalogError = '';
    try {
      const data = await tables.describe(
        { connection: toConnection(connection), table },
        token,
        controller!.signal,
      );
      if (current !== generation) return;
      const columns = data.kind === 'table' ? textColumns(data).map((column) => column.name) : [];
      selected = [
        ...selected,
        { target: { table, columns: columns.slice(0, 32) }, available: columns },
      ];
    } catch (cause) {
      if (current === generation) catalogError = searchError(cause);
    } finally {
      if (current === generation) catalogBusy = false;
    }
  }
  function toggleColumn(index: number, column: string) {
    const item = selected[index];
    const columns = item.target.columns;
    selected = selected.map((value, i) =>
      i === index
        ? {
            ...value,
            target: {
              ...value.target,
              columns: columns.includes(column)
                ? columns.filter((name) => name !== column)
                : [...columns, column],
            },
          }
        : value,
    );
  }
  async function search() {
    if (!connection || !valid || results.busy) return;
    const body = {
      connection: toConnection(connection),
      targets: selected.map((item) => ({
        table: { ...item.target.table },
        columns: [...item.target.columns],
      })),
      term,
      mode,
      max_rows: maxRows,
      preview_rows: previewRows,
      timeout_ms: timeout,
    };
    submitted = { term, mode };
    await results.run((signal) => searchClient.search(body, token, signal));
  }
</script>

<section class="search-panel" aria-label={t('search.tab')}>
  <h2>{t('search.tab')}</h2>
  {#if setup.busy}<p role="status">{t('search.loading')}</p>{/if}
  {#if setup.error}<p role="alert">{setup.error}</p>{/if}
  {#if setup.data && !available}<p>{t('search.unsupported')}</p>{/if}
  {#if support?.reason}<p>{support.reason}</p>{/if}
  {#if available}
    <p>{t('search.searchHint')}</p>
    <fieldset disabled={results.busy}>
      <legend>{t('search.targets')}</legend>
      {#each objects.filter((object) => object.kind === 'table') as object, index (index)}
        {@const table = ref(object)}
        <button
          type="button"
          aria-pressed={selected.some((item) => key(item.target.table) === key(table))}
          disabled={catalogBusy ||
            (!selected.some((item) => key(item.target.table) === key(table)) &&
              selected.length >= 20)}
          onclick={() => select(object)}
          >{object.schema ? `${object.schema}.` : ''}{object.name}</button
        >
      {/each}
      {#if objects.length < total}<button onclick={loadObjects} disabled={catalogBusy}
          >{t('search.more')}</button
        >{/if}
      {#each selected as item, index (key(item.target.table))}
        <fieldset>
          <legend>{item.target.table.name}</legend>
          {#each item.available as column, i (i)}
            <label
              ><input
                type="checkbox"
                checked={item.target.columns.includes(column)}
                disabled={!item.target.columns.includes(column) && item.target.columns.length >= 32}
                onchange={() => toggleColumn(index, column)}
              />{column}</label
            >
          {:else}<p>{t('search.noColumns')}</p>{/each}
        </fieldset>
      {/each}
      <label>{t('search.term')}<input bind:value={term} autocomplete="off" /></label>
      <label
        >{t('search.mode')}<select bind:value={mode}
          >{#each modes as option}<option
              value={option}
              disabled={!support?.search_modes.includes(option)}>{modeLabel(option)}</option
            >{/each}</select
        ></label
      >
      <label
        >{t('search.maxRows')}<input type="number" min="1" max="1000" bind:value={maxRows} /></label
      >
      <label
        >{t('search.previewRows')}<input
          type="number"
          min="1"
          max="20"
          bind:value={previewRows}
        /></label
      >
      <label
        >{t('search.timeout')}<input
          type="number"
          min="1"
          max="10000"
          bind:value={timeout}
        /></label
      >
      <button onclick={search} disabled={!valid || catalogBusy}>{t('search.run')}</button>
    </fieldset>
    {#if catalogBusy}<p role="status">{t('search.loading')}</p>{/if}
    {#if catalogError}<p role="alert">{catalogError}</p>{/if}
    {#if results.busy}<button onclick={() => results.abort()}>{t('search.abort')}</button>{/if}
    {#if results.error}<p role="alert">{results.error}</p>{/if}
    {#if results.data}
      <p>{t('search.previewHint')}</p>
      {#each results.data.tables as table, index (index)}
        <article data-testid="search-result">
          <h3>{table.table.schema ? `${table.table.schema}.` : ''}{table.table.name}</h3>
          <p>
            {t(table.count_exact ? 'search.countExact' : 'search.countLower', {
              count: table.count,
            })}
          </p>
          <a
            href={formatRoute({
              kind: 'table',
              database: database ?? connection?.database ?? '',
              ...table.table,
              table: table.table.name,
              tab: 'daten',
            })}>{t('search.openTable')}</a
          >
          <!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable table needs a keyboard focus target.) -->
          <div
            class="table-scroll"
            role="region"
            tabindex="0"
            aria-label={`${t('search.resultRows')}: ${table.table.name}`}
          >
            <table class="result-table">
              <thead
                ><tr
                  >{#each table.columns as column, i (i)}<th>{column}</th>{/each}</tr
                ></thead
              >
              <tbody
                >{#each table.rows as row, i (i)}<tr
                    >{#each row as cell, j (j)}<td
                        ><Highlight
                          value={displayCell(cell)}
                          term={submitted.term}
                          mode={submitted.mode}
                        /></td
                      >{/each}</tr
                  >{/each}</tbody
              >
            </table>
          </div>
        </article>
      {/each}
    {/if}
  {/if}
</section>

<style>
  .search-panel {
    padding: 16px;
    min-width: 0;
  }
  fieldset {
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin: 10px 0;
  }
  label {
    display: grid;
    gap: 4px;
    max-width: 100%;
  }
  input,
  select {
    max-width: 100%;
    min-width: 0;
  }
  td {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  button {
    white-space: normal;
    overflow-wrap: anywhere;
  }
  article {
    min-width: 0;
  }
  h3 {
    overflow-wrap: anywhere;
  }
</style>
