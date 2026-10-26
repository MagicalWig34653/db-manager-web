<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { apiDriver, toConnection } from '$lib/api';
  import type { FeatureProps } from '$lib/features';
  import { t } from '$lib/i18n';
  import { getShellContext } from '$lib/shell/context';
  import { Button } from '$lib/components/ui/button';
  import PlanPreview from '$lib/components/shared/PlanPreview.svelte';
  import { maintenanceClient, errorText } from './client';
  import { actions, tableKey, tableLabel, type Capabilities, type Item } from './model';
  import { reasonText } from './reason';
  import { Operation } from './operation.svelte';

  let { connection, token, object, onwritephase }: FeatureProps = $props();
  const shell = getShellContext();
  const uid = $props.id();
  let caps = $state<Capabilities | null>(null);
  let capsError = $state('');
  let selected = $state<string[]>([]);
  let action = $state<Item['action']>('analyze');
  let full = $state(false);
  let analyze = $state(false);
  let accepted = $state(false);
  let names = $state<Record<number, string>>({});
  const candidates = $derived(
    (object ? [object] : (shell?.session.objects ?? [])).filter((item) => item.type !== 'view'),
  );
  const driver = $derived(connection ? apiDriver(connection.driver) : 'sqlite');
  const support = $derived(caps?.drivers[driver][action]);
  const writeBusy = $derived(shell?.session.writeInFlight ?? false);
  const operation = new Operation({
    context: () => ({ connection: connection ? toConnection(connection) : null, token }),
    receiver: () => onwritephase,
    onfinished: () => {
      void shell?.session.loadCatalog();
    },
  });
  const busy = $derived(operation.phase !== 'idle');
  const scope = $derived(object ? tableKey(object) : '');
  const items = () =>
    candidates
      .filter((table) => selected.includes(tableKey(table)))
      .map((table) => ({
        table: { name: table.name, ...(table.schema ? { schema: table.schema } : {}) },
        action,
        ...(action === 'vacuum' ? { full, analyze } : {}),
      }));

  $effect(() => {
    connection;
    token;
    scope;
    const controller = new AbortController();
    let active = true;
    untrack(() => {
      operation.reset();
      accepted = false;
      names = {};
      action = 'analyze';
      full = false;
      analyze = false;
      selected = object && object.type !== 'view' ? [tableKey(object)] : [];
      caps = null;
      capsError = '';
      if (connection)
        void maintenanceClient
          .capabilities(token, controller.signal)
          .then((data) => {
            if (active) caps = data;
          })
          .catch((error) => {
            if (active) capsError = errorText(error);
          });
    });
    return () => {
      active = false;
      controller.abort();
      operation.reset();
    };
  });
  function reset() {
    operation.reset();
    accepted = false;
    names = {};
  }
  function select(key: string, checked: boolean) {
    selected = checked ? [...selected, key] : selected.filter((value) => value !== key);
  }
</script>

