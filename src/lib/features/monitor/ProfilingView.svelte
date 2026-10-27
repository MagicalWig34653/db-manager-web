<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { t } from '$lib/i18n';
  import type { ConnectionDraft } from '$lib/workbench';
  import MonitorView from './MonitorView.svelte';
  import { SQL_MAX_BYTES, restrictionOf, utf8Bytes, type Capabilities } from './model';

  let {
    connection,
    token,
    capabilities,
  }: { connection: ConnectionDraft; token: string; capabilities: Capabilities } = $props();

  let sql = $state('');
  let submitted = $state<{ sql: string; nonce: number } | null>(null);
  let nonce = 0;
  const bytes = $derived(utf8Bytes(sql));
  const tooLong = $derived(bytes > SQL_MAX_BYTES);
  const blocked = $derived(
    !capabilities.available ||
      restrictionOf(capabilities, connection.driver, 'profiling')?.support === 'unsupported',
  );

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (blocked || tooLong || sql.trim() === '') return;
    submitted = { sql, nonce: ++nonce };
  }
</script>

{#if !blocked}
  <form class="profiling-form" onsubmit={submit}>
    <label>
      <span>{t('monitor.profilingSql')}</span>
      <textarea
        rows="4"
        bind:value={sql}
        spellcheck="false"
        autocomplete="off"
        aria-describedby="profiling-hint"
        aria-invalid={tooLong}
        data-testid="profiling-sql"></textarea>
    </label>
    <p class="catalog-message" id="profiling-hint">
      {t('monitor.profilingHint', { max: SQL_MAX_BYTES })}
    </p>
    {#if tooLong}<p class="catalog-message error-text" role="alert">
        {t('monitor.profilingTooLong', { max: SQL_MAX_BYTES })}
      </p>{/if}
    <Button
      type="submit"
      variant="outline"
      size="sm"
      disabled={tooLong || sql.trim() === ''}
      data-testid="profiling-run">{t('monitor.profilingRun')}</Button
    >
  </form>
{/if}
{#if blocked}
  <MonitorView
    action="profiling"
    {connection}
    {token}
    {capabilities}
    paged={false}
    caption={t('monitor.captionProfiling')}
  />
{:else if submitted}
  {#key submitted.nonce}
    <MonitorView
      action="profiling"
      {connection}
      {token}
      {capabilities}
      query={{ sql: submitted.sql }}
      paged={false}
      caption={t('monitor.captionProfiling')}
    />
  {/key}
{/if}

<style>
  .profiling-form {
    display: grid;
    gap: 8px;
    padding: 12px 16px 0;
    justify-items: start;
    font-size: 11px;
  }
  .profiling-form label {
    display: grid;
    gap: 4px;
    width: 100%;
    color: var(--muted-foreground);
  }
  textarea {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px;
    font-family: ui-monospace, monospace;
    font-size: 12px;
    background: var(--background);
    color: var(--foreground);
    resize: vertical;
  }
  textarea[aria-invalid='true'] {
    border-color: var(--destructive);
  }
</style>
