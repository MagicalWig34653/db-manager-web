<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { TriangleAlert } from '@lucide/svelte';
  import { t } from '$lib/i18n';
  import { issueKey, outcomeKey, reasonKey, statementCounts, type Result } from './model';

  let { result, format }: { result: Result; format: 'sql' | 'csv' } = $props();
  const PAGE = 100;
  let shown = $state(PAGE);
  const counts = $derived(statementCounts(result.statements));
  const visible = $derived(result.statements.slice(0, shown));
  const unknown = $derived(
    result.outcome === 'outcome_unknown' ||
      result.statements.some((statement) => statement.outcome === 'outcome_unknown'),
  );
</script>

<section
  class="result"
  data-testid="import-result"
  data-outcome={result.outcome}
  aria-label={t('importData.resultTitle')}
>
  <h3>{t('importData.resultTitle')}</h3>
  <p data-testid="import-outcome">
    <strong>{t(outcomeKey(result.outcome))}</strong>
    {#if result.reason}
      · {t(reasonKey(result.reason))} (<code>{result.reason}</code>){/if}
  </p>
  {#if unknown}<p class="warning" role="alert" data-testid="import-unknown">
      <TriangleAlert size={16} />{t('importData.unknownNoRetry')}
    </p>{/if}
  {#if format === 'csv'}
    <p>
      {t('importData.counts', {
        processed: result.processed,
        inserted: result.inserted,
        skipped: result.skipped,
      })}
    </p>
  {/if}
  {#if result.warnings.length}
    <div class="notes" role="status" data-testid="import-warnings">
      <strong>{t('importData.serverWarnings')}</strong>
      <ul>
        {#each result.warnings as warning, index (index)}<li>{warning}</li>{/each}
      </ul>
    </div>
  {/if}
  {#if result.errors.length}
    <h4>{t('importData.issuesTitle')}</h4>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable table needs a keyboard focus target.) -->
    <div class="scroll" role="region" tabindex="0" aria-label={t('importData.issuesTitle')}>
      <table data-testid="import-issues">
        <thead
          ><tr
            ><th scope="col">{t('importData.row')}</th><th scope="col">{t('importData.column')}</th
            ><th scope="col">{t('importData.issueCode')}</th></tr
          ></thead
        >
        <tbody>
          {#each result.errors as issue, index (index)}<tr
              ><td>{issue.row}</td><td>{issue.column}</td><td
                >{t(issueKey(issue.code))} (<code>{issue.code}</code>)</td
              ></tr
            >{/each}
        </tbody>
      </table>
    </div>
    {#if result.errors_truncated}<p>{t('importData.issuesTruncated')}</p>{/if}
  {/if}
  {#if format === 'sql'}
    <h4>{t('importData.statementsTitle', { count: result.statements.length })}</h4>
    <ul class="counts" data-testid="import-counts">
      {#each Object.entries(counts) as [name, count] (name)}<li data-outcome={name}>
          {t(outcomeKey(name))}: {count}
        </li>{/each}
    </ul>
    {#if result.statements.length}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable table needs a keyboard focus target.) -->
      <div class="scroll" role="region" tabindex="0" aria-label={t('importData.statementsLabel')}>
        <table data-testid="import-statements">
          <thead
            ><tr
              ><th scope="col">#</th><th scope="col">{t('importData.state')}</th><th scope="col"
                >{t('importData.affected')}</th
              ><th scope="col">{t('importData.duration')}</th><th scope="col"
                >{t('importData.errorCode')}</th
              ></tr
            ></thead
          >
          <tbody>
            {#each visible as statement (statement.index)}<tr
                data-testid="import-statement"
                data-outcome={statement.outcome}
                ><td>{statement.index}</td><td>{t(outcomeKey(statement.outcome))}</td><td
                  >{statement.rows_affected ?? '–'}</td
                ><td>{statement.duration_ms} ms</td><td
                  >{#if statement.error_code}<code>{statement.error_code}</code
                    >{#if statement.server_code}
                      / <code>{statement.server_code}</code
                      >{/if}{:else}–{/if}{#each statement.warnings as warning, w (w)}
                    <small>{warning.code}: {warning.message}</small>{/each}</td
                ></tr
              >{/each}
          </tbody>
        </table>
      </div>
      {#if shown < result.statements.length}
        <button type="button" onclick={() => (shown += PAGE)}
          >{t('importData.showMore', { count: result.statements.length - shown })}</button
        >
      {/if}
    {/if}
  {/if}
</section>

<style>
  .result {
    display: grid;
    gap: 8px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .warning {
    color: var(--warning);
    display: flex;
    gap: 6px;
    align-items: flex-start;
  }
  .notes {
    border: 1px solid var(--border);
    padding: 8px 12px;
    border-radius: 4px;
  }
  .scroll {
    max-width: 100%;
    max-height: 420px;
    overflow: auto;
  }
  table {
    border-collapse: collapse;
  }
  th,
  td {
    text-align: left;
    border: 1px solid var(--border);
    padding: 4px 6px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  small {
    display: block;
  }
  .counts {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    padding-left: 18px;
  }
  button {
    justify-self: start;
    font: inherit;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 6px 10px;
    cursor: pointer;
  }
</style>
