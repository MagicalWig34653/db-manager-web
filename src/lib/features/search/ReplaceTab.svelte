<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { toConnection, apiDriver } from '$lib/api';
  import type { FeatureProps } from '$lib/features';
  import { t } from '$lib/i18n';
  import { tables, type TableDescription } from '$lib/tables';
  import { displayCell } from '$lib/workbench';
  import { getShellContext } from '$lib/shell/context';
  import PlanPreview from '$lib/components/shared/PlanPreview.svelte';
  import { searchClient } from './client';
  import { Resource } from './resource.svelte';
  import { Operation } from './operation.svelte';
  import {
    validText,
    textColumns,
    modeLabel,
    outcomeLabel,
    reasonLabel,
    type Schemas,
  } from './model';
  let { connection, token, object, onwritephase }: FeatureProps = $props();
  const shell = getShellContext();
  const setup = new Resource<{
    caps: Schemas['SearchCapabilities'];
    description: TableDescription | null;
  }>();
  let column = $state<string | null>(null);
  let term = $state('');
  let replacement = $state('');
  let mode = $state<Schemas['ReplaceRequest']['mode']>('substring');
  let maxRows = $state(100);
  let timeout = $state(10000);
  let typedName = $state('');
  let typedCount = $state('');
  let confirmed = $state(false);
  const ref = $derived(
    object ? { ...(object.schema ? { schema: object.schema } : {}), name: object.name } : null,
  );
  const objectKey = $derived(JSON.stringify(ref));
  const busy = $derived(!!shell?.session.writeInFlight);
  const support = $derived(
    connection && setup.data ? setup.data.caps.drivers[apiDriver(connection.driver)] : null,
  );
  const description = $derived(setup.data?.description);
  const columns = $derived(description ? textColumns(description, true) : []);
  const eligible = $derived(
    description?.kind === 'table' &&
      description.transactional === 'yes' &&
      description.primary_key.length > 0 &&
      description.stable_order,
  );
  const available = $derived(
    !!setup.data?.caps.features.includes('replace') && !!support?.replace_modes.length,
  );
  const operation = new Operation({ blocked: () => busy, onphase: () => onwritephase });
  const editing = $derived(operation.phase === 'idle');
  const valid = $derived(
    eligible &&
      columns.some((item) => item.name === column) &&
      validText(term) &&
      validText(replacement, true) &&
      support?.replace_modes.includes(mode) &&
      Number.isInteger(maxRows) &&
      maxRows >= 1 &&
      maxRows <= 1000 &&
      Number.isInteger(timeout) &&
      timeout >= 1 &&
      timeout <= 10000,
  );
  $effect(() => {
    const current = connection;
    const secret = token;
    const table = ref;
    objectKey;
    untrack(() => {
      operation.reset();
      setup.reset();
      column = null;
      term = '';
      replacement = '';
      mode = 'substring';
      maxRows = 100;
      timeout = 10000;
      typedName = '';
      typedCount = '';
      confirmed = false;
      if (current && table)
        void setup.run(async (signal) => {
          const caps = await searchClient.capabilities(secret, signal);
          const description = caps.features.includes('replace')
            ? await tables.describe({ connection: toConnection(current), table }, secret, signal)
            : null;
          return { caps, description };
        });
    });
    return () => {
      setup.abort();
      operation.reset();
    };
  });
  function plan() {
    if (!connection || !ref || !valid || busy || column === null) return;
    typedName = '';
    typedCount = '';
    confirmed = false;
    void operation.loadPlan(
      {
        connection: toConnection(connection),
        table: { ...ref },
        column,
        term,
        replacement,
        mode,
        max_rows: maxRows,
        timeout_ms: timeout,
      },
      token,
    );
  }
  function reset() {
    operation.reset();
    typedName = '';
    typedCount = '';
    confirmed = false;
  }
</script>

