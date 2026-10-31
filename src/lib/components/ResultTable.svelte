<script lang="ts">
  import ExportControls from './ExportControls.svelte';
  import type { ExportScope } from '$lib/export';
  import { Binary, Check, Copy, Download, Eye, Settings2 } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { t } from '$lib/i18n';
  import { displayCell, isNumeric, type DisplayCell, type DisplayResult } from '$lib/workbench';
  import TransformDialog from '$lib/features/transformations/TransformDialog.svelte';
  import TransformedValue from '$lib/features/transformations/TransformedValue.svelte';
  import { decodeBase64 } from '$lib/features/transformations/image';
  import type { TransformState } from '$lib/features/transformations/state.svelte';
  import { applyDisplay, type Output } from '$lib/features/transformations/transforms';
  import { downloadBlob } from '$lib/features/export/sinks';
  let {
    result,
    exportScope,
    onedit,
    ondelete,
    actionsDisabled = false,
    selection,
    transforms,
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
    /** Column -> transformation assignment of this table (W-P22); absent where no table identity exists. */
    transforms?: TransformState;
  } = $props();
  const selectable = $derived(!!selection);
  const allSelected = $derived(
    !!selection &&
      result.rows.length > 0 &&
      selection.selected.size >= Math.min(result.rows.length, selection.max),
  );
  let selected = $state<DisplayCell | null>(null);
  let selectedColumn = $state(-1);
  let rawView = $state(false);
  let configureIndex = $state(-1);
  let configureOpen = $state(false);
  /** Decoded images in the grid are limited; further ones show a text chip (the full view is in the cell dialog). */
  const GRID_IMAGES = 25;
  const displays = $derived(result.columns.map((c) => transforms?.mappingFor(c.name)?.display));
  const grid = $derived.by((): (Output | null)[][] | null => {
    if (!transforms || !displays.some(Boolean)) return null;
    let images = 0;
    return result.rows.map((row) =>
      row.map((cell, index) => {
        const d = displays[index];
        if (!d) return null;
        const out = applyDisplay(d.id, cell, d.options, { driver: transforms.driver });
        if (out.kind === 'image' && ++images > GRID_IMAGES)
          return {
            kind: 'text',
            text: t('transform.imageChip', { type: out.mime.replace('image/', '').toUpperCase() }),
          };
        return out;
      }),
    );
  });
  const selectedOutput = $derived.by((): Output | null => {
    const d = selectedColumn >= 0 ? displays[selectedColumn] : undefined;
    return selected && d && transforms
      ? applyDisplay(d.id, selected, d.options, { driver: transforms.driver })
      : null;
  });
  const samples = $derived.by(() => {
    if (configureIndex < 0) return [];
    const seen = new Set<string>();
    const out: DisplayCell[] = [];
    for (const row of result.rows.slice(0, 200)) {
      const cell = row[configureIndex];
      if (!cell || cell.kind === 'null') continue;
      const key = `${cell.kind}:${cell.value ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(cell);
      if (out.length >= 3) break;
    }
    return out;
  });
  function download() {
    if (!selected || selected.kind !== 'binary' || selected.value === undefined) return;
    const bytes = decodeBase64(selected.value, 8 * 1024 * 1024);
    if (!bytes) return;
    const image = selectedOutput?.kind === 'image' ? selectedOutput : null;
    downloadBlob(
      new Blob([bytes as BlobPart], { type: image?.mime ?? 'application/octet-stream' }),
      image ? `image.${image.mime.slice(6).replace('jpeg', 'jpg')}` : 'value.bin',
    );
  }
  let open = $state(false);
  let copied = $state(false);
  let copyError = $state(false);
  const compactText = (out: Output) =>
    out.kind === 'text'
      ? out.text
      : out.kind === 'link'
        ? out.href
        : out.kind === 'pre'
          ? out.text.split('\n')[0]
          : out.kind === 'marked'
            ? out.parts.map((p) => p.text).join('')
            : '';
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
              scope="col"
              ><span>{column.name}</span><small>{column.type}</small>{#if transforms}<button
                  type="button"
                  class="transform-trigger"
                  class:transform-active={!!transforms.mappingFor(column.name)}
                  aria-label={t('transform.configure', { column: column.name })}
                  disabled={transforms.phase !== 'ready'}
                  onclick={() => {
                    configureIndex = result.columns.indexOf(column);
                    configureOpen = true;
                  }}><Settings2 size={12} /></button
                >{/if}</th
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
              >{/if}<td class="row-number">{index + 1}</td
            >{#each row as cell, cellIndex}{@const out = grid?.[index]?.[cellIndex] ?? null}<td
                class:numeric={isNumeric(cell) && (!out || out.kind === 'raw')}
                >{#if out?.kind === 'link'}<TransformedValue output={out} /><button
                    class="cell-value cell-detail"
                    aria-label={t('transform.showValue')}
                    onclick={() => {
                      selected = cell;
                      selectedColumn = cellIndex;
                      rawView = false;
                      copied = false;
                      copyError = false;
                      open = true;
                    }}><Eye size={13} /></button
                  >{:else}<button
                    class="cell-value"
                    class:null-cell={cell.kind === 'null'}
                    class:binary-cell={cell.kind === 'binary' && (!out || out.kind === 'raw')}
                    aria-label={out && out.kind !== 'raw'
                      ? out.kind === 'image'
                        ? t('transform.imageLabel', {
                            type: out.mime.replace('image/', '').toUpperCase(),
                          })
                        : `${cell.kind}: ${compactText(out)}`
                      : `${cell.kind}: ${displayCell(cell)}`}
                    onclick={() => {
                      selected = cell;
                      selectedColumn = cellIndex;
                      rawView = false;
                      copied = false;
                      copyError = false;
                      open = true;
                    }}
                    >{#if out && out.kind !== 'raw'}<TransformedValue
                        output={out}
                        compact
                        imageWidth={96}
                      />{:else}{#if cell.kind === 'binary'}<Binary size={13} />{/if}{displayCell(
                        cell,
                      ) === ''
                        ? '""'
                        : displayCell(cell)}{/if}</button
                  >{/if}</td
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
    {#if selectedOutput && selectedOutput.kind !== 'raw'}
      <div class="cell-actions" role="group" aria-label={t('transform.viewLabel')}>
        <Button
          variant={rawView ? 'outline' : 'default'}
          size="sm"
          aria-pressed={!rawView}
          onclick={() => (rawView = false)}>{t('transform.viewTransformed')}</Button
        ><Button
          variant={rawView ? 'default' : 'outline'}
          size="sm"
          aria-pressed={rawView}
          onclick={() => (rawView = true)}>{t('transform.viewRaw')}</Button
        >
      </div>
    {/if}
    {#if selectedOutput && !rawView}
      {#if selectedOutput.kind === 'raw'}<p class="transform-note">
          {t(`transform.raw.${selectedOutput.reason}`)}
        </p>{/if}
      {#if selectedOutput.kind !== 'raw'}<div class="full-cell transform-full">
          <TransformedValue output={selectedOutput} imageWidth={480} />
        </div>{/if}
    {/if}
    {#if !selectedOutput || rawView || selectedOutput.kind === 'raw'}
      <pre class="full-cell">{selected ? displayCell(selected) : ''}</pre>
    {/if}
    <div class="cell-actions">
      <Button variant="outline" onclick={copyValue}
        >{#if copied}<Check />{t('resultTable.copied')}{:else}<Copy />{t(
            'resultTable.copy',
          )}{/if}</Button
      >{#if selected?.kind === 'binary'}<Button variant="outline" onclick={download}
          ><Download />{t('transform.download')}</Button
        >{/if}{#if copyError}<span role="status">{t('resultTable.copyUnavailable')}</span>{/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
{#if transforms && configureIndex >= 0}<TransformDialog
    bind:open={configureOpen}
    column={result.columns[configureIndex]?.name ?? ''}
    {transforms}
    {samples}
  />{/if}
