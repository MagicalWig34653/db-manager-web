<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import AutoRefresh from '$lib/components/shared/AutoRefresh.svelte';
  import CapabilityNotice from '$lib/components/shared/CapabilityNotice.svelte';
  import ErrorPanel from '$lib/components/shared/ErrorPanel.svelte';
  import { formatNumber, t } from '$lib/i18n';
  import type { PollOutcome } from '$lib/poller';
  import { Resource } from '$lib/resource.svelte';
  import type { ConnectionDraft } from '$lib/workbench';
  import { monitorClient, type MonitorQuery } from './client';
  import {
    AUTO_REFRESH_INTERVALS,
    computeRates,
    counterFields,
    pageSizes,
    pushPoint,
    restrictionOf,
    type Action,
    type Capabilities,
    type CounterField,
    type MonitorRecord,
    type RateOutcome,
  } from './model';
  import ResultBody from './ResultBody.svelte';
  import Sparkline from './Sparkline.svelte';

  let {
    action,
    connection,
    token,
    capabilities,
    query = {},
    auto = false,
    paged = true,
    caption,
    rowAction,
    actionHeader,
  }: {
    action: Action;
    connection: ConnectionDraft;
    token: string;
    capabilities: Capabilities;
    query?: Pick<MonitorQuery, 'log' | 'position' | 'sql'>;
    auto?: boolean;
    paged?: boolean;
    caption: string;
    rowAction?: Snippet<[MonitorRecord]>;
    actionHeader?: string;
  } = $props();

  const result = new Resource<import('./model').MonitorResult>();
  let offset = $state(0);
  let limit = $state(50);
  const restriction = $derived(restrictionOf(capabilities, connection.driver, action));
  const blocked = $derived(!capabilities.available || restriction?.support === 'unsupported');

  // Rates are derived from two consecutive samples of this view (client side, in memory only).
  let previous: { record: MonitorRecord; at: Date } | null = null;
  let rate = $state<RateOutcome>({ kind: 'none' });
  let history = $state<Partial<Record<CounterField, number[]>>>({});
  let metric = $state<CounterField>('questions');

  function observe(record: MonitorRecord | undefined, sampledAt: string) {
    if (action !== 'sample' || !record) return;
    const parsed = new Date(sampledAt);
    const at = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    const outcome = previous ? computeRates(previous, { record, at }) : ({ kind: 'none' } as const);
    previous = { record, at };
    rate = outcome;
    if (outcome.kind === 'reset') history = {};
    if (outcome.kind === 'rates') {
      const next = { ...history };
      for (const field of counterFields) {
        const value = outcome.value.rates[field];
        if (value !== undefined) next[field] = pushPoint(next[field] ?? [], value);
      }
      history = next;
    }
  }

  async function load(): Promise<PollOutcome> {
    if (blocked) return { ok: true };
    const loaded = await result.run(
      (signal) =>
        monitorClient.run(
          action,
          connection,
          token,
          { limit: paged ? limit : 0, offset, ...query },
          signal,
        ),
      t('monitor.errGeneric'),
      { keep: true },
    );
    if (loaded) {
      observe(loaded.records[0], loaded.sampled_at);
      return { ok: true };
    }
    return result.error ? { ok: false, code: result.errorCode } : { ok: true };
  }
  function restart() {
    offset = 0;
    void load();
  }
  function page(delta: number) {
    offset = Math.max(0, offset + delta * limit);
    void load();
  }

  $effect(() => {
    void connection;
    void token;
    untrack(() => {
      result.reset();
      previous = null;
      rate = { kind: 'none' };
      history = {};
      void load();
    });
    return () => result.abort();
  });

  const metrics = $derived(counterFields.filter((field) => (history[field]?.length ?? 0) > 0));
  const series = $derived(history[metric] ?? []);
  const perSecond = (value: number) =>
    t('monitor.perSecond', { n: formatNumber(value, { maximumFractionDigits: 2 }) });
  const rateLabel = (field: string) => t(`monitor.fields.${field}`);
</script>

