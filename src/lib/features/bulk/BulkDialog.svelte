<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { TriangleAlert } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import ResultTable from '$lib/components/ResultTable.svelte';
  import PlanPreview from '$lib/components/shared/PlanPreview.svelte';
  import { t } from '$lib/i18n';
  import {
    defaultKind,
    prepareChanges,
    snapshotResult,
    type Change,
    type FieldDraft,
    type Snapshot,
    type WritePhase,
  } from '$lib/rows';
  import type { TableDescription } from '$lib/tables';
  import type { ConnectionDraft } from '$lib/workbench';
  import { BulkOperation } from './operation.svelte';
  import {
    keyLabel,
    outcomeKey,
    planRequest,
    reasonKey,
    type Action,
    type TableRef,
  } from './model';

  let {
    connection,
    token,
    table,
    description,
    writable,
    requiredPk,
    action,
    rows,
    onclose,
    onwritephase,
  }: {
    connection: ConnectionDraft;
    token: string;
    table: TableRef;
    description: TableDescription;
    /** Columns the update route may change (v3 eligibility). */
    writable: string[];
    /** Primary key columns a copy needs explicit new values for; empty for a single auto key. */
    requiredPk: string[];
    action: Action;
    rows: Snapshot[];
    /** True when the table view has to be reloaded (something was or may have been written). */
    onclose: (reload: boolean) => void;
    onwritephase: (phase: WritePhase) => void;
  } = $props();

  const operation = new BulkOperation({ primaryKey: () => description.primary_key });
  const tableLabel = $derived(`${table.schema ? `${table.schema}.` : ''}${table.name}`);
  const needsInput = $derived(action === 'update' || (action === 'copy' && requiredPk.length > 0));
  let step = $state<'edit' | 'plan'>('edit');
  let message = $state('');
  let confirmed = $state(false);
  let typedCount = $state('');
  let open = $state(true);

  const editable = $derived(
    description.columns.filter(
      (column) =>
        writable.includes(column.name) &&
        column.generated === 'none' &&
        !description.primary_key.includes(column.name),
    ),
  );
  // The dialog is mounted per operation (keyed by the parent), so the props are read once on purpose.
  let fields = $state<FieldDraft[]>(
    untrack(() =>
      description.columns
        .filter(
          (column) =>
            writable.includes(column.name) &&
            column.generated === 'none' &&
            !description.primary_key.includes(column.name),
        )
        .map((column) => ({
          column: column.name,
          locked: false,
          mode: 'unchanged' as const,
          kind: defaultKind(column.database_type),
          value: '',
        })),
    ),
  );
  // Copy: one value per required key column and selected row.
  let copyFields = $state<FieldDraft[][]>(
    untrack(() =>
      rows.map(() =>
        requiredPk.map((name) => ({
          column: name,
          locked: false,
          mode: 'value' as const,
          kind: defaultKind(
            description.columns.find((column) => column.name === name)?.database_type ?? '',
          ),
          value: '',
        })),
      ),
    ),
  );
  if (!untrack(() => needsInput)) step = 'plan';

  const busy = $derived(operation.busy);
  const plan = $derived(operation.plan);
  const display = $derived({
    columns: description.columns.map((column) => ({
      name: column.name,
      type: column.database_type,
    })),
    rows: rows.map((row) => row.values.map((cell) => ({ ...cell }))),
    truncated: false,
  });
  const deleteTyped = $derived(action !== 'delete' || typedCount === String(rows.length));
  const canExecute = $derived(
    operation.phase === 'planned' && !operation.consumed && confirmed && deleteTyped && !busy,
  );
  const titles = {
    update: 'bulk.titleUpdate',
    delete: 'bulk.titleDelete',
    copy: 'bulk.titleCopy',
  } as const;

  function collect() {
    message = '';
    try {
      if (action === 'update') {
        const changes = prepareChanges(fields, 'update');
        for (const change of changes) {
          const column = description.columns.find((item) => item.name === change.column);
          if (!column || !writable.includes(change.column))
            throw new Error(t('bulk.err.columnGone'));
          if (change.value.kind === 'null' && !column.nullable)
            throw new Error(t('bulk.err.notNull', { column: change.column }));
        }
        return { changes };
      }
      if (action === 'copy') {
        const copyValues: Change[][] = copyFields.map((list) => prepareChanges(list, 'insert'));
        for (const values of copyValues)
          if (requiredPk.some((name) => !values.some((change) => change.column === name)))
            throw new Error(t('bulk.err.needKey'));
        const seen = new Set(copyValues.map((values) => JSON.stringify(values)));
        if (seen.size !== copyValues.length) throw new Error(t('bulk.err.sameKey'));
        return { copyValues };
      }
      return {};
    } catch (cause) {
      message = cause instanceof Error ? cause.message : t('bulk.err.invalidInput');
      return null;
    }
  }
  function makePlan() {
    const extra = collect();
    if (!extra || busy) return;
    confirmed = false;
    typedCount = '';
    step = 'plan';
    void operation.makePlan(planRequest(connection, table, action, rows, extra), token);
  }
  function execute() {
    if (!canExecute) return;
    void operation.execute(token, onwritephase);
  }
  function back() {
    if (busy) return;
    operation.reset(onwritephase);
    confirmed = false;
    typedCount = '';
    step = needsInput ? 'edit' : 'plan';
    if (!needsInput) makePlan();
  }
  function close() {
    if (operation.phase === 'executing') return;
    const reload = operation.consumed || operation.stale;
    operation.reset(onwritephase);
    open = false;
    onclose(reload);
  }
  // Deletes and copies with an automatic key need no input: preview once, immediately. A failed preview must not
  // retrigger itself; the user closes the dialog and starts again.
  let autoPlanned = false;
  $effect(() => {
    if (!needsInput && !autoPlanned) {
      autoPlanned = true;
      queueMicrotask(() => makePlan());
    }
  });
  onDestroy(() => operation.reset(onwritephase));

  /** Display-only list of the chosen changes; invalid drafts never reach the plan, so errors yield an empty list. */
  function prepareSafe(list: FieldDraft[]): Change[] {
    try {
      return prepareChanges(list, 'update');
    } catch {
      return [];
    }
  }
  const resultRows = $derived(
    operation.result
      ? operation.result.rows.filter((row) => row.row && row.outcome === 'completed')
      : [],
  );
