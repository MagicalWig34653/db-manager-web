<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { TriangleAlert } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { t } from '$lib/i18n';
  import type { Driver } from '$lib/workbench';
  import { substitute, VariableError, type VariableInput, type VariableMode } from './variables';

  let {
    names,
    sql,
    driver,
    initial,
    onrun,
    onunchanged,
    oncancel,
  }: {
    names: string[] | null;
    sql: string;
    driver: Driver;
    initial: Record<string, VariableInput>;
    onrun: (values: Record<string, VariableInput>) => void;
    onunchanged: () => void;
    oncancel: () => void;
  } = $props();

  const uid = $props.id();
  let values = $state<Record<string, VariableInput>>({});
  let open = $state(false);
  let done = false;

  $effect(() => {
    if (names) {
      values = Object.fromEntries(
        names.map((name) => [name, { ...(initial[name] ?? { mode: 'text', value: '' }) }]),
      );
      done = false;
      open = true;
    } else open = false;
  });
  $effect(() => {
    // Any dismissal (Escape, backdrop, close icon) cancels without running.
    if (!open && names && !done) {
      done = true;
      oncancel();
    }
  });

  const result = $derived.by(() => {
    if (!names) return { sql: '', error: '' };
    try {
      return { sql: substitute(sql, driver, values), error: '' };
    } catch (cause) {
      if (cause instanceof VariableError)
        return {
          sql: '',
          error: t(`sqlEditor.variables.error.${cause.reason}`, { name: cause.name }),
        };
      throw cause;
    }
  });
  const modes: VariableMode[] = ['text', 'number', 'null', 'raw'];
  function run() {
    if (result.error) return;
    done = true;
    onrun($state.snapshot(values));
  }
  function unchanged() {
    done = true;
    onunchanged();
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-[640px] p-6" data-testid="sql-variables">
    <Dialog.Header>
      <Dialog.Title class="text-xl">{t('sqlEditor.variables.title')}</Dialog.Title>
      <Dialog.Description>{t('sqlEditor.variables.description')}</Dialog.Description>
    </Dialog.Header>
    <p class="variable-warning" role="note">
      <TriangleAlert size={14} />
      {t('sqlEditor.variables.warning')}
    </p>
    <form
      class="variable-form"
      autocomplete="off"
      onsubmit={(event) => {
        event.preventDefault();
        run();
      }}
    >
      {#each names ?? [] as name, index (name)}
        <div class="variable-row" role="group" aria-labelledby={`${uid}-n${index}`}>
          <strong id={`${uid}-n${index}`}>:{name}</strong>
          <select
            aria-label={t('sqlEditor.variables.kind', { name })}
            bind:value={values[name].mode}
          >
            {#each modes as mode}<option value={mode}
                >{t(`sqlEditor.variables.mode.${mode}`)}</option
              >{/each}
          </select>
          <input
            aria-label={t('sqlEditor.variables.value', { name })}
            bind:value={values[name].value}
            disabled={values[name].mode === 'null'}
            maxlength={10000}
            spellcheck="false"
            autocomplete="off"
            autocapitalize="off"
          />
        </div>
      {/each}
      {#if result.error}<p class="feedback error-feedback" role="alert">{result.error}</p>{/if}
      <div>
        <strong id={`${uid}-preview`}>{t('sqlEditor.variables.preview')}</strong>
        <pre class="variable-preview" aria-labelledby={`${uid}-preview`}>{result.sql}</pre>
      </div>
      <div class="dialog-actions">
        <Button variant="ghost" type="button" onclick={() => (open = false)}
          >{t('shared.cancel')}</Button
        >
        <Button variant="outline" type="button" onclick={unchanged}
          >{t('sqlEditor.variables.unchanged')}</Button
        >
        <Button type="submit" disabled={!!result.error}>{t('sqlEditor.variables.run')}</Button>
      </div>
    </form>
  </Dialog.Content>
</Dialog.Root>
