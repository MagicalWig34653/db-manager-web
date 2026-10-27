<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import AutoRefresh from '$lib/components/shared/AutoRefresh.svelte';
  import ErrorPanel from '$lib/components/shared/ErrorPanel.svelte';
  import { formatDecimal, formatStamp } from '$lib/format';
  import { t } from '$lib/i18n';
  import type { PollOutcome } from '$lib/poller';
  import { Resource } from '$lib/resource.svelte';
  import type { ConnectionDraft } from '$lib/workbench';
  import { serverAdminClient } from './client';
  import {
    AUTO_REFRESH_INTERVALS,
    FILTER_MAX_BYTES,
    formatSeconds,
    pageSizes,
    scopesFor,
    shownValue,
    utf8Bytes,
    type Kind,
    type ReadResult,
    type Scope,
  } from './model';

  let { kind, connection, token }: { kind: Kind; connection: ConnectionDraft; token: string } =
    $props();

  const list = new Resource<ReadResult>();
  let filterInput = $state('');
  let filter = $state('');
  let scope = $state<Scope>('SESSION');
  let limit = $state(100);
  let offset = $state(0);

  const tooLong = $derived(utf8Bytes(filterInput) > FILTER_MAX_BYTES);
  const scopes = $derived(scopesFor(connection.driver));
  const rows = $derived(list.data?.values ?? []);
  const processes = $derived(list.data?.processes ?? []);
  const count = $derived(kind === 'processes' ? processes.length : rows.length);
  const anyMasked = $derived(rows.some((row) => row.masked));

  async function load(): Promise<PollOutcome> {
    const result = await list.run(
      (signal) =>
        serverAdminClient.read(kind, connection, token, { limit, offset, filter, scope }, signal),
      t('serverAdmin.errGeneric'),
      { keep: true },
    );
    if (result) return { ok: true };
    return list.error ? { ok: false, code: list.errorCode } : { ok: true };
  }
  function restart() {
    offset = 0;
    void load();
  }
  function apply(event: SubmitEvent) {
    event.preventDefault();
    if (tooLong) return;
    filter = filterInput.trim();
    restart();
  }
  function page(delta: number) {
    offset = Math.max(0, offset + delta * limit);
    void load();
  }

  $effect(() => {
    void connection;
    void token;
    untrack(() => {
      list.reset();
      void load();
    });
    return () => list.abort();
  });
</script>