<section class="maintenance" aria-label={t('maintenance.title')} data-testid="maintenance">
  <h2>{t('maintenance.title')}</h2>
  <p>{t('maintenance.intro')}</p>
  {#if !connection}
    <p>{t('maintenance.noConnection')}</p>
  {:else if capsError}
    <p role="alert">{t('maintenance.unavailable')} {capsError}</p>
  {:else if !caps}
    <p role="status">{t('maintenance.loading')}</p>
  {:else if object?.type === 'view'}
    <p>{t('maintenance.view')}</p>
  {:else}
    <fieldset disabled={busy || writeBusy}>
      <legend>{t('maintenance.tables', { count: selected.length })}</legend>
      <p>{t('maintenance.batchHint')}</p>
      {#each candidates as table (tableKey(table))}
        <label class="choice"
          ><input
            type="checkbox"
            checked={selected.includes(tableKey(table))}
            disabled={!selected.includes(tableKey(table)) && selected.length >= 50}
            onchange={(event) => select(tableKey(table), event.currentTarget.checked)}
          />{tableLabel(table)}</label
        >
      {/each}
      {#if candidates.length === 0}<p>{t('maintenance.noTables')}</p>{/if}
      <label for="{uid}-action">{t('maintenance.action')}</label>
      <select id="{uid}-action" bind:value={action}>
        {#each actions as item}<option
            value={item}
            disabled={caps.drivers[driver][item].support === 'unsupported'}
            >{t(`maintenance.actions.${item}`)}</option
          >{/each}
      </select>
      {#if action === 'vacuum'}
        <label class="choice"
          ><input type="checkbox" bind:checked={full} />{t('maintenance.full')}</label
        >
        <label class="choice"
          ><input type="checkbox" bind:checked={analyze} />{t('maintenance.withAnalyze')}</label
        >
      {/if}
    </fieldset>
    <ul aria-label={t('maintenance.capabilities')} data-testid="maintenance-capabilities">
      {#each actions as item}
        <li>
          {t(`maintenance.actions.${item}`)}: {t(
            `maintenance.support.${caps.drivers[driver][item].support}`,
          )} — {caps.drivers[driver][item].reason}
        </li>
      {/each}
    </ul>
    {#if operation.phase === 'idle' || operation.phase === 'planning'}
      <Button
        disabled={busy ||
          writeBusy ||
          !selected.length ||
          selected.length > 50 ||
          support?.support === 'unsupported'}
        onclick={() => operation.loadPlan(items())}>{t('maintenance.plan')}</Button
      >
    {/if}
    {#if operation.error}<p role="alert">{operation.error}</p>{/if}
    {#if operation.plan}
      <div data-testid="maintenance-plan">
        <p role="alert">{t('maintenance.warnings')}</p>
        {#each operation.plan.items as item, index (index)}
          <article>
            <h3>{tableLabel(item.table)} · {t(`maintenance.actions.${item.action}`)}</h3>
            {#if item.state === 'rejected'}
              <p>{t('maintenance.outcomes.rejected')}: {reasonText(item.reason)}</p>
            {:else if item.plan}
              <PlanPreview
                statements={item.plan.statements}
                warnings={item.plan.warnings}
                planSha256={item.plan.plan_sha256}
              />
              <p>{t('maintenance.affected')}: {item.plan.affected_objects.join(', ')}</p>
              {#if item.typed_confirmation}
                <label for="{uid}-name-{index}"
                  >{t('maintenance.typeName', { name: item.target_name })}</label
                >
                <input
                  id="{uid}-name-{index}"
                  autocomplete="off"
                  spellcheck={false}
                  bind:value={names[index]}
                  disabled={operation.phase !== 'planned' || writeBusy}
                />
              {/if}
            {/if}
          </article>
        {/each}
      </div>
      {#if operation.phase === 'planned'}
        <label class="choice"
          ><input type="checkbox" bind:checked={accepted} disabled={writeBusy} />{t(
            'maintenance.confirm',
          )}</label
        >
        <Button
          disabled={writeBusy || !operation.canExecute(accepted, names)}
          onclick={() => operation.execute(accepted, names)}>{t('maintenance.execute')}</Button
        >
      {/if}
    {/if}
    {#if operation.phase === 'executing'}<p role="status">{t('maintenance.executing')}</p>{/if}
    {#if operation.result}
      <div data-testid="maintenance-result" role="status">
        {#if operation.result.partial}<p>{t('maintenance.partial')}</p>{/if}
        {#each operation.result.items as item, index (index)}
          <article>
            <h3>{tableLabel(item.table)} · {t(`maintenance.actions.${item.action}`)}</h3>
            <p>{t(`maintenance.outcomes.${item.outcome}`)} {reasonText(item.reason)}</p>
            <p>{t('maintenance.duration', { ms: item.duration_ms })}</p>
            {#if item.checksum !== null}<p>
                {t('maintenance.checksum')}: <code>{item.checksum}</code>
              </p>{/if}
          </article>
        {/each}
      </div>
    {/if}
    {#if operation.unknown}<p role="alert">{t('maintenance.unknown')}</p>{/if}
    {#if operation.phase === 'planned' || operation.phase === 'finished'}
      <p>{t('maintenance.locked')}</p>
      <Button variant="outline" disabled={writeBusy} onclick={reset}
        >{t('maintenance.reset')}</Button
      >
    {/if}
  {/if}
</section>

<style>
  .maintenance {
    display: grid;
    gap: 0.75rem;
    min-width: 0;
    padding: 1rem;
    overflow-wrap: anywhere;
  }
  fieldset,
  article {
    display: grid;
    gap: 0.5rem;
    min-width: 0;
    border: 1px solid var(--color-border);
    padding: 0.75rem;
    border-radius: 0.5rem;
  }
  .choice {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  input:not([type='checkbox']),
  select {
    width: 100%;
    min-width: 0;
    padding: 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: 0.375rem;
  }
  h2,
  h3,
  p {
    margin: 0;
  }
  ul {
    padding-left: 1.25rem;
  }
</style>