</script>

<Dialog.Root
  bind:open
  onOpenChange={(value) => {
    if (value) return;
    // The execute request is in flight: dismissing the dialog would drop the write lock and the result.
    // The dialog stays open until the server answered.
    if (operation.phase === 'executing') {
      open = true;
      return;
    }
    close();
  }}
>
  <Dialog.Content
    class="sm:max-w-[900px] max-h-[90dvh] overflow-y-auto p-6"
    data-testid="bulk-dialog"
  >
    <Dialog.Header>
      <Dialog.Title>{t(titles[action])}</Dialog.Title>
      <Dialog.Description
        >{t('bulk.context', { table: tableLabel, count: rows.length })}</Dialog.Description
      >
    </Dialog.Header>

    {#if step === 'edit' && operation.phase === 'idle'}
      {#if action === 'update'}
        <p class="row-help">{t('bulk.updateHelp')}</p>
        <div class="bulk-grid">
          {#each fields as field (field.column)}
            {@const column = description.columns.find((item) => item.name === field.column)}
            <div class="bulk-grid" data-testid="bulk-field">
              <strong>{field.column}</strong><small>{column?.database_type}</small>
              <label
                >{t('bulk.fieldMode', { column: field.column })}<select
                  bind:value={field.mode}
                  aria-label={t('bulk.fieldMode', { column: field.column })}
                  ><option value="unchanged">{t('bulk.modeUnchanged')}</option>
                  {#if column?.nullable}<option value="null">NULL</option>{/if}
                  <option value="value">{t('bulk.modeValue')}</option></select
                ></label
              >
              {#if field.mode === 'value'}
                <label
                  >{t('bulk.fieldKind', { column: field.column })}<select
                    bind:value={field.kind}
                    aria-label={t('bulk.fieldKind', { column: field.column })}
                    ><option value="text">{t('bulk.kindText')}</option><option value="integer"
                      >{t('bulk.kindInteger')}</option
                    ><option value="decimal">{t('bulk.kindDecimal')}</option><option value="float"
                      >{t('bulk.kindFloat')}</option
                    ><option value="boolean">{t('bulk.kindBoolean')}</option><option value="binary"
                      >{t('bulk.kindBinary')}</option
                    ><option value="timestamp">{t('bulk.kindTimestamp')}</option></select
                  ></label
                >
                <label
                  >{t('bulk.fieldValue', { column: field.column })}<textarea
                    bind:value={field.value}
                    aria-label={t('bulk.fieldValue', { column: field.column })}
                    rows="2"
                    maxlength="1048576"
                    autocomplete="off"
                    spellcheck="false"></textarea></label
                >
              {/if}
            </div>
          {/each}
          {#if editable.length === 0}<p role="alert">{t('bulk.noEditable')}</p>{/if}
        </div>
      {:else}
        <p class="row-help">{t('bulk.copyHelp')}</p>
        <div class="bulk-grid">
          {#each copyFields as list, i (i)}
            <fieldset class="bulk-grid" data-testid="bulk-copy-row">
              <legend>{t('bulk.copyRow', { n: i + 1 })}</legend>
              {#each list as field (field.column)}
                <label
                  >{t('bulk.newKey', { column: field.column, n: i + 1 })}<input
                    bind:value={field.value}
                    aria-label={t('bulk.newKey', { column: field.column, n: i + 1 })}
                    autocomplete="off"
                    spellcheck="false"
                  /></label
                >
                <label
                  >{t('bulk.fieldKind', { column: field.column })}<select
                    bind:value={field.kind}
                    aria-label={t('bulk.keyKind', { column: field.column, n: i + 1 })}
                    ><option value="text">{t('bulk.kindText')}</option><option value="integer"
                      >{t('bulk.kindInteger')}</option
                    ><option value="decimal">{t('bulk.kindDecimal')}</option><option value="float"
                      >{t('bulk.kindFloat')}</option
                    ><option value="timestamp">{t('bulk.kindTimestamp')}</option></select
                  ></label
                >
              {/each}
            </fieldset>
          {/each}
        </div>
      {/if}
      {#if message}<p role="alert" data-testid="bulk-message">{message}</p>{/if}
      <div class="dialog-actions">
        <Button variant="outline" onclick={close}>{t('bulk.discard')}</Button>
        <Button onclick={makePlan} disabled={busy} data-testid="bulk-plan"
          >{t('bulk.makePlan')}</Button
        >
      </div>
    {:else}
      {#if operation.phase === 'planning'}
        <p role="status">{t('bulk.planning')}</p>
        <Button variant="outline" onclick={() => operation.cancelPlan()}>{t('bulk.cancel')}</Button>
      {/if}
      {#if operation.phase === 'executing'}<p role="status" data-testid="bulk-executing">
          {t('bulk.executing')}
        </p>{/if}
      {#if operation.error}<p
          class="bulk-warning"
          role="alert"
          data-testid="bulk-error"
          data-code={operation.errorCode}
        >
          <TriangleAlert size={16} />{operation.error}
        </p>{/if}
      {#if operation.stale && !operation.unknown}<p role="alert" data-testid="bulk-stale">
          {operation.errorCode === 'plan_conflict' ? t('bulk.planConflict') : t('bulk.rowsChanged')}
        </p>{/if}

      {#if plan}
        <section class="bulk-grid" aria-label={t('bulk.planTitle')} data-testid="bulk-plan-view">
          <h3>{t('bulk.planTitle')}</h3>
          <p>{t('bulk.planCount', { count: plan.row_count, table: tableLabel })}</p>
          <ul class="bulk-keys" data-testid="bulk-plan-keys">
            {#each plan.rows as planned, i (i)}<li>{keyLabel(planned.key)}</li>{/each}
          </ul>
          {#if action === 'update'}
            <p>{t('bulk.changesTitle')}</p>
            <ul class="bulk-keys">
              {#each prepareSafe(fields) as change (change.column)}<li>
                  <strong>{change.column}</strong>
                  =
                  <code
                    >{change.value.kind === 'null'
                      ? 'NULL'
                      : change.value.value === ''
                        ? '""'
                        : change.value.value}</code
                  >
                </li>{/each}
            </ul>
          {/if}
          <PlanPreview statements={[]} warnings={plan.warnings} planSha256={plan.plan_sha256} />
          {#if action === 'copy'}<p>{t('bulk.copyNote')}</p>{/if}
          {#if action === 'delete'}<p class="bulk-warning">
              <TriangleAlert size={16} />{t('bulk.deleteNote')}
            </p>{/if}
          <p>{t('bulk.atomicNote')}</p>
          {#if operation.phase === 'planned' || operation.consumed}
            {#if action === 'delete'}
              <label
                >{t('bulk.typeCount', { count: rows.length })}<input
                  bind:value={typedCount}
                  inputmode="numeric"
                  autocomplete="off"
                  aria-label={t('bulk.typeCount', { count: rows.length })}
                  data-testid="bulk-typed"
                  disabled={operation.consumed}
                /></label
              >
            {/if}
            <label class="check"
              ><input type="checkbox" bind:checked={confirmed} disabled={operation.consumed} />{t(
                'bulk.confirm',
                {
                  count: plan.row_count,
                },
              )}</label
            >
            <div class="dialog-actions">
              <Button variant="outline" onclick={needsInput ? back : close}
                >{t(needsInput ? 'bulk.back' : 'bulk.discard')}</Button
              >
              <Button
                variant={action === 'delete' ? 'destructive' : 'default'}
                onclick={execute}
                disabled={!canExecute}
                data-testid="bulk-execute">{t(`bulk.run.${action}`)}</Button
              >
            </div>
          {/if}
        </section>
      {/if}

      {#if operation.result}
        <section
          class="bulk-grid"
          data-testid="bulk-result"
          data-outcome={operation.result.outcome}
        >
          <h3>{t(outcomeKey(operation.result.outcome))}</h3>
          {#if operation.result.reason}<p data-testid="bulk-reason">
              {t(reasonKey(operation.result.reason))} (<code>{operation.result.reason}</code>)
            </p>{/if}
          {#if operation.unknown}<p class="bulk-warning" role="alert" data-testid="bulk-unknown">
              <TriangleAlert size={16} />{t('bulk.unknown')}
            </p>{/if}
          <ul class="bulk-keys">
            {#each operation.result.rows as row (row.index)}<li
                data-testid="bulk-row-result"
                data-outcome={row.outcome}
              >
                {t('bulk.rowResult', {
                  n: row.index + 1,
                  state: t(outcomeKey(row.outcome)),
                })}
              </li>{/each}
          </ul>
          {#each resultRows as row (row.index)}
            <p class="row-help">{t('bulk.afterRow', { n: row.index + 1 })}</p>
            <ResultTable result={snapshotResult(row.row!, description)} />
          {/each}
        </section>
      {/if}

      {#if operation.phase === 'finished' || operation.phase === 'unknown'}
        <div class="dialog-actions">
          <Button onclick={close} data-testid="bulk-close">{t('bulk.closeReload')}</Button>
        </div>
      {:else if operation.phase === 'idle' && operation.error}
        <div class="dialog-actions">
          <Button variant="outline" onclick={close}>{t('bulk.closeReload')}</Button>
        </div>
      {/if}
    {/if}
  </Dialog.Content>
</Dialog.Root>