<section class="replace-panel" aria-label={t('search.replaceTab')}>
  <h2>{t('search.replaceTab')}</h2>
  {#if setup.busy}<p role="status">{t('search.loading')}</p>{/if}
  {#if setup.error}<p role="alert">{setup.error}</p>{/if}
  {#if setup.data && !available}<p>{t('search.unsupported')}</p>{/if}
  {#if support?.reason}<p>{support.reason}</p>{/if}
  {#if available && description}
    <p>{t('search.replaceHint')}</p>
    {#if !eligible}<p>{t('search.ineligible')}</p>{/if}
    <fieldset disabled={!editing || busy || !eligible}>
      <legend>{t('search.replaceTab')}</legend>
      <label
        >{t('search.column')}<select bind:value={column}
          ><option value={null} disabled>{t('search.chooseColumn')}</option
          >{#each columns as item, i (i)}<option value={item.name}>{item.name}</option
            >{/each}</select
        ></label
      >
      <label>{t('search.term')}<input bind:value={term} autocomplete="off" /></label>
      <label>{t('search.replacement')}<input bind:value={replacement} autocomplete="off" /></label>
      <label
        >{t('search.mode')}<select bind:value={mode}
          >{#each ['substring', 'exact', 'regex'] as option}<option
              value={option}
              disabled={!support?.replace_modes.includes(
                option as Schemas['ReplaceRequest']['mode'],
              )}>{modeLabel(option as Schemas['ReplaceRequest']['mode'])}</option
            >{/each}</select
        ></label
      >
      <label
        >{t('search.tableLimit')}<input
          type="number"
          min="1"
          max="1000"
          bind:value={maxRows}
        /></label
      >
      <label
        >{t('search.timeout')}<input
          type="number"
          min="1"
          max="10000"
          bind:value={timeout}
        /></label
      >
      <button onclick={plan} disabled={!valid}>{t('search.plan')}</button>
    </fieldset>
    {#if operation.phase === 'planning'}<p role="status">{t('search.loading')}</p>
      <button onclick={reset}>{t('search.abort')}</button>{/if}
    {#if operation.error}<p role="alert">{operation.error}</p>{/if}
    {#if operation.plan}
      {@const preview = operation.plan}
      <section data-testid="replace-plan" aria-label={t('search.plan')}>
        <p>{preview.table.name} / {preview.column}</p>
        <p>{t('search.affected', { count: preview.affected_rows })}</p>
        <PlanPreview
          statements={preview.statements}
          warnings={preview.warnings}
          planSha256={preview.plan_sha256}
        />
        <div class="table-scroll">
          <table class="result-table">
            <thead
              ><tr
                ><th>{t('search.key')}</th><th>{t('search.before')}</th><th>{t('search.after')}</th
                ></tr
              ></thead
            ><tbody>
              {#each preview.examples as example, i (i)}<tr
                  ><td>{example.key.map(displayCell).join(' / ')}</td><td
                    >{displayCell(example.before)}</td
                  ><td>{displayCell(example.after)}</td></tr
                >{/each}
            </tbody>
          </table>
        </div>
      </section>
      <fieldset disabled={operation.phase !== 'planned' || busy}>
        <legend>{t('search.confirmation')}</legend>
        <p>{t('search.confirmHint', { name: preview.table.name, count: preview.affected_rows })}</p>
        <label>{t('search.typedName')}<input bind:value={typedName} autocomplete="off" /></label>
        <label
          >{t('search.typedCount')}<input
            bind:value={typedCount}
            inputmode="numeric"
            autocomplete="off"
          /></label
        >
        <label><input type="checkbox" bind:checked={confirmed} />{t('search.confirmed')}</label>
        <button
          onclick={() => operation.execute(typedName, typedCount, confirmed)}
          disabled={!confirmed ||
            typedName !== preview.table.name ||
            typedCount !== String(preview.affected_rows)}>{t('search.execute')}</button
        >
      </fieldset>
    {/if}
    {#if operation.phase === 'executing'}<p role="status">{t('search.executing')}</p>{/if}
    {#if operation.phase === 'finished'}
      <div data-testid="replace-result" role="status">
        {#if operation.unknown}<p>{t('search.unknown')}</p>
        {:else if operation.result}<p>{outcomeLabel(operation.result.outcome)}</p>
          <p>{t('search.affected', { count: operation.result.affected_rows })}</p>{/if}
        {#if operation.result?.reason}<p>{reasonLabel(operation.result.reason)}</p>{/if}
        <p>{t('search.locked')}</p>
      </div>
    {/if}
    {#if operation.phase === 'planned' || operation.phase === 'finished'}<button
        onclick={reset}
        disabled={busy}>{t('search.newPlan')}</button
      >{/if}
  {/if}
</section>

<style>
  .replace-panel {
    padding: 16px;
    min-width: 0;
  }
  fieldset {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    min-width: 0;
    margin: 10px 0;
  }
  label {
    display: grid;
    gap: 4px;
    max-width: 100%;
  }
  input,
  select {
    max-width: 100%;
    min-width: 0;
  }
  td {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  p {
    overflow-wrap: anywhere;
  }
</style>
