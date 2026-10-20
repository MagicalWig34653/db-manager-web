<script lang="ts">
  import { Binary, Check, Copy } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { displayCell, isNumeric, type DisplayCell, type DisplayResult } from '$lib/workbench';
  let {
    result,
    onedit,
    ondelete,
    actionsDisabled = false,
  }: {
    result: DisplayResult;
    onedit?: (index: number) => void;
    ondelete?: (index: number) => void;
    actionsDisabled?: boolean;
  } = $props();
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
  <div class="table-scroll" role="region" aria-label="Abfrageergebnis, horizontal scrollbar">
    <table class="result-table">
      <thead
        ><tr
          ><th class="row-number" scope="col">#</th>{#each result.columns as column}<th scope="col"
              ><span>{column.name}</span><small>{column.type}</small></th
            >{/each}{#if onedit || ondelete}<th scope="col">Einzelzeile</th>{/if}</tr
        ></thead
      >
      <tbody>
        {#each result.rows as row, index}<tr
            ><td class="row-number">{index + 1}</td>{#each row as cell}<td
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
                    aria-label={`Zeile ${index + 1} bearbeiten`}
                    onclick={() => onedit?.(index)}>Bearbeiten</Button
                  >{/if}{#if ondelete}<Button
                    variant="ghost"
                    size="sm"
                    disabled={actionsDisabled}
                    aria-label={`Zeile ${index + 1} löschen`}
                    onclick={() => ondelete?.(index)}>Löschen</Button
                  >{/if}</td
              >{/if}</tr
          >{/each}
        {#if result.rows.length === 0}<tr
            ><td
              colspan={result.columns.length + 1 + (onedit || ondelete ? 1 : 0)}
              class="empty-result">Die Abfrage hat keine Zeilen zurückgegeben.</td
            ></tr
          >{/if}
      </tbody>
    </table>
  </div>
{:else}
  <div class="mutation-result">
    <Check size={22} /><strong>Anweisung abgeschlossen</strong><span
      >{result.affectedRows === undefined
        ? 'Anzahl betroffener Zeilen nicht gemeldet'
        : `${result.affectedRows} betroffene Zeilen`}</span
    >
  </div>
{/if}
<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-[680px]">
    <Dialog.Header
      ><Dialog.Title>Zellwert</Dialog.Title><Dialog.Description
        >Vollständiger Wert · {selected?.kind}{selected?.kind === 'binary'
          ? ' · Base64'
          : ''}</Dialog.Description
      ></Dialog.Header
    >
    <pre class="full-cell">{selected ? displayCell(selected) : ''}</pre>
    <div class="cell-actions">
      <Button variant="outline" onclick={copyValue}
        >{#if copied}<Check />Kopiert{:else}<Copy />Wert kopieren{/if}</Button
      >{#if copyError}<span role="status"
          >Kopieren ist hier nicht verfügbar. Wert bitte markieren.</span
        >{/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
