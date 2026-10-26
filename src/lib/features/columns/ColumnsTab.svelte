<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { ArrowDownUp, Pencil, Plus, Trash2, TriangleAlert } from '@lucide/svelte';
  import { toConnection } from '$lib/api';
  import CapabilityNotice from '$lib/components/shared/CapabilityNotice.svelte';
  import ConfirmDestructiveDialog from '$lib/components/shared/ConfirmDestructiveDialog.svelte';
  import PlanPreview from '$lib/components/shared/PlanPreview.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import type { FeatureProps } from '$lib/features';
  import { t } from '$lib/i18n';
  import { getShellContext } from '$lib/shell/context';
  import { tables, type TableDescription } from '$lib/tables';
  import { columnsClient, columnsErrorMessage, errorCode } from './client';
  import DefinitionForm from './DefinitionForm.svelte';
  import { Operation } from './operation.svelte';
  import {
    MAX_CHANGES,
    apiDriverOf,
    batchIssues,
    buildChange,
    changeIssues,
    describeChange,
    draftFromColumn,
    emptyDefinition,
    noPosition,
    observationText,
    reasonText,
    usesPositions,
    type ActionKey,
    type ColumnsCapabilities,
    type PendingChange,
  } from './model';

  let { connection, token, object, onwritephase }: FeatureProps = $props();
  const shell = getShellContext();
  const uid = $props.id();

  let caps = $state<ColumnsCapabilities | null>(null);
  let capsState = $state<'loading' | 'ready' | 'unsupported' | 'failed'>('loading');
  let capsMessage = $state('');
  let description = $state<TableDescription | null>(null);
  let describeState = $state<'loading' | 'ready' | 'failed'>('loading');
  let describeMessage = $state('');
  let pending = $state<PendingChange[]>([]);
  let editing = $state<PendingChange | null>(null);
  let confirmed = $state(false);
  let dialogOpen = $state(false);
  let nextId = 1;
  let loadGeneration = 0;

  const driver = $derived(connection ? apiDriverOf(connection.driver) : 'sqlite');
  const ref = $derived(
    object ? { ...(object.schema ? { schema: object.schema } : {}), name: object.name } : null,
  );
  const objectKey = $derived(object ? `${object.schema ?? ''}\u0000${object.name}` : '');
  const writeBusy = $derived(!!shell?.session.writeInFlight);
  const columns = $derived(description?.columns ?? []);
  const existing = $derived(columns.map((column) => column.name));
  const types = $derived(caps?.types[driver] ?? []);
  const support = (action: ActionKey) => caps?.drivers[driver][action];
  const isBase = $derived(description?.kind === 'table' && object?.type !== 'view');
  // MySQL/MariaDB only alter InnoDB tables; the description reports the engine.
  const engineBlocked = $derived(
    driver === 'mysql' &&
      !!description?.storage_engine &&
      description.storage_engine.toLowerCase() !== 'innodb',
  );

  const operation = new Operation({
    context: () => ({
      connection: connection ? toConnection(connection) : null,
      token,
      table: ref,
    }),
    onphase: (phase) => onwritephase(phase),
    onfinished: (result, unknown) => {
      if (unknown || result?.outcome === 'completed') {
        pending = [];
        editing = null;
        void loadDescription();
      }
    },
  });

  async function loadCapabilities() {
    capsState = 'loading';
    caps = null;
    capsMessage = '';
    const controller = new AbortController();
    capsController?.abort();
    capsController = controller;
    try {
      const data = await columnsClient.capabilities(token, controller.signal);
      if (controller.signal.aborted) return;
      caps = data;
      capsState = 'ready';
    } catch (cause) {
      if (controller.signal.aborted) return;
      capsMessage = columnsErrorMessage(cause);
      capsState = errorCode(cause) === 'unsupported_feature' ? 'unsupported' : 'failed';
    }
  }
  let capsController: AbortController | null = null;
  let describeController: AbortController | null = null;

  async function loadDescription() {
    if (!connection || !ref) return;
    const current = ++loadGeneration;
    describeController?.abort();
    const controller = new AbortController();
    describeController = controller;
    describeState = 'loading';
    describeMessage = '';
    try {
      const data = await tables.describe(
        { connection: toConnection(connection), table: ref },
        token,
        controller.signal,
      );
      if (current !== loadGeneration) return;
      description = data;
      describeState = 'ready';
    } catch (cause) {
      if (current !== loadGeneration || controller.signal.aborted) return;
      description = null;
      describeMessage = columnsErrorMessage(cause);
      describeState = 'failed';
    }
  }

  $effect(() => {
    token;
    connection;
    untrack(() => void loadCapabilities());
    return () => capsController?.abort();
  });
  // A different table, connection or token starts from a clean state.
  $effect(() => {
    objectKey;
    connection;
    token;
    const ready = capsState === 'ready';
    untrack(() => {
      operation.reset();
      pending = [];
      editing = null;
      confirmed = false;
      dialogOpen = false;
      description = null;
      if (ready) void loadDescription();
    });
    return () => {
      loadGeneration++;
      describeController?.abort();
    };
  });
  // Re-reading the table after a finished write keeps the list truthful.
  const locked = $derived(
    operation.phase === 'planned' ||
      operation.phase === 'executing' ||
      operation.phase === 'finished',
  );

  function startAction(action: ActionKey, column?: string) {
    if (locked || writeBusy) return;
    const source = column ? columns.find((c) => c.name === column) : undefined;
    const base: PendingChange = {
      id: nextId++,
      action,
      column: column ?? '',
      newName: '',
      definition: emptyDefinition(),
      position: noPosition(),
    };
    if (action === 'add') {
      base.definition.nullable = true;
    } else if ((action === 'change' || action === 'reorder') && source) {
      base.definition = draftFromColumn(source, driver, action);
      if (action === 'change' && driver === 'postgres') base.definition.commentSet = false;
    }
    if (action === 'drop' || action === 'rename') {
      const entry = base;
      if (action === 'drop') {
        addPending(entry);
        return;
      }
    }
    editing = base;
  }

  const editingIssues = $derived(
    editing && caps ? changeIssues(editing, { driver, existing }, types) : [],
  );
  const pendingIssues = $derived(batchIssues(pending, { driver, existing }));
  const batchProblems = $derived(pending.length === 0 ? [] : pendingIssues);
  const canPlan = $derived(
    pending.length > 0 &&
      batchProblems.length === 0 &&
      !locked &&
      !writeBusy &&
      operation.phase !== 'planning',
  );

  function addPending(entry: PendingChange) {
    if (pending.length >= MAX_CHANGES) return;
    pending = [...pending, entry];
    editing = null;
  }
  function commitEditing() {
    if (!editing || editingIssues.length > 0) return;
    addPending(JSON.parse(JSON.stringify(editing)) as PendingChange);
  }
  function removePending(id: number) {
    if (locked) return;
    pending = pending.filter((entry) => entry.id !== id);
  }
  async function showPlan() {
    if (!canPlan) return;
    confirmed = false;
    await operation.loadPlan(pending.map((entry) => buildChange(entry)));
  }
  function editAgain() {
    operation.discardPlan();
    confirmed = false;
    dialogOpen = false;
  }
  function execute(typed?: string) {
    dialogOpen = false;
    void operation.execute(typed);
  }
  // A completed or unknown write already emptied the list (onfinished); after a rejection the
  // user keeps the batch and only the plan is discarded.
  function newBatch() {
    operation.reset();
    editing = null;
    confirmed = false;
    void loadDescription();
  }
  const actionDisabled = (action: ActionKey) =>
    locked || writeBusy || !isBase || engineBlocked || support(action)?.support === 'unsupported';
  const planCount = $derived(operation.plan?.statements.length ?? 0);
