<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { t } from '$lib/i18n';
  import type { ConnectionDraft } from '$lib/workbench';
  import MonitorView from './MonitorView.svelte';
  import type { Capabilities, MonitorRecord } from './model';

  let {
    connection,
    token,
    capabilities,
  }: { connection: ConnectionDraft; token: string; capabilities: Capabilities } = $props();

  let log = $state('');
  let position = $state(0);
  let positionInput = $state('0');
  let shown = $state<{ log: string; position: number; nonce: number } | null>(null);
  let nonce = 0;
  const maxPosition = Number.MAX_SAFE_INTEGER;
  const validPosition = $derived(
    /^[0-9]{1,16}$/.test(positionInput) && Number(positionInput) <= maxPosition,
  );

  function open(record: MonitorRecord) {
    if (!record.log_name) return;
    log = record.log_name;
    positionInput = '0';
    position = 0;
    shown = { log, position: 0, nonce: ++nonce };
  }
  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!validPosition || !log) return;
    position = Number(positionInput);
    shown = { log, position, nonce: ++nonce };
  }
</script>

{#snippet openEvents(record: MonitorRecord)}
  {#if record.log_name}
    <Button
      variant="outline"
      size="sm"
      onclick={() => open(record)}
      aria-label={t('monitor.showEventsFor', { log: record.log_name })}
      data-testid="open-events">{t('monitor.showEvents')}</Button
    >
  {/if}
{/snippet}

<MonitorView
  action="binary-logs"
  {connection}
  {token}
  {capabilities}
  caption={t('monitor.captionBinaryLogs')}
  rowAction={openEvents}
  actionHeader={t('monitor.colEvents')}
/>

{#if shown}
  <section class="events" aria-label={t('monitor.eventsTitle')} data-testid="binlog-events">
    <h4>{t('monitor.eventsFor', { log: shown.log })}</h4>
    <form class="position-form" onsubmit={submit}>
      <label>
        <span>{t('monitor.position')}</span>
        <input
          class="monitor-input"
          inputmode="numeric"
          bind:value={positionInput}
          aria-invalid={!validPosition}
          data-testid="binlog-position"
        />
      </label>
      <Button type="submit" variant="outline" size="sm" disabled={!validPosition}
        >{t('monitor.loadEvents')}</Button
      >
    </form>
    {#key shown.nonce}
      <MonitorView
        action="binary-events"
        {connection}
        {token}
        {capabilities}
        query={{ log: shown.log, position: shown.position }}
        caption={t('monitor.captionBinaryEvents')}
      />
    {/key}
  </section>
{/if}

<style>
  .events {
    border-top: 1px solid var(--border);
    margin-top: 12px;
  }
  .events h4 {
    margin: 12px 16px 0;
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .position-form {
    display: flex;
    gap: 10px;
    align-items: flex-end;
    padding: 8px 16px 0;
    font-size: 11px;
    flex-wrap: wrap;
  }
  .position-form label {
    display: grid;
    gap: 4px;
    color: var(--muted-foreground);
  }
  .monitor-input {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 8px;
    font-size: 12px;
    background: var(--background);
    color: var(--foreground);
    max-width: 100%;
  }
  .monitor-input[aria-invalid='true'] {
    border-color: var(--destructive);
  }
</style>
