<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Info } from '@lucide/svelte';
  import { formatDecimal, formatStamp } from '$lib/format';
  import { lookup, t } from '$lib/i18n';
  import { de } from '$lib/i18n/de';
  import { columnsFor, type MonitorRecord, type MonitorResult } from './model';

  let {
    result,
    caption,
    rowAction,
    actionHeader,
  }: {
    result: MonitorResult;
    caption: string;
    rowAction?: Snippet<[MonitorRecord]>;
    actionHeader?: string;
  } = $props();

  // Identifiers and hashes must never be re-grouped like numbers.
  const raw = new Set(['digest', 'log_name', 'version', 'queryid', 'pid', 'server_id']);
  const numeric = /^-?[0-9]+(?:\.[0-9]+)?$/;
  const columns = $derived(columnsFor(result.records, result.action));
  const label = (key: string) =>
    lookup(de, `monitor.fields.${key}`) !== undefined ? t(`monitor.fields.${key}`) : key;
  const cell = (key: string, value: string) =>
    !raw.has(key) && numeric.test(value) ? formatDecimal(value) : value;
  const isNumber = (key: string, value: string | undefined) =>
    value !== undefined && !raw.has(key) && numeric.test(value);
  const sourceName = $derived(
    lookup(de, `monitor.source.${result.source}`) !== undefined
      ? t(`monitor.source.${result.source}`)
      : result.source,
  );
</script>

<p class="catalog-message" data-testid="monitor-meta">
  {t('monitor.meta', {
    source: sourceName,
    time: formatStamp(result.sampled_at),
    ms: result.duration_ms,
  })}
</p>

{#if result.state === 'unavailable'}
  <div class="feedback capability-notice" role="status" data-testid="monitor-unavailable">
    <Info size={20} />
    <div>
      <strong>{t('monitor.unavailableTitle')}</strong>
      <p data-testid="monitor-unavailable-reason">{result.reason || t('monitor.noReason')}</p>
      <p>{t('monitor.unavailableNote')}</p>
    </div>
  </div>
{:else}
  {#if result.reason}
    <p class="catalog-message" data-testid="monitor-reason">{result.reason}</p>
  {/if}
  {#if result.truncated}
    <p class="limit-note" role="status" data-testid="monitor-truncated">
      {t('monitor.truncated')}
    </p>
  {/if}
  {#if result.records.length === 0}
    <p class="catalog-message" data-testid="monitor-empty">
      {result.action === 'replication' ? t('monitor.emptyReplication') : t('monitor.empty')}
    </p>
  {:else if result.action === 'sample'}
    {#each result.records as record, index (index)}
      <dl class="sample-facts" data-testid="sample-facts">
        {#each columns as key (key)}
          {#if record[key as keyof MonitorRecord] !== undefined}
            <div>
              <dt>{label(key)}</dt>
              <dd>
                <bdi>{cell(key, String(record[key as keyof MonitorRecord]))}</bdi>
              </dd>
            </div>
          {/if}
        {/each}
      </dl>
    {/each}
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="table-scroll" tabindex="0" role="region" aria-label={caption}>
      <table class="result-table" data-testid="monitor-table">
        <caption class="sr-only">{caption}</caption>
        <thead>
          <tr>
            {#each columns as key (key)}
              <th scope="col">{label(key)}</th>
            {/each}
            {#if rowAction}<th scope="col">{actionHeader ?? t('monitor.colAction')}</th>{/if}
          </tr>
        </thead>
        <tbody>
          {#each result.records as record, index (index)}
            <tr>
              {#each columns as key (key)}
                {@const value = record[key as keyof MonitorRecord] as string | undefined}
                {#if key === columns[0]}
                  <th scope="row" class="mono"
                    >{#if value !== undefined}<bdi>{cell(key, String(value))}</bdi>{/if}</th
                  >
                {:else}
                  <td class:numeric={isNumber(key, value)}
                    >{#if value !== undefined}<bdi>{cell(key, String(value))}</bdi>{:else}<span
                        class="muted"
                        aria-label={t('monitor.unknownValue')}>–</span
                      >{/if}</td
                  >
                {/if}
              {/each}
              {#if rowAction}<td>{@render rowAction(record)}</td>{/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
  {#if result.hints.length > 0}
    <h4 class="hints-title">{t('monitor.hintsTitle')}</h4>
    <ul class="hints" data-testid="monitor-hints">
      {#each result.hints as hint, index (index)}
        <li>
          <strong>{hint.message}</strong>
          <small>
            {t('monitor.hintDetail', {
              rule: hint.rule,
              metric: hint.metric,
              observed: hint.observed,
              threshold: hint.threshold,
              source: hint.source,
            })}
          </small>
        </li>
      {/each}
    </ul>
    <p class="catalog-message">{t('monitor.hintsNote')}</p>
  {:else if result.action === 'advisor' && result.records.length > 0}
    <p class="catalog-message" data-testid="monitor-no-hints">{t('monitor.noHints')}</p>
  {/if}
{/if}

<style>
  .sample-facts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 8px 16px;
    margin: 0;
    padding: 12px 16px;
    font-size: 11px;
  }
  .sample-facts dt {
    color: var(--muted-foreground);
  }
  .sample-facts dd {
    margin: 2px 0 0;
    overflow-wrap: anywhere;
    font-family: ui-monospace, monospace;
  }
  .result-table th[scope='row'] {
    text-align: start;
    font-weight: 500;
  }
  .result-table td,
  .result-table th[scope='row'] {
    white-space: normal;
    overflow-wrap: anywhere;
    max-width: 320px;
  }
  .mono {
    font-family: ui-monospace, monospace;
  }
  .numeric {
    text-align: end;
  }
  .muted {
    color: var(--muted-foreground);
  }
  .hints-title {
    margin: 12px 16px 4px;
    font-size: 12px;
  }
  .hints {
    margin: 0;
    padding: 0 16px 0 32px;
    font-size: 12px;
  }
  .hints li {
    margin: 6px 0;
    overflow-wrap: anywhere;
  }
  .hints small {
    display: block;
    color: var(--muted-foreground);
    font-size: 10px;
  }
  .table-scroll:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: -2px;
  }
</style>