<div class="monitor-view" data-testid={`monitor-view-${action}`}>
  {#if !capabilities.available}
    <CapabilityNotice
      title={t('monitor.unavailableTitle')}
      reason={t('monitor.backendUnavailable')}
    />
  {:else if restriction?.support === 'unsupported'}
    <CapabilityNotice
      title={t('monitor.unsupportedTitle')}
      reason={restriction.reason || t('shared.unsupportedReason')}
    />
  {:else if restriction}
    <p class="catalog-message" data-testid="monitor-limited">
      <strong>{t('monitor.limitedTitle')}:</strong>
      {restriction.reason || t('shared.unsupportedReason')}
    </p>
  {/if}

  {#if !blocked}
    <div class="monitor-controls">
      {#if paged}
        <label>
          <span>{t('monitor.pageSize')}</span>
          <select
            class="monitor-input"
            value={String(limit)}
            onchange={(event) => {
              limit = Number(event.currentTarget.value);
              restart();
            }}
            data-testid="monitor-limit"
          >
            {#each pageSizes as size (size)}<option value={String(size)}>{size}</option>{/each}
          </select>
        </label>
      {/if}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onclick={() => void load()}
        disabled={result.busy}
        data-testid="monitor-refresh">{t('monitor.refresh')}</Button
      >
      {#if auto}
        <AutoRefresh
          run={load}
          abort={() => result.abort()}
          intervals={AUTO_REFRESH_INTERVALS}
          testid="monitor-auto-refresh"
        />
      {/if}
    </div>

    {#if result.busy && !result.data}
      <p class="catalog-message" role="status">{t('monitor.loading')}</p>
    {/if}
    {#if result.error}
      <ErrorPanel
        title={t('monitor.errTitle')}
        message={result.error}
        onretry={() => void load()}
      />
    {/if}
    {#if result.data}
      <ResultBody result={result.data} {caption} {rowAction} {actionHeader} />

      {#if action === 'sample' && result.data.state === 'available'}
        <section class="rates" aria-label={t('monitor.ratesTitle')} data-testid="monitor-rates">
          <h4>{t('monitor.ratesTitle')}</h4>
          {#if rate.kind === 'reset'}
            <p class="catalog-message" role="status" data-testid="rates-reset">
              {t('monitor.ratesReset')}
            </p>
          {:else if rate.kind === 'rates'}
            <p class="catalog-message">
              {t('monitor.ratesInterval', {
                s: formatNumber(rate.value.seconds, { maximumFractionDigits: 1 }),
              })}
            </p>
            <ul class="rate-list">
              {#each counterFields as field (field)}
                {#if rate.value.rates[field] !== undefined}
                  <li data-testid={`rate-${field}`}>
                    <span>{rateLabel(field)}</span>
                    <strong>{perSecond(rate.value.rates[field] ?? 0)}</strong>
                  </li>
                {/if}
              {/each}
            </ul>
          {:else}
            <p class="catalog-message" data-testid="rates-first">{t('monitor.ratesFirst')}</p>
          {/if}
          {#if metrics.length > 0}
            <label class="metric-select">
              <span>{t('monitor.chartMetric')}</span>
              <select class="monitor-input" bind:value={metric} data-testid="chart-metric">
                {#each metrics as field (field)}
                  <option value={field}>{rateLabel(field)}</option>
                {/each}
              </select>
            </label>
            <Sparkline
              points={series}
              label={t('monitor.chartLabel', {
                metric: rateLabel(metric),
                n: series.length,
                last: perSecond(series.at(-1) ?? 0),
                min: perSecond(Math.min(...series)),
                max: perSecond(Math.max(...series)),
              })}
            />
            <p class="catalog-message">{t('monitor.chartNote')}</p>
          {/if}
        </section>
      {/if}

      {#if paged && (offset > 0 || result.data.has_more)}
        <div class="monitor-pager" data-testid="monitor-pager">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0 || result.busy}
            onclick={() => page(-1)}
            data-testid="monitor-prev">{t('monitor.prev')}</Button
          >
          <span role="status">
            {t('monitor.range', {
              from: offset + 1,
              to: offset + result.data.records.length,
            })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={!result.data.has_more || result.busy}
            onclick={() => page(1)}
            data-testid="monitor-next">{t('monitor.next')}</Button
          >
        </div>
      {/if}
      <p class="catalog-message">{t('monitor.noSnapshot')}</p>
    {/if}
  {/if}
</div>

<style>
  .monitor-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 16px;
    align-items: flex-end;
    padding: 12px 16px 0;
  }
  .monitor-controls label,
  .metric-select {
    display: grid;
    gap: 4px;
    font-size: 11px;
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
  .monitor-pager {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    padding: 10px 16px;
    font-size: 11px;
  }
  .rates {
    padding: 4px 16px 8px;
  }
  .rates h4 {
    margin: 10px 0 0;
    font-size: 12px;
  }
  .rate-list {
    list-style: none;
    margin: 0;
    padding: 0 0 8px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 4px 16px;
    font-size: 11px;
  }
  .rate-list li {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }
  .metric-select {
    max-width: 280px;
    margin: 6px 0;
  }
</style>
