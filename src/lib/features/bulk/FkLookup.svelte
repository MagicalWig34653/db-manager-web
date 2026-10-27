<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { toConnection } from '$lib/api';
  import { t } from '$lib/i18n';
  import type { ConnectionDraft } from '$lib/workbench';
  import { bulkClient, errorText } from './client';
  import { LOOKUP_PAGE, type LookupResult, type TableRef } from './model';

  let {
    connection,
    token,
    table,
    column,
    displayColumns,
    initialDisplay,
    onpick,
    onclose,
  }: {
    connection: ConnectionDraft;
    token: string;
    /** The table that owns the foreign key column. */
    table: TableRef;
    column: string;
    /** Columns of the referenced table, offered as the display column. */
    displayColumns: string[];
    initialDisplay: string;
    onpick: (value: { kind: string; value?: string }) => void;
    onclose: () => void;
  } = $props();

  let display = $state(untrack(() => initialDisplay));
  let search = $state('');
  let offset = $state(0);
  let result = $state.raw<LookupResult | null>(null);
  let busy = $state(false);
  let error = $state('');
  let generation = 0;
  let controller: AbortController | null = null;

  async function load(next: number) {
    controller?.abort();
    controller = new AbortController();
    const mine = ++generation;
    busy = true;
    error = '';
    try {
      const loaded = await bulkClient.lookup(
        {
          connection: toConnection(connection),
          table: { ...table },
          column,
          display_column: display,
          ...(search ? { search } : {}),
          page_size: LOOKUP_PAGE,
          offset: next,
          timeout_ms: 10000,
        },
        token,
        controller.signal,
      );
      if (mine !== generation) return;
      result = loaded;
      offset = next;
    } catch (cause) {
      if (mine !== generation || cause instanceof DOMException) return;
      result = null;
      error = errorText(cause);
    } finally {
      if (mine === generation) busy = false;
    }
  }
  $effect(() => {
    untrack(() => void load(0));
  });
  onDestroy(() => controller?.abort());
  const shown = (cell: { kind: string; value?: string }) =>
    cell.kind === 'null' ? 'NULL' : cell.value === '' ? '""' : (cell.value ?? '');
</script>

<section class="bulk-grid" aria-label={t('bulk.fk.title')} data-testid="fk-lookup">
  <h4>{t('bulk.fk.title', { column })}</h4>
  <form
    class="bulk-grid"
    onsubmit={(event) => {
      event.preventDefault();
      void load(0);
    }}
  >
    <label
      >{t('bulk.fk.display')}<select bind:value={display} onchange={() => void load(0)}>
        {#each displayColumns as name (name)}<option value={name}>{name}</option>{/each}
      </select></label
    >
    <label
      >{t('bulk.fk.search')}<input
        bind:value={search}
        maxlength="256"
        autocomplete="off"
        data-testid="fk-search"
      /></label
    >
    <div class="bulk-bar">
      <Button type="submit" size="sm" variant="outline" disabled={busy}>{t('bulk.fk.find')}</Button>
      <Button type="button" size="sm" variant="ghost" onclick={onclose}>{t('bulk.fk.close')}</Button
      >
    </div>
  </form>
  {#if busy}<p role="status">{t('bulk.fk.loading')}</p>{/if}
  {#if error}<p role="alert" data-testid="fk-error">{error}</p>{/if}
  {#if result && !busy}
    {#if result.choices.length === 0}<p>{t('bulk.fk.none')}</p>{/if}
    <ul class="bulk-keys" data-testid="fk-choices">
      {#each result.choices as choice, i (i)}
        <li>
          <button
            type="button"
            onclick={() => onpick(choice.value)}
            data-testid="fk-choice"
            aria-label={t('bulk.fk.pick', {
              value: shown(choice.value),
              label: shown(choice.display),
            })}>{shown(choice.value)} · {shown(choice.display)}</button
          >
        </li>
      {/each}
    </ul>
    <div class="bulk-bar">
      <Button
        size="sm"
        variant="outline"
        disabled={busy || offset === 0}
        onclick={() => load(Math.max(0, offset - LOOKUP_PAGE))}>{t('bulk.fk.prev')}</Button
      >
      <Button
        size="sm"
        variant="outline"
        disabled={busy || !result.has_more || offset + LOOKUP_PAGE > 1000000}
        onclick={() => load(offset + LOOKUP_PAGE)}>{t('bulk.fk.next')}</Button
      >
    </div>
  {/if}
</section>
