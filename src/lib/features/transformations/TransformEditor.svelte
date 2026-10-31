<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  // Input editor for a JSON, XML or SQL column (or a column with a regex rule). The text stays exactly what the user
  // typed; the editor only validates and offers a read-only preview. The value goes through the normal row editor.
  import { Textarea } from '$lib/components/ui/textarea';
  import { Button } from '$lib/components/ui/button';
  import { t } from '$lib/i18n';
  import type { TransformState } from './state.svelte';
  import { previewInput, validateInput, type InputId, type Options } from './transforms';

  let {
    column,
    id,
    options,
    value = $bindable(''),
    transforms,
  }: {
    column: string;
    id: InputId;
    options: Options;
    value: string;
    transforms: TransformState;
  } = $props();
  let showPreview = $state(false);
  const raw = $derived(transforms.bypass.has(column));
  const problem = $derived(
    raw ? null : validateInput(id, value, options, { driver: transforms.driver }),
  );
  const preview = $derived(
    showPreview && !problem ? previewInput(id, value, { driver: transforms.driver }) : null,
  );
  const statusId = $derived(`transform-status-${column.replace(/[^A-Za-z0-9_-]/g, '_')}`);
</script>

<div class="transform-editor" data-testid={`transform-editor-${column}`}>
  <label
    >{t('rowEditor.fieldValue', { column })}<Textarea
      aria-label={t('rowEditor.fieldValue', { column })}
      aria-invalid={problem ? 'true' : undefined}
      aria-describedby={statusId}
      bind:value
      class="transform-editor-area"
      rows={6}
      maxlength={1048576}
      autocomplete="off"
      spellcheck={false}
    /></label
  >
  <p id={statusId} role="status" class={problem ? 'transform-error' : 'transform-note'}>
    {#if raw}{t('transform.editor.rawMode')}{:else if problem}{t(
        `transform.problem.${problem}`,
      )}{:else}{t('transform.editor.valid')}{/if}
  </p>
  <div class="cell-actions">
    {#if !raw && id !== 'regex_validation'}<Button
        variant="outline"
        size="sm"
        aria-pressed={showPreview}
        onclick={() => (showPreview = !showPreview)}>{t('transform.editor.preview')}</Button
      >{/if}
    <Button variant="outline" size="sm" onclick={() => transforms.setBypass(column, !raw)}
      >{raw ? t('transform.editor.enable') : t('transform.editor.rawView')}</Button
    >
  </div>
  {#if preview !== null}<pre
      class="transform-pre"
      aria-label={t('transform.editor.previewLabel')}>{preview}</pre>
    {#if preview !== value}<Button variant="outline" size="sm" onclick={() => (value = preview)}
        >{t('transform.editor.adopt')}</Button
      >{/if}{/if}
</div>