<form class="admin-controls" onsubmit={apply} role="search" aria-label={t('serverAdmin.filter')}>
  <label>
    <span>{kind === 'processes' ? t('serverAdmin.filterUser') : t('serverAdmin.filterName')}</span>
    <input
      type="search"
      class="admin-input"
      bind:value={filterInput}
      autocomplete="off"
      spellcheck="false"
      aria-invalid={tooLong}
      aria-describedby={tooLong ? `filter-error-${kind}` : undefined}
      data-testid="admin-filter"
    />
  </label>
  {#if kind === 'variables'}
    <label>
      <span>{t('serverAdmin.scope')}</span>
      <select
        class="admin-input"
        bind:value={scope}
        onchange={restart}
        data-testid="admin-scope"
        aria-describedby="scope-hint"
      >
        {#each scopes as option (option)}
          <option value={option}>{t(`serverAdmin.scope${option}`)}</option>
        {/each}
      </select>
    </label>
  {/if}
  <label>
    <span>{t('serverAdmin.pageSize')}</span>
    <select
      class="admin-input"
      value={String(limit)}
      onchange={(event) => {
        limit = Number(event.currentTarget.value);
        restart();
      }}
      data-testid="admin-limit"
    >
      {#each pageSizes as size (size)}<option value={String(size)}>{size}</option>{/each}
    </select>
  </label>
  <Button type="submit" variant="outline" size="sm" disabled={tooLong || list.busy}
    >{t('serverAdmin.apply')}</Button
  >
  <Button
    type="button"
    variant="outline"
    size="sm"
    onclick={() => void load()}
    disabled={list.busy}
    data-testid="admin-refresh">{t('serverAdmin.refresh')}</Button
  >
</form>
{#if tooLong}
  <p class="catalog-message error-text" id={`filter-error-${kind}`} role="alert">
    {t('serverAdmin.filterTooLong', { n: FILTER_MAX_BYTES })}
  </p>
{/if}
{#if kind === 'variables'}
  <p class="catalog-message" id="scope-hint">
    {connection.driver === 'postgresql'
      ? t('serverAdmin.scopePostgres')
      : t('serverAdmin.scopeHint')}
  </p>
{/if}
<div class="admin-auto">
  <AutoRefresh
    run={load}
    abort={() => list.abort()}
    intervals={AUTO_REFRESH_INTERVALS}
    testid="admin-auto-refresh"
  />
</div>

{#if list.busy && !list.data}
  <p class="catalog-message" role="status">{t('serverAdmin.loading')}</p>
{/if}
{#if list.error}
  <ErrorPanel title={t('serverAdmin.errTitle')} message={list.error} onretry={() => void load()} />
{/if}

{#if list.data}
  <p class="catalog-message" data-testid="admin-meta">
    {t('serverAdmin.sampledAt', { time: formatStamp(list.data.sampled_at) })}
    {#if list.busy}<span role="status">{t('serverAdmin.updating')}</span>{/if}
  </p>
  {#if kind === 'processes'}
    <p class="catalog-message" data-testid="admin-visibility">
      {t('serverAdmin.processesVisibility')}
    </p>
  {/if}
  {#if count === 0}
    <p class="catalog-message" data-testid="admin-empty">
      {filter ? t('serverAdmin.noMatch') : t('serverAdmin.empty')}
    </p>
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="table-scroll"
      tabindex="0"
      role="region"
      aria-label={t(`serverAdmin.table.${kind}`)}
    >
      <table class="result-table" data-testid={`admin-table-${kind}`}>
        <caption class="sr-only">{t(`serverAdmin.table.${kind}`)}</caption>
        <thead>
          <tr>
            {#if kind === 'processes'}
              <th scope="col">{t('serverAdmin.colId')}</th>
              <th scope="col">{t('serverAdmin.colUser')}</th>
              <th scope="col">{t('serverAdmin.colDatabase')}</th>
              <th scope="col" class="numeric">{t('serverAdmin.colSeconds')}</th>
              <th scope="col">{t('serverAdmin.colSelf')}</th>
            {:else}
              <th scope="col">{t('serverAdmin.colName')}</th>
              <th scope="col">{t('serverAdmin.colValue')}</th>
            {/if}
          </tr>
        </thead>
        <tbody>
          {#if kind === 'processes'}
            {#each processes as process, index (`${process.id}:${index}`)}
              <tr class:self-row={process.self} data-self={process.self}>
                <th scope="row" class="mono">{process.id}</th>
                <td><bdi>{process.user}</bdi></td>
                <td><bdi>{process.database}</bdi></td>
                <td class="numeric" title={formatSeconds(process.seconds)}
                  >{formatDecimal(String(process.seconds))}</td
                >
                <td>
                  {#if process.self}<Badge variant="secondary" data-testid="self-badge"
                      >{t('serverAdmin.self')}</Badge
                    >{/if}
                </td>
              </tr>
            {/each}
          {:else}
            {#each rows as row, index (`${row.name}:${index}`)}
              {@const shown = shownValue(row)}
              <tr data-masked={row.masked}>
                <th scope="row" class="mono"><bdi>{row.name}</bdi></th>
                <td class="numeric">
                  {#if shown.kind === 'masked'}
                    <Badge variant="outline" data-testid="masked-badge"
                      >{t('serverAdmin.masked')}</Badge
                    >
                  {:else if shown.kind === 'unknown'}
                    <span class="muted">{t('serverAdmin.unknown')}</span>
                  {:else}
                    <bdi>{formatDecimal(shown.text)}</bdi>
                  {/if}
                </td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>
    {#if anyMasked}
      <p class="catalog-message" data-testid="admin-masked-note">{t('serverAdmin.maskedNote')}</p>
    {/if}
  {/if}
  <div class="admin-pager" data-testid="admin-pager">
    <Button
      variant="outline"
      size="sm"
      disabled={offset === 0 || list.busy}
      onclick={() => page(-1)}
      data-testid="admin-prev">{t('serverAdmin.prev')}</Button
    >
    <span role="status">
      {count === 0
        ? t('serverAdmin.rangeNone')
        : t('serverAdmin.range', { from: offset + 1, to: offset + count })}
      {list.data.has_more ? t('serverAdmin.moreAvailable') : t('serverAdmin.lastPage')}
    </span>
    <Button
      variant="outline"
      size="sm"
      disabled={!list.data.has_more || list.busy}
      onclick={() => page(1)}
      data-testid="admin-next">{t('serverAdmin.next')}</Button
    >
  </div>
  <p class="catalog-message">{t('serverAdmin.noSnapshot')}</p>
{/if}

<style>
  .admin-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: flex-end;
    padding: 12px 16px 0;
  }
  .admin-controls label {
    display: grid;
    gap: 4px;
    font-size: 11px;
    color: var(--muted-foreground);
    min-width: 0;
  }
  .admin-input {
    min-width: 0;
    max-width: 100%;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 8px;
    font-size: 12px;
    background: var(--background);
    color: var(--foreground);
  }
  .admin-input[aria-invalid='true'] {
    border-color: var(--destructive);
  }
  .admin-auto {
    padding: 10px 16px 0;
  }
  .admin-pager {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    padding: 10px 16px;
    font-size: 11px;
  }
  .result-table th[scope='row'] {
    text-align: start;
    font-weight: 500;
  }
  .result-table td,
  .result-table th[scope='row'] {
    white-space: normal;
    overflow-wrap: anywhere;
    max-width: 360px;
  }
  .mono {
    font-family: ui-monospace, monospace;
  }
  .numeric {
    text-align: end;
  }
  .muted {
    color: var(--muted-foreground);
  }
  .self-row td,
  .self-row th {
    font-weight: 600;
  }
  .table-scroll:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: -2px;
  }
</style>
