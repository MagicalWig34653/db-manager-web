<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n';
  import { Poller, type PollOutcome, type PollerState, type StopReason } from '$lib/poller';

  // Opt-in auto refresh (off by default, never persisted). One request at a time, paused while the
  // page is hidden, exponential backoff after failures, stops on authorization errors.
  let {
    run,
    abort,
    disabled = false,
    intervals = [5, 10, 30, 60],
    testid = 'auto-refresh',
  }: {
    run: () => Promise<PollOutcome>;
    abort: () => void;
    disabled?: boolean;
    intervals?: number[];
    testid?: string;
  } = $props();

  let enabled = $state(false);
  let seconds = $state(10);
  let phase = $state<PollerState>('off');
  let failures = $state(0);
  let reason = $state<StopReason>(null);

  const poller = new Poller({
    intervalMs: 10_000,
    run: () => run(),
    abort: () => abort(),
    isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
    onChange: (next, count, why) => {
      phase = next;
      failures = count;
      reason = why;
      if (next === 'stopped') enabled = false;
    },
  });

  function toggle(on: boolean) {
    enabled = on;
    if (on) {
      poller.setInterval(seconds * 1000);
      poller.start();
    } else poller.stop();
  }
  function change(value: number) {
    seconds = value;
    poller.setInterval(value * 1000);
  }
  $effect(() => {
    if (disabled && enabled) toggle(false);
  });
  onMount(() => {
    const visibility = () => poller.visibilityChanged();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      poller.stop();
    };
  });

  const status = $derived(
    phase === 'paused'
      ? t('autoRefresh.paused')
      : phase === 'stopped'
        ? reason === 'fatal'
          ? t('autoRefresh.stoppedFatal')
          : t('autoRefresh.stoppedFailures')
        : phase === 'off'
          ? ''
          : failures > 0
            ? t('autoRefresh.backoff', { n: failures })
            : t('autoRefresh.active', { s: seconds }),
  );
</script>

<div class="auto-refresh" data-testid={testid}>
  <label class="auto-check">
    <input
      type="checkbox"
      checked={enabled}
      {disabled}
      onchange={(event) => toggle(event.currentTarget.checked)}
      data-testid="auto-refresh-toggle"
    />
    <span>{t('autoRefresh.label')}</span>
  </label>
  <label class="auto-interval">
    <span>{t('autoRefresh.interval')}</span>
    <select
      value={String(seconds)}
      onchange={(event) => change(Number(event.currentTarget.value))}
      data-testid="auto-refresh-interval"
    >
      {#each intervals as value (value)}
        <option value={String(value)}>{t('autoRefresh.seconds', { n: value })}</option>
      {/each}
    </select>
  </label>
  <span class="auto-status" role="status" aria-live="polite" data-testid="auto-refresh-status"
    >{status}</span
  >
</div>

<style>
  .auto-refresh {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 14px;
    align-items: center;
    font-size: 12px;
  }
  .auto-check,
  .auto-interval {
    display: inline-flex;
    gap: 6px;
    align-items: center;
  }
  .auto-interval select {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 6px;
    background: var(--background, white);
    color: inherit;
    font-size: 12px;
  }
  .auto-status {
    color: var(--muted-foreground);
    font-size: 11px;
  }
</style>
