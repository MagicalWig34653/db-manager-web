<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { FeatureProps } from '$lib/features';
  import { t } from '$lib/i18n';
  import { displayCell } from '$lib/workbench';
  import { getShellContext } from '$lib/shell/context';
  import { batchClient, buildRequest, type Action, type Capabilities } from './client';
  import { BatchOperation } from './operation.svelte';

  let { connection, token, object, onwritephase }: FeatureProps = $props();
  const shell = getShellContext();
  const operation = new BatchOperation();
  let caps = $state<Capabilities | null>(null);
  let capsError = $state('');
  let sql = $state('');
  let delimiter = $state('');
  let mode = $state<'stop' | 'continue'>('stop');
  let action = $state<Action>('batch');
  let maxRows = $state(1000);
  let timeoutMs = $state(10000);
  let confirmed = $state(false);
  let writeConfirmed = $state(false);
  let inputError = $state('');
  const driver = $derived(connection?.driver === 'postgresql' ? 'postgres' : connection?.driver);
  const driverCaps = $derived(caps?.drivers.find((entry) => entry.driver === driver));
  const locked = $derived(operation.busy || !!shell?.session.writeInFlight);
  const unsupported = $derived(
    action === 'simulate' && (driver !== 'sqlite' || driverCaps?.simulation === 'unsupported'),
  );
  const allowed = $derived(
    !!connection && !!caps?.available && !!driverCaps && !unsupported && !capsError,
  );
  function revoke() {
    confirmed = false;
    writeConfirmed = false;
    inputError = '';
  }

  $effect(() => {
    const current = connection;
    const secret = token;
    const target = object;
    const probe = new AbortController();
    let active = true;
    untrack(() => {
      operation.reset();
      sql = '';
      delimiter = '';
      mode = 'stop';
      action = 'batch';
      maxRows = 1000;
      timeoutMs = 10000;
      revoke();
      caps = null;
      capsError = '';
      void target;
      if (current)
        void batchClient
          .capabilities(secret, probe.signal)
          .then((value) => {
            if (active) caps = value;
          })
          .catch(() => {
            if (active) capsError = t('sqlBatch.unavailable');
          });
    });
    return () => {
      active = false;
      probe.abort();
      operation.reset();
    };
  });

  async function start() {
    if (!connection || locked || !allowed || !confirmed || !writeConfirmed) return;
    try {
      const request = buildRequest(connection, { sql, delimiter, mode, maxRows, timeoutMs });
      revoke();
      await operation.run(action, request, token, onwritephase);
    } catch {
      inputError = t('sqlBatch.invalidInput');
    }
  }
</script>

