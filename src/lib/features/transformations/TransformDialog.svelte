<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  // Assigns a display transformation and an optional input editor to one column, with a live preview on sample values
  // of the loaded page. Nothing is stored before "Apply"; "Remove" returns the column to the raw view.
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { t } from '$lib/i18n';
  import { displayCell, type DisplayCell } from '$lib/workbench';
  import TransformedValue from './TransformedValue.svelte';
  import type { TransformState } from './state.svelte';
  import {
    applyDisplay,
    DISPLAY,
    INPUT,
    defaultOptions,
    isDisplayId,
    isInputId,
    optionSpecs,
    patternProblem,
    sanitizeOptions,
    type DisplayId,
    type InputId,
    type OptionSpec,
    type Options,
  } from './transforms';

  let {
    open = $bindable(false),
    column,
    transforms,
    samples,
  }: {
    open: boolean;
    column: string;
    transforms: TransformState;
    samples: DisplayCell[];
  } = $props();

  let displayId = $state<DisplayId | ''>('');
  let displayOptions = $state<Options>({});
  let inputId = $state<InputId | ''>('');
  let inputOptions = $state<Options>({});
  let busy = $state(false);
  let wasOpen = false;

  $effect(() => {
    if (open && !wasOpen) {
      const current = transforms.mappingFor(column);
      displayId = current?.display?.id ?? '';
      displayOptions = current?.display ? { ...current.display.options } : {};
      inputId = current?.input?.id ?? '';
      inputOptions = current?.input ? { ...current.input.options } : {};
    }
    wasOpen = open;
  });

  function chooseDisplay(value: string) {
    displayId = isDisplayId(value) ? value : '';
    displayOptions = displayId ? defaultOptions(displayId) : {};
  }
  function chooseInput(value: string) {
    inputId = isInputId(value) ? value : '';
    inputOptions = inputId ? defaultOptions(inputId) : {};
  }
  const setOption = (
    target: 'display' | 'input',
    spec: OptionSpec,
    value: string | number | boolean,
  ) => {
    if (target === 'display') displayOptions = { ...displayOptions, [spec.key]: value };
    else inputOptions = { ...inputOptions, [spec.key]: value };
  };

  const driver = $derived(transforms.driver);
  const previews = $derived(
    displayId
      ? samples.map((cell) => ({
          cell,
          output: applyDisplay(displayId as DisplayId, cell, displayOptions, { driver }),
        }))
      : [],
  );
  const patternBad = $derived(
    (displayId === 'regex_replace' && patternProblem(String(displayOptions.pattern ?? ''), 'i')) ||
      (inputId === 'regex_validation' && patternProblem(String(inputOptions.pattern ?? ''))),
  );
  const short = (text: string) => (text.length > 80 ? text.slice(0, 80) + '…' : text);

  async function apply() {
    busy = true;
    try {
      const display = displayId
        ? { id: displayId, options: sanitizeOptions(displayId, displayOptions) }
        : undefined;
      const input = inputId
        ? { id: inputId, options: sanitizeOptions(inputId, inputOptions) }
        : undefined;
      if (
        await transforms.set({
          column,
          ...(display ? { display } : {}),
          ...(input ? { input } : {}),
        })
      )
        open = false;
    } finally {
      busy = false;
    }
  }
  async function remove() {
    busy = true;
    try {
      if (await transforms.set({ column })) open = false;
    } finally {
      busy = false;
    }
  }
</script>

