<script lang="ts">
  import ExportControls from './ExportControls.svelte';
  import type { ExportScope } from '$lib/export';
  import { Binary, Check, Copy } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { t } from '$lib/i18n';
  import { displayCell, isNumeric, type DisplayCell, type DisplayResult } from '$lib/workbench';
  let {
    result,
    exportScope,
    onedit,
    ondelete,
    actionsDisabled = false,
    selection,
  }: {
    result: DisplayResult;
    exportScope?: ExportScope;
    onedit?: (index: number) => void;
    ondelete?: (index: number) => void;
    actionsDisabled?: boolean;
    /** Row selection (W-P13): checkboxes in a leading column; the owner keeps the set and the limit. */
    selection?: {
      selected: ReadonlySet<number>;
      max: number;
      disabled?: boolean;
      onchange: (index: number, on: boolean) => void;
      onall: (on: boolean) => void;
    };
  } = $props();
  const selectable = $derived(!!selection);
  const allSelected = $derived(
    !!selection &&
      result.rows.length > 0 &&
      selection.selected.size >= Math.min(result.rows.length, selection.max),
  );
  let selected = $state<DisplayCell | null>(null);
  let open = $state(false);
  let copied = $state(false);
  let copyError = $state(false);
  async function copyValue() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(displayCell(selected));
      copied = true;
    } catch {
      copyError = true;
    }
  }
</script>

{#if result.columns.length > 0}
  {#if exportScope}{#key result}<ExportControls {result} scope={exportScope} />{/key}{/if}
  <div class="table-scroll" role="region" aria-label={t('resultTable.regionLabel')}>
    <table class="result-table">
      <thead
        ><tr
          >{#if selection}<th class="row-select" scope="col"
              ><input
                type="checkbox"
                aria-label={t('resultTable.selectAll', { max: selection.max })}
                checked={allSelected}
                disabled={selection.disabled || result.rows.length === 0}
                onchange={(event) => selection.onall(event.currentTarget.checked)}
              /></th
            >{/if}<th class="row-number" scope="col">#</th>{#each result.columns as column}<th
              scope="col"><span>{column.name}</span><small>{column.type}</small></th
            >{/each}{#if onedit || ondelete}<th scope="col">{t('resultTable.singleRow')}</th
            >{/if}</tr
        ></thead
      >
      <tbody>
        {#each result.rows as row, index}<tr class:row-selected={selection?.selected.has(index)}
            >{#if selection}<td class="row-select"
                ><input
                  type="checkbox"
                  aria-label={t('resultTable.selectRow', { row: index + 1 })}
                  checked={selection.selected.has(index)}
                  disabled={selection.disabled ||
                    (!selection.selected.has(index) && selection.selected.size >= selection.max)}
                  onchange={(event) => selection.onchange(index, event.currentTarget.checked)}
                /></td
              >{/if}<td class="row-number">{index + 1}</td>{#each row as cell}<td
                class:numeric={isNumeric(cell)}
                ><button
                  class="cell-value"
                  class:null-cell={cell.kind === 'null'}
                  class:binary-cell={cell.kind === 'binary'}
                  aria-label={`${cell.kind}: ${displayCell(cell)}`}
                  onclick={() => {
                    selected = cell;
                    copied = false;
                    copyError = false;
                    open = true;
                  }}
                  >{#if cell.kind === 'binary'}<Binary size={13} />{/if}{displayCell(cell) === ''
                    ? '""'
                    : displayCell(cell)}</button
                ></td
              >{/each}{#if onedit || ondelete}<td class="row-actions"
                >{#if onedit}<Button
                    variant="ghost"
                    size="sm"
                    disabled={actionsDisabled}
                    aria-label={t('resultTable.editRowLabel', { row: index + 1 })}
                    onclick={() => onedit?.(index)}>{t('resultTable.edit')}</Button
                  >{/if}{#if ondelete}<Button
                    variant="ghost"
                    size="sm"
                    disabled={actionsDisabled}
                    aria-label={t('resultTable.deleteRowLabel', { row: index + 1 })}
                    onclick={() => ondelete?.(index)}>{t('resultTable.delete')}</Button
                  >{/if}</td
              >{/if}</tr
          >{/each}
        {#if result.rows.length === 0}<tr
            ><td
              colspan={result.columns.length +
                1 +
                (onedit || ondelete ? 1 : 0) +
                (selectable ? 1 : 0)}
              class="empty-result">{t('resultTable.empty')}</td
            ></tr
          >{/if}
      </tbody>
    </table>
  </div>
{:else}
  <div class="mutation-result">
    <Check size={22} /><strong>{t('resultTable.done')}</strong><span
      >{result.affectedRows === undefined
        ? t('resultTable.affectedUnknown')
        : t('resultTable.affected', { count: result.affectedRows })}</span
    >
  </div>
{/if}
<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-[680px]">
    <Dialog.Header
      ><Dialog.Title>{t('resultTable.cellTitle')}</Dialog.Title><Dialog.Description
        >{t('resultTable.cellFull', { kind: selected?.kind ?? '' })}{selected?.kind === 'binary'
          ? t('resultTable.base64')
          : ''}</Dialog.Description
      ></Dialog.Header
    >
    <pre class="full-cell">{selected ? displayCell(selected) : ''}</pre>
    <div class="cell-actions">
      <Button variant="outline" onclick={copyValue}
        >{#if copied}<Check />{t('resultTable.copied')}{:else}<Copy />{t(
            'resultTable.copy',
          )}{/if}</Button
      >{#if copyError}<span role="status">{t('resultTable.copyUnavailable')}</span>{/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