<section class="batch-panel" aria-label={t('sqlBatch.title')} data-testid="sql-batch-panel">
  <h2>{t('sqlBatch.title')}</h2>
  {#if !connection}
    <p>{t('server.noConnection')}</p>
  {:else}
    <p>{t('sqlBatch.context', { database: connection.database, driver: connection.driver })}</p>
    {#if object}<p>
        {t('sqlBatch.tableContext', {
          name: `${object.schema ? `${object.schema}.` : ''}${object.name}`,
        })}
      </p>{/if}
    {#if capsError}<p role="alert">{capsError}</p>{:else if !caps}<p role="status">
        {t('sqlBatch.loading')}
      </p>{:else if !caps.available}<p role="alert">{t('sqlBatch.unavailable')}</p>{/if}
    {#if driverCaps}<p data-testid="batch-driver-reason">{driverCaps.reason}</p>{/if}
    <p>{t('sqlBatch.delimiterHelp')}</p>
    <pre>{'DELIMITER //\nCREATE TRIGGER … BEGIN …; END//\nDELIMITER ;'}</pre>
    <p>{t('sqlBatch.limits')}</p>
    <form
      onsubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      <fieldset disabled={locked} oninput={revoke} onchange={revoke}>
        <legend>{t('sqlBatch.editor')}</legend>
        <label
          >{t('sqlBatch.action')}<select bind:value={action}>
            <option value="batch">{t('sqlBatch.batch')}</option>
            <option value="explain">{t('sqlBatch.explain')}</option>
            <option value="simulate">{t('sqlBatch.simulate')}</option>
          </select></label
        >
        <label
          >{t('sqlBatch.sql')}<textarea
            rows="10"
            bind:value={sql}
            spellcheck="false"
            autocomplete="off"
            data-testid="batch-sql"></textarea></label
        >
        <label
          >{t('sqlBatch.delimiter')}<input
            bind:value={delimiter}
            maxlength="16"
            autocomplete="off"
          /></label
        >
        <label
          >{t('sqlBatch.mode')}<select bind:value={mode} disabled={action !== 'batch'}>
            <option value="stop">{t('sqlBatch.stop')}</option>
            <option value="continue">{t('sqlBatch.continue')}</option>
          </select></label
        >
        <label
          >{t('sqlBatch.maxRows')}<input
            type="number"
            min="0"
            max="10000"
            step="1"
            bind:value={maxRows}
            required
          /></label
        >
        <label
          >{t('sqlBatch.timeout')}<input
            type="number"
            min="0"
            max="60000"
            step="1"
            bind:value={timeoutMs}
            required
          /></label
        >
      </fieldset>
      {#if action === 'explain'}<p>
          {t(driver === 'sqlite' ? 'sqlBatch.explainSqlite' : 'sqlBatch.explainOther')}
        </p>{/if}
      {#if action === 'simulate'}<p>{t('sqlBatch.simulationHint')}</p>{/if}
      {#if unsupported}<p role="status" data-testid="simulation-unsupported">
          {t('sqlBatch.unsupported')}
          {driverCaps?.reason ?? capsError}
        </p>{/if}
      <p class="warning">{t('sqlBatch.writeWarning')}</p>
      <p class="warning">{t('sqlBatch.analyzeWarning')}</p>
      <p>{t('sqlBatch.readWarning')}</p>
      <fieldset disabled={locked || !allowed}>
        <legend>{t('sqlBatch.consent')}</legend>
        <label><input type="checkbox" bind:checked={confirmed} />{t('sqlBatch.confirm')}</label>
        <label
          ><input type="checkbox" bind:checked={writeConfirmed} />{t(
            'sqlBatch.confirmWrite',
          )}</label
        >
      </fieldset>
      <button
        type="submit"
        disabled={locked || !allowed || !confirmed || !writeConfirmed || !sql.trim()}
        >{t('sqlBatch.run')}</button
      >
      {#if operation.busy}<button type="button" onclick={() => operation.cancel()}
          >{t('sqlBatch.cancel')}</button
        >{/if}
    </form>
    {#if inputError}<p role="alert">{inputError}</p>{/if}
    <div aria-live="polite">
      {#if operation.busy}<p role="status">{t('sqlBatch.running')}</p>{/if}
      {#if operation.error}<p role="alert">{operation.error}</p>{/if}
      {#if operation.unknown && !operation.error}<p class="warning" role="alert">
          {t('sqlBatch.unknown')}
        </p>{/if}
      {#if operation.result}
        <p>{t('sqlBatch.duration', { ms: operation.result.duration_ms })}</p>
        {#if 'statements' in operation.result}
          {#each operation.result.statements as statement (statement.index)}
            <article data-testid="batch-statement" data-outcome={statement.outcome}>
              <h3>
                {t('sqlBatch.statement', { index: statement.index })}: {t(
                  `sqlBatch.${statement.outcome}`,
                )}
              </h3>
              <p>{t('sqlBatch.duration', { ms: statement.duration_ms })}</p>
              <p>
                {t('sqlBatch.affected', {
                  count: statement.rows_affected ?? t('sqlBatch.countUnknown'),
                })}
              </p>
              {#if statement.error_code}<p>
                  {t('sqlBatch.statementError', {
                    code: statement.error_code,
                    server: statement.server_code ?? '—',
                  })}
                </p>{/if}
              {#each statement.warnings as warning}<p>
                  {t('sqlBatch.warning', { code: warning.code, message: warning.message })}
                </p>{/each}
              {#each statement.results as result, i}
                <h4>{t('sqlBatch.resultSet', { index: i + 1, count: result.rows.length })}</h4>
                {#if result.rows_affected !== undefined}<p>
                    {t('sqlBatch.affected', { count: result.rows_affected })}
                  </p>{/if}
                {#if result.truncated}<p class="warning">{t('sqlBatch.truncated')}</p>{/if}
                <!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable results need a keyboard focus target.) -->
                <div
                  class="table-scroll"
                  role="region"
                  aria-label={t('sqlBatch.results')}
                  tabindex="0"
                >
                  <table>
                    <thead
                      ><tr
                        >{#each result.columns as column}<th scope="col"
                            >{column.name}<small>{column.database_type}</small></th
                          >{/each}</tr
                      ></thead
                    >
                    <tbody
                      >{#each result.rows as row}<tr
                          >{#each row as cell}<td
                              ><span title={cell.kind}
                                >{displayCell(cell) === '' ? '""' : displayCell(cell)}</span
                              ></td
                            >{/each}</tr
                        >{/each}</tbody
                    >
                  </table>
                </div>
              {/each}
            </article>
          {/each}
        {:else}
          <article data-testid="simulation-result" data-outcome={operation.result.outcome}>
            <h3>{t(`sqlBatch.${operation.result.outcome}`)}</h3>
            <p>
              {t('sqlBatch.affected', {
                count: operation.result.rows_affected ?? t('sqlBatch.countUnknown'),
              })}
            </p>
            {#each operation.result.warnings as warning}<p>
                {t('sqlBatch.warning', { code: warning.code, message: warning.message })}
              </p>{/each}
          </article>
        {/if}
      {/if}
    </div>
  {/if}
</section>

<style>
  .batch-panel {
    padding: 16px;
    min-width: 0;
    font-size: 13px;
    overflow-wrap: anywhere;
  }
  form,
  fieldset,
  label {
    display: grid;
    gap: 8px;
  }
  fieldset {
    min-width: 0;
    border: 1px solid #d9e2ee;
    padding: 12px;
  }
  label:has(input[type='checkbox']) {
    display: flex;
    align-items: center;
  }
  input,
  select,
  textarea,
  button {
    font: inherit;
    max-width: 100%;
    border: 1px solid #d9e2ee;
    border-radius: 4px;
    padding: 6px;
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    font-family: monospace;
  }
  button {
    justify-self: start;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .warning {
    color: #9b341d;
  }
  article {
    border-top: 1px solid #d9e2ee;
    margin-top: 16px;
  }
  .table-scroll {
    max-width: 100%;
    max-height: 480px;
    overflow: auto;
  }
  table {
    border-collapse: collapse;
  }
  th,
  td {
    text-align: left;
    border: 1px solid #d9e2ee;
    padding: 6px;
    white-space: pre-wrap;
    max-width: 32rem;
    overflow-wrap: anywhere;
  }
  small {
    display: block;
  }
</style>