</script>

<section class="columns-panel" aria-label={t('columns.heading')} data-testid="columns-tab">
  <h2>{t('columns.heading')}</h2>
  {#if !connection || !object}
    <p class="note">{t('columns.noTable')}</p>
  {:else if capsState === 'loading'}
    <p class="note" role="status">{t('columns.capsLoading')}</p>
  {:else if capsState === 'unsupported'}
    <CapabilityNotice title={t('columns.unsupportedTitle')} reason={capsMessage} />
  {:else if capsState === 'failed'}
    <div class="feedback error-feedback" role="alert">
      <p>{capsMessage}</p>
      <Button variant="outline" size="sm" onclick={() => void loadCapabilities()}
        >{t('columns.retry')}</Button
      >
    </div>
  {:else}
    <p class="note">{t('columns.intro')}</p>
    {#if driver === 'sqlite'}
      <div class="note" role="note" data-testid="sqlite-note">{t('columns.sqliteNote')}</div>
    {/if}
    <ul class="support" data-testid="support-list">
      {#each ['add', 'change', 'rename', 'drop', 'reorder'] as const as action (action)}
        {@const entry = support(action)}
        {#if entry && entry.support !== 'supported'}
          <li data-support={entry.support} data-action={action}>
            <strong>{t(`columns.act_${action}`)}:</strong>
            {entry.support === 'unsupported' ? t('columns.supportNo') : t('columns.supportLimited')}
            {#if entry.reason}<span>{entry.reason}</span>{/if}
          </li>
        {/if}
      {/each}
    </ul>
    {#if describeState === 'loading'}
      <p class="note" role="status">{t('columns.loading')}</p>
    {:else if describeState === 'failed'}
      <div class="feedback error-feedback" role="alert">
        <p>{describeMessage}</p>
        <Button variant="outline" size="sm" onclick={() => void loadDescription()}
          >{t('columns.retry')}</Button
        >
      </div>
    {:else if description}
      {#if !isBase}
        <CapabilityNotice title={t('columns.notBaseTitle')} reason={t('columns.notBase')} />
      {/if}
      {#if engineBlocked}
        <CapabilityNotice
          title={t('columns.engineTitle')}
          reason={t('columns.engineBlocked', { engine: description.storage_engine })}
        />
      {/if}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable table needs a keyboard focus target.) -->
      <div class="table-scroll" role="region" tabindex="0" aria-label={t('columns.listCaption')}>
        <table data-testid="column-list">
          <caption class="sr-only">{t('columns.listCaption')}</caption>
          <thead>
            <tr>
              <th>{t('columns.colPosition')}</th>
              <th>{t('columns.colName')}</th>
              <th>{t('columns.colType')}</th>
              <th>{t('columns.colNull')}</th>
              <th>{t('columns.colDefault')}</th>
              <th>{t('columns.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {#each columns as column, index (column.name)}
              {@const special = column.generated !== 'none'}
              <tr data-column={column.name}>
                <td>{index + 1}</td>
                <td class="name">
                  <code>{column.name}</code>
                  {#if column.pk_position > 0}<span class="badge">PK</span>{/if}
                  {#if special}<span class="badge" title={t('columns.generatedHint')}
                      >{t('columns.generated')}</span
                    >{/if}
                </td>
                <td><code>{column.database_type}</code></td>
                <td>{column.nullable ? t('columns.yes') : t('columns.no')}</td>
                <td>{column.default_value ?? '–'}</td>
                <td class="row-actions">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={actionDisabled('change') || special}
                    aria-label={t('columns.changeColumn', { name: column.name })}
                    onclick={() => startAction('change', column.name)}
                    ><Pencil size={14} />{t('columns.act_change')}</Button
                  >
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={actionDisabled('rename')}
                    aria-label={t('columns.renameColumn', { name: column.name })}
                    onclick={() => startAction('rename', column.name)}
                    >{t('columns.act_rename')}</Button
                  >
                  {#if usesPositions(driver)}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={actionDisabled('reorder') || special}
                      aria-label={t('columns.moveColumn', { name: column.name })}
                      onclick={() => startAction('reorder', column.name)}
                      ><ArrowDownUp size={14} />{t('columns.act_reorder')}</Button
                    >
                  {/if}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={actionDisabled('drop')}
                    aria-label={t('columns.dropColumn', { name: column.name })}
                    onclick={() => startAction('drop', column.name)}
                    ><Trash2 size={14} />{t('columns.act_drop')}</Button
                  >
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="note">{t('columns.listHint')}</p>
      <div class="actions">
        <Button
          variant="outline"
          disabled={actionDisabled('add')}
          onclick={() => startAction('add')}><Plus size={16} />{t('columns.addColumn')}</Button
        >
      </div>

      {#if editing}
        <form
          class="editor"
          data-testid="column-editor"
          aria-label={t(`columns.act_${editing.action}`)}
          onsubmit={(event) => {
            event.preventDefault();
            commitEditing();
          }}
        >
          <h3>
            {editing.action === 'add'
              ? t('columns.editAdd')
              : t(`columns.edit_${editing.action}`, { name: editing.column })}
          </h3>
          {#if editing.action === 'rename'}
            <div class="field">
              <label for="{uid}-new-name">{t('columns.fieldNewName')}</label>
              <Input id="{uid}-new-name" bind:value={editing.newName} autocomplete="off" />
              {#each editingIssues as issue (issue.message)}<small class="issue"
                  >{issue.message}</small
                >{/each}
            </div>
          {:else}
            {#if editing.action === 'change' || editing.action === 'reorder'}
              <div class="note" role="note">
                {driver === 'mysql' ? t('columns.replaceNoteMysql') : t('columns.replaceNote')}
              </div>
            {/if}
            <DefinitionForm
              bind:draft={editing.definition}
              bind:position={editing.position}
              issues={editingIssues}
              {types}
              {driver}
              action={editing.action as 'add' | 'change' | 'reorder'}
              {existing}
              self={editing.column}
              oldType={editing.action === 'add'
                ? undefined
                : columns.find((c) => c.name === editing?.column)?.database_type}
              oldDefault={editing.action === 'add'
                ? undefined
                : columns.find((c) => c.name === editing?.column)?.default_value}
            />
          {/if}
          <div class="actions">
            <Button type="submit" disabled={editingIssues.length > 0}
              >{t('columns.addToList')}</Button
            >
            <Button type="button" variant="outline" onclick={() => (editing = null)}
              >{t('columns.cancelEdit')}</Button
            >
          </div>
        </form>
      {/if}

      <section class="pending" aria-label={t('columns.pendingHeading')}>
        <h3>{t('columns.pendingHeading')}</h3>
        {#if pending.length === 0}
          <p class="note">{t('columns.pendingEmpty')}</p>
        {:else}
          <ol data-testid="pending-list">
            {#each pending as entry (entry.id)}
              <li>
                <span>{describeChange(entry)}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={locked}
                  aria-label={t('columns.removeEntry', { text: describeChange(entry) })}
                  onclick={() => removePending(entry.id)}>{t('columns.removeFromList')}</Button
                >
              </li>
            {/each}
          </ol>
        {/if}
        {#if batchProblems.length}
          <div class="feedback error-feedback" role="status" data-testid="batch-issues">
            <ul>
              {#each batchProblems as problem (problem)}<li>{problem}</li>{/each}
            </ul>
          </div>
        {/if}
        <div class="actions">
          <Button disabled={!canPlan} onclick={() => void showPlan()}
            >{operation.phase === 'planning'
              ? t('columns.planning')
              : t('columns.showPlan')}</Button
          >
        </div>
        {#if operation.error && operation.phase !== 'finished'}
          <div class="feedback error-feedback" role="alert" data-testid="plan-error">
            <TriangleAlert size={18} /><span>{operation.error}</span>
          </div>
        {/if}
      </section>

      {#if operation.plan && operation.phase !== 'idle'}
        {@const plan = operation.plan}
        <section class="plan" data-testid="columns-plan" aria-label={t('columns.planHeading')}>
          <h3>{t('columns.planHeading')}</h3>
          <PlanPreview
            statements={plan.statements}
            warnings={plan.warnings}
            planSha256={plan.plan_sha256}
          />
          <div data-testid="plan-affected">
            <strong>{t('columns.affected')}</strong>
            <ul>
              {#each plan.affected_objects as name (name)}<li><code>{name}</code></li>{/each}
            </ul>
          </div>
          {#if plan.dependencies.length}
            <div data-testid="plan-dependencies">
              <strong>{t('columns.dependencies')}</strong>
              <ul>
                {#each plan.dependencies as dependency (dependency)}<li>{dependency}</li>{/each}
              </ul>
            </div>
          {/if}
          <p class="note" data-testid="plan-transaction">
            {plan.ddl_transactional ? t('columns.transactional') : t('columns.notTransactional')}
          </p>
          {#if driver === 'mysql' && pending.some((entry) => entry.action === 'change' || entry.action === 'reorder')}
            <div class="feedback error-feedback" role="note" data-testid="plan-replaces">
              <TriangleAlert size={18} /><span>{t('columns.replaceWarnPlan')}</span>
            </div>
          {/if}
          {#if plan.destructive}
            <div class="feedback error-feedback" role="note" data-testid="plan-destructive">
              <TriangleAlert size={18} /><span
                >{t('columns.destructive', { name: plan.target_name })}</span
              >
            </div>
          {/if}
          {#if operation.phase === 'planned' || operation.phase === 'executing'}
            {#if !plan.destructive}
              <label class="check">
                <input
                  type="checkbox"
                  bind:checked={confirmed}
                  disabled={operation.phase === 'executing'}
                />
                {t('columns.confirmCheck', { count: planCount })}
              </label>
            {/if}
            <div class="actions">
              {#if plan.destructive}
                <Button
                  variant="destructive"
                  disabled={operation.phase !== 'planned' || writeBusy}
                  onclick={() => (dialogOpen = true)}>{t('columns.executeDestructive')}</Button
                >
              {:else}
                <Button
                  disabled={!confirmed || operation.phase !== 'planned' || writeBusy}
                  onclick={() => execute()}
                  >{operation.phase === 'executing'
                    ? t('columns.executing')
                    : t('columns.execute')}</Button
                >
              {/if}
              <Button
                variant="outline"
                disabled={operation.phase === 'executing'}
                onclick={editAgain}>{t('columns.editAgain')}</Button
              >
            </div>
          {/if}
        </section>
        <ConfirmDestructiveDialog
          bind:open={dialogOpen}
          title={t('columns.dialogTitle')}
          description={t('columns.dialogDescription', { name: plan.target_name })}
          targetName={plan.target_name}
          confirmLabel={t('columns.executeDestructive')}
          busy={operation.phase === 'executing'}
          onconfirm={() => execute(plan.target_name)}
        />
      {/if}

      {#if operation.phase === 'finished'}
        <div
          class={operation.result?.outcome === 'completed'
            ? 'feedback success-feedback result-box'
            : 'feedback error-feedback result-box'}
          role="status"
          data-testid="columns-result"
        >
          {#if operation.result}
            <div>
              <strong>
                {operation.result.outcome === 'completed'
                  ? t('columns.resultCompleted')
                  : operation.result.outcome === 'rejected'
                    ? t('columns.resultRejected')
                    : t('columns.resultUnknown')}
              </strong>
              {#if operation.result.outcome === 'rejected'}<p>
                  {reasonText(operation.result.reason)}
                </p>{/if}
              {#if operation.result.outcome === 'outcome_unknown'}<p>
                  {t('columns.unknownHint')}
                </p>{/if}
              <p>
                {t('columns.resultStatements', { count: operation.result.statements_executed })} ·
                {observationText(operation.result.observation)}
              </p>
              {#if operation.result.outcome === 'completed' && operation.result.atomic}<p>
                  {t('columns.atomic')}
                </p>{/if}
            </div>
          {:else}
            <div>
              <strong
                >{operation.unknown
                  ? t('columns.resultUnknown')
                  : t('columns.resultFailed')}</strong
              >
              <p>{operation.error}</p>
              {#if operation.unknown}<p>{t('columns.unknownHint')}</p>{/if}
            </div>
          {/if}
          <Button variant="outline" onclick={newBatch}
            >{pending.length > 0 ? t('columns.backToList') : t('columns.newBatch')}</Button
          >
        </div>
      {/if}
    {/if}
  {/if}
</section>

<style>
  .columns-panel {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.75rem;
    min-width: 0;
    padding: 1rem;
  }
  h2,
  h3,
  p {
    margin: 0;
  }
  .note,
  small {
    color: var(--color-muted-foreground);
    font-size: 0.8125rem;
  }
  .support {
    margin: 0;
    padding-left: 1.25rem;
    font-size: 0.8125rem;
    color: var(--color-muted-foreground);
  }
  .table-scroll {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    font-size: 0.8125rem;
  }
  th,
  td {
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--color-border);
    text-align: left;
    vertical-align: top;
  }
  code {
    overflow-wrap: anywhere;
  }
  .row-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .badge {
    padding: 0 0.25rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-size: 0.6875rem;
  }
  .editor,
  .pending,
  .plan {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.625rem;
    padding: 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-muted);
  }
  .pending ol {
    display: grid;
    gap: 0.375rem;
    margin: 0;
    padding-left: 1.25rem;
  }
  .pending li {
    overflow-wrap: anywhere;
  }
  .pending li :global(button) {
    margin-left: 0.5rem;
  }
  .field {
    display: grid;
    gap: 0.25rem;
  }
  .field label {
    font-size: 0.8125rem;
    font-weight: 600;
  }
  .issue {
    color: var(--color-destructive);
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.9375rem;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .result-box {
    flex-wrap: wrap;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