{#snippet fields(target: 'display' | 'input', id: string, values: Options)}
  {#each optionSpecs(id) as spec (spec.key)}
    {@const label = t(`transform.opt.${id}.${spec.key}`)}
    {#if spec.type === 'bool'}
      <label class="transform-check"
        ><input
          type="checkbox"
          checked={values[spec.key] === true}
          onchange={(event) => setOption(target, spec, event.currentTarget.checked)}
        />{label}</label
      >
    {:else if spec.type === 'select'}
      <label
        >{label}<select
          value={String(values[spec.key])}
          onchange={(event) => setOption(target, spec, event.currentTarget.value)}
          >{#each spec.choices ?? [] as choice}<option value={choice}
              >{t(`transform.choice.${choice}`)}</option
            >{/each}</select
        ></label
      >
    {:else if spec.type === 'int'}
      <label
        >{label}<input
          type="number"
          min={spec.min}
          max={spec.max}
          value={Number(values[spec.key])}
          oninput={(event) => setOption(target, spec, event.currentTarget.valueAsNumber)}
        /></label
      >
    {:else}
      <label
        >{label}<input
          type="text"
          maxlength={spec.maxLength}
          value={String(values[spec.key] ?? '')}
          autocomplete="off"
          spellcheck="false"
          oninput={(event) => setOption(target, spec, event.currentTarget.value)}
        /></label
      >
    {/if}
  {/each}
{/snippet}

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-[680px] max-h-[90vh] overflow-y-auto">
    <Dialog.Header
      ><Dialog.Title>{t('transform.dialogTitle', { column })}</Dialog.Title><Dialog.Description
        >{t('transform.dialogHelp')}</Dialog.Description
      ></Dialog.Header
    >
    <div class="transform-form">
      <label
        >{t('transform.displayLabel')}<select
          value={displayId}
          onchange={(event) => chooseDisplay(event.currentTarget.value)}
          ><option value="">{t('transform.none')}</option>{#each DISPLAY as spec (spec.id)}<option
              value={spec.id}>{t(`transform.name.${spec.id}`)}</option
            >{/each}</select
        ></label
      >
      {#if displayId}<p class="transform-note">{t(`transform.help.${displayId}`)}</p>
        {@render fields('display', displayId, displayOptions)}{/if}
      <label
        >{t('transform.inputLabel')}<select
          value={inputId}
          onchange={(event) => chooseInput(event.currentTarget.value)}
          ><option value="">{t('transform.none')}</option>{#each INPUT as spec (spec.id)}<option
              value={spec.id}>{t(`transform.name.${spec.id}`)}</option
            >{/each}</select
        ></label
      >
      {#if inputId}<p class="transform-note">{t(`transform.help.${inputId}`)}</p>
        {@render fields('input', inputId, inputOptions)}{/if}
      {#if patternBad}<p role="alert" class="transform-error">{t('transform.patternBad')}</p>{/if}
    </div>
    {#if displayId}
      <section aria-label={t('transform.preview')} class="transform-preview">
        <h3>{t('transform.preview')}</h3>
        {#if previews.length === 0}<p class="transform-note">{t('transform.noSamples')}</p>{/if}
        {#each previews as sample}<div class="transform-sample">
            <span class="transform-note">{t('transform.rawValue')}</span><code
              >{short(displayCell(sample.cell))}</code
            ><span class="transform-note">{t('transform.shownAs')}</span>
            <div><TransformedValue output={sample.output} compact={false} /></div>
          </div>{/each}
      </section>
    {/if}
    {#if transforms.storage === 'server'}<p class="transform-note">
        {t('transform.storage.server')}
      </p>{:else}<label class="transform-check"
        ><input
          type="checkbox"
          checked={transforms.storage === 'browser'}
          onchange={(event) => void transforms.setBrowserStorage(event.currentTarget.checked)}
        />{t('transform.storage.optIn')}</label
      >
      <p class="transform-note">
        {transforms.storage === 'browser'
          ? t('transform.storage.browser')
          : t('transform.storage.session')}
      </p>{/if}
    {#if transforms.notice}<p role="alert" class="transform-error">{transforms.notice}</p>{/if}
    <div class="cell-actions">
      <Button onclick={apply} disabled={busy || patternBad}>{t('transform.apply')}</Button>
      <Button variant="outline" onclick={remove} disabled={busy || !transforms.mappingFor(column)}
        >{t('transform.remove')}</Button
      >
      <Button variant="ghost" onclick={() => (open = false)} disabled={busy}
        >{t('transform.cancel')}</Button
      >
    </div>
  </Dialog.Content>
</Dialog.Root>
