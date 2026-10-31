<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { Plus, Pencil, Trash2, TriangleAlert } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';
  import * as Dialog from '$lib/components/ui/dialog';
  import ResultTable from './ResultTable.svelte';
  import TransformEditor from '$lib/features/transformations/TransformEditor.svelte';
  import type { TransformState } from '$lib/features/transformations/state.svelte';
  import ExportControls from './ExportControls.svelte';
  import BulkDialog from '$lib/features/bulk/BulkDialog.svelte';
  import FileValuePanel from '$lib/features/bulk/FileValuePanel.svelte';
  import FkLookup from '$lib/features/bulk/FkLookup.svelte';
  import { bulkClient } from '$lib/features/bulk/client';
  import {
    fileColumn,
    noSupport,
    selection as buildSelection,
    singleForeignKeys,
    supportFor,
    type Action as BulkAction,
    type ForeignKeyInfo,
  } from '$lib/features/bulk/model';
  import { structure as structureClient } from '$lib/structure';
  import { t } from '$lib/i18n';
  import { ApiError, apiDriver, toConnection } from '$lib/api';
  import { tables, tableResult, type BrowseResult } from '$lib/tables';
  import {
    rows,
    copySnapshot,
    defaultKind,
    prepareChanges,
    snapshotResult,
    unknownMessage,
    type Eligibility,
    type Snapshot,
    type Operation,
    type FieldDraft,
    type Change,
    type WritePhase,
  } from '$lib/rows';
  import type { ConnectionDraft } from '$lib/workbench';
  let {
    connection,
    token,
    result,
    onreload,
    onwritephase,
    transforms,
  }: {
    connection: ConnectionDraft;
    token: string;
    result: BrowseResult;
    onreload: () => void;
    onwritephase: (phase: WritePhase) => void;
    /** Column -> transformation assignment of the table (W-P22), for display and input editors. */
    transforms?: TransformState;
  } = $props();
  let eligibility = $state<Eligibility | null>(null);
  let eligibilityMessage = $state(t('rowEditor.checking'));
  let dialogOpen = $state(false);
  let operation = $state<Operation>('insert');
  let phase = $state<
    | 'idle'
    | 'loading'
    | 'editing'
    | 'confirm'
    | 'checking'
    | 'sending'
    | 'done'
    | 'conflict'
    | 'unknown'
    | 'blocked'
  >('idle');
  let original = $state.raw<Snapshot | null>(null);
  let fields = $state<FieldDraft[]>([]);
  let pendingChanges = $state.raw<Change[]>([]);
  let confirmed = $state(false);
  let message = $state('');
  let after = $state.raw<Snapshot | null>(null);
  let needsReload = $state(false);
  let sent = false;
  let destroyed = false;
  // W-P13: multi row selection, file values and foreign key lookup (API 0.19). All optional: without v19 the
  // single row editor behaves exactly as before.
  let support = $state(noSupport());
  let bulkChecked = $state(false);
  let selected = $state<ReadonlySet<number>>(new Set());
  let bulkAction = $state<BulkAction | null>(null);
  let bulkRows = $state.raw<Snapshot[]>([]);
  let bulkKey = $state(0);
  let foreignKeys = $state<ForeignKeyInfo[]>([]);
  let lookupColumn = $state<string | null>(null);
  let lookupColumns = $state<string[]>([]);
  let lookupError = $state('');
  let generation = 0;
  let contextController = new AbortController();
  let operationController = new AbortController();
  const busy = $derived(['loading', 'checking', 'sending'].includes(phase));
  let fileBusy = $state(false);
  // The write request (or a file value transfer) is open: the editor must not be dismissed, otherwise the write
  // lock is dropped while the server may still be writing and the real result is lost.
  const closeBlocked = $derived(phase === 'sending' || fileBusy);
  const display = $derived(tableResult(result));
  const table = $derived(result.description.table);
  const tableLabel = $derived(`${table.schema ? table.schema + '.' : ''}${table.name}`);
  const baseAllowed = (value: Eligibility) =>
    value.update.eligible &&
    value.update.description.kind === 'table' &&
    value.update.description.primary_key.length > 0 &&
    value.update.description.transactional === 'yes';
  const editAllowed = $derived(!!eligibility && baseAllowed(eligibility));
  const insertAllowed = $derived(
    editAllowed &&
      !!eligibility?.insert.eligible &&
      eligibility.insert.description.kind === 'table' &&
      eligibility.insert.description.transactional === 'yes',
  );
  const selectedList = $derived([...selected].sort((a, b) => a - b));
  const selectionResult = $derived({
    ...display,
    rows: selectedList.map((index) => display.rows[index]).filter((row) => !!row),
  });
  const bulkAllowed = $derived(editAllowed && support.bulk && !needsReload);
  const fileColumns = $derived(
    eligibility && support.fileValues
      ? eligibility.update.description.columns
          .filter((column) =>
            fileColumn(
              column,
              eligibility!.update.description.primary_key,
              eligibility!.update.writable_columns,
            ),
          )
          .map((column) => column.name)
      : [],
  );
  const identity = $derived(
    original && eligibility
      ? eligibility.update.description.primary_key
          .map((name) => {
            const index = original!.columns.indexOf(name);
            const cell = original!.values[index];
            return `${name} = ${cell?.kind === 'null' ? 'NULL' : (cell?.value ?? t('rowEditor.notReported'))}`;
          })
          .join(' · ')
      : t('rowEditor.newRowIdentity'),
  );
  const titles = {
    insert: 'rowEditor.titleInsert',
    update: 'rowEditor.titleUpdate',
    delete: 'rowEditor.titleDelete',
  };
  const submitLabels = {
    insert: 'rowEditor.submitInsert',
    update: 'rowEditor.submitUpdate',
    delete: 'rowEditor.submitDelete',
  };
  async function loadEligibility(signal: AbortSignal) {
    return rows.eligibility(toConnection(connection), table, token, signal);
  }
  function verifyAllowed(
    value: Eligibility,
    action: Operation,
    expected: Snapshot | null,
    changes: Change[] = [],
  ) {
    if (!baseAllowed(value) || (action === 'insert' && !value.insert.eligible))
      throw new Error(t('rowEditor.notSuitable'));
    const description = value.update.description;
    if (
      expected &&
      (expected.columns.length !== description.columns.length ||
        expected.values.length !== expected.columns.length ||
        new Set(expected.columns).size !== expected.columns.length ||
        description.columns.some((column) => !expected.columns.includes(column.name)))
    )
      throw new Error(t('rowEditor.structureChanged'));
    const allowed =
      action === 'insert' ? value.insert.insertable_columns : value.update.writable_columns;
    for (const change of changes) {
      const column = description.columns.find((column) => column.name === change.column);
      if (
        !column ||
        !allowed.includes(change.column) ||
        column.generated !== 'none' ||
        (action === 'update' && description.primary_key.includes(column.name))
      )
        throw new Error(t('rowEditor.columnGone'));
      if (
        change.value.kind === 'null' &&
        (!column.nullable || description.primary_key.includes(column.name))
      )
        throw new Error(t('rowEditor.notNull', { column: column.name }));
    }
    if (
      action === 'insert' &&
      value.insert.required_pk.some(
        (name) => !changes.some((change) => change.column === name && change.value.kind !== 'null'),
      )
    )
      throw new Error(t('rowEditor.needKey'));
  }
  async function initialize() {
    try {
      const checked = await loadEligibility(contextController.signal);
      if (destroyed) return;
      eligibility = checked;
      eligibilityMessage = baseAllowed(checked)
        ? t('rowEditor.rechecked')
        : t('rowEditor.notEnabled');
    } catch (cause) {
      if (!destroyed)
        eligibilityMessage =
          cause instanceof Error ? cause.message : t('rowEditor.editorUnavailable');
    }
  }
  async function begin(action: Operation, index?: number) {
    lookupError = '';
    if (busy || needsReload || !eligibility) return;
    operationController.abort();
    operationController = new AbortController();
    const current = ++generation;
    operation = action;
    phase = 'loading';
    message = '';
    confirmed = false;
    after = null;
    pendingChanges = [];
    dialogOpen = true;
    sent = false;
    original =
      index === undefined
        ? null
        : copySnapshot({
            columns: result.result.columns.map((column) => column.name),
            values: result.result.rows[index],
          });
    try {
      const checked = await loadEligibility(operationController.signal);
      if (destroyed || current !== generation) return;
      // Insert key completeness is checked after the user has supplied values.
      if (!baseAllowed(checked) || (action === 'insert' && !checked.insert.eligible))
        throw new Error(t('rowEditor.notReleased'));
      if (action !== 'insert') verifyAllowed(checked, action, original);
      eligibility = checked;
      fields = checked.update.description.columns.map((column) => {
        const cell = original?.values[original.columns.indexOf(column.name)];
        const locked =
          action === 'insert'
            ? !checked.insert.insertable_columns.includes(column.name) ||
              checked.insert.auto_pk === column.name ||
              column.generated !== 'none'
            : !checked.update.writable_columns.includes(column.name) ||
              checked.update.description.primary_key.includes(column.name) ||
              column.generated !== 'none';
        return {
          column: column.name,
          locked,
          mode:
            action === 'insert'
              ? checked.insert.required_pk.includes(column.name)
                ? 'value'
                : 'default'
              : 'unchanged',
          kind: cell && cell.kind !== 'null' ? cell.kind : defaultKind(column.database_type),
          value: cell?.value ?? '',
        };
      });
      phase = action === 'delete' ? 'confirm' : 'editing';
      if (action !== 'delete') void loadForeignKeys();
    } catch (cause) {
      if (!destroyed && current === generation) {
        phase = 'blocked';
        message = cause instanceof Error ? cause.message : t('rowEditor.prepareFailed');
      }
    }
  }
  function review() {
    try {
      for (const field of fields) {
        if (field.locked || field.mode !== 'value') continue;
        if (transforms?.inputProblem(field.column, field.value))
          throw new Error(t('transform.blocked', { column: field.column }));
      }
      const changes = prepareChanges(fields, operation);
      verifyAllowed(eligibility!, operation, original, changes);
      pendingChanges = changes.map((change) => ({
        column: change.column,
        value: { ...change.value },
      }));
      message = '';
      confirmed = false;
      phase = 'confirm';
    } catch (cause) {
      message = cause instanceof Error ? cause.message : t('rowEditor.checkInput');
    }
  }
  async function submit() {
    if (phase !== 'confirm' || !confirmed || busy || !eligibility) return;
    phase = 'checking';
    message = '';
    const current = generation;
    const expected = original ? copySnapshot(original) : null;
    const changes = pendingChanges.map((change) => ({
      column: change.column,
      value: { ...change.value },
    }));
    try {
      const fresh = await loadEligibility(operationController.signal);
      if (destroyed || current !== generation || operationController.signal.aborted) return;
      verifyAllowed(fresh, operation, expected, changes);
      eligibility = fresh;
      const response = await rows.mutate(
        operation,
        toConnection(connection),
        table,
        expected,
        changes,
        token,
        operationController.signal,
        () => {
          sent = true;
          phase = 'sending';
          onwritephase('sending');
        },
      );
      if (destroyed || current !== generation) return;
      onwritephase('settled');
      sent = false;
      needsReload = true;
      after = response.row ? copySnapshot(response.row) : null;
      message =
        operation === 'delete'
          ? t('rowEditor.doneDelete')
          : operation === 'update' && 'changed' in response && !response.changed
            ? t('rowEditor.doneUnchanged')
            : t('rowEditor.doneSave');
      phase = 'done';
      fields = [];
      pendingChanges = [];
    } catch (cause) {
      if (destroyed || current !== generation) return;
      needsReload = true;
      if (cause instanceof ApiError && cause.code === 'outcome_unknown') {
        phase = 'unknown';
        message = unknownMessage();
        onwritephase('unknown');
      } else {
        phase =
          cause instanceof ApiError && ['row_conflict', 'insert_conflict'].includes(cause.code)
            ? 'conflict'
            : 'blocked';
        message = cause instanceof Error ? cause.message : t('rowEditor.notConfirmed');
        onwritephase('settled');
      }
      sent = false;
      fields = [];
      pendingChanges = [];
    }
  }
  function close() {
    if (closeBlocked) return;
    const reload = needsReload || (busy && sent);
    if (busy && sent) onwritephase('unknown');
    operationController.abort();
    generation++;
    dialogOpen = false;
    original = null;
    fields = [];
    pendingChanges = [];
    after = null;
    confirmed = false;
    phase = 'idle';
    sent = false;
    if (reload) onreload();
  }
  // Foreign keys are only needed for the lookup buttons of the open editor. They are read when an editor opens, not
  // when the page loads: browsing, paging and exporting cause no catalog read of their own.
  let foreignKeysLoaded = false;
  async function loadForeignKeys() {
    if (foreignKeysLoaded || !support.lookup || destroyed) return;
    try {
      const found = await structureClient.read(
        toConnection(connection),
        table,
        token,
        contextController.signal,
      );
      if (destroyed) return;
      foreignKeys = singleForeignKeys(found);
      foreignKeysLoaded = true;
    } catch (cause) {
      if (destroyed || contextController.signal.aborted) return;
      // Not remembered: the next editor opens retries. The user sees why the lookup helpers are missing.
      foreignKeys = [];
      lookupError = t('rowEditor.fkLoadFailed', {
        reason: cause instanceof Error ? cause.message : '',
      });
    }
  }
  async function loadBulk() {
    try {
      const caps = await bulkClient.capabilities(token, contextController.signal);
      if (destroyed) return;
      support = supportFor(caps, apiDriver(connection.driver));
    } catch {
      if (!destroyed) support = noSupport();
    } finally {
      if (!destroyed) bulkChecked = true;
    }
  }
  function setSelected(index: number, on: boolean) {
    const next = new Set(selected);
    if (on && next.size < support.maxRows) next.add(index);
    else next.delete(index);
    selected = next;
  }
  function selectAll(on: boolean) {
    selected = on
      ? new Set(Array.from({ length: Math.min(display.rows.length, support.maxRows) }, (_, i) => i))
      : new Set();
  }
  function startBulk(action: BulkAction) {
    if (!bulkAllowed || busy || selected.size === 0) return;
    try {
      bulkRows = buildSelection(display, selected).snapshots;
      bulkKey++;
      bulkAction = action;
    } catch (cause) {
      eligibilityMessage = cause instanceof Error ? cause.message : t('bulk.err.invalidInput');
    }
  }
  function endBulk(reload: boolean) {
    bulkAction = null;
    bulkRows = [];
    selected = new Set();
    if (reload) {
      needsReload = true;
      onreload();
    }
  }
  async function openLookup(column: string) {
    const info = foreignKeys.find((item) => item.column === column);
    if (!info) return;
    lookupError = '';
    try {
      const target = await tables.describe(
        { connection: toConnection(connection), table: info.target },
        token,
        operationController.signal,
      );
      if (destroyed || phase !== 'editing') return;
      lookupColumns = target.columns.map((item) => item.name);
      lookupColumn = column;
    } catch (cause) {
      lookupError = cause instanceof Error ? cause.message : t('bulk.fk.unavailable');
    }
  }
  function pickLookup(column: string, cell: { kind: string; value?: string }) {
    const field = fields.find((item) => item.column === column);
    if (field && cell.kind !== 'null') {
      field.mode = 'value';
      field.kind = cell.kind as FieldDraft['kind'];
      field.value = cell.value ?? '';
    }
    lookupColumn = null;
  }
  $effect(() => {
    // A reload or a new page replaces the rows: an old selection would point at other rows.
    void result;
    untrack(() => {
      selected = new Set();
    });
  });
  onMount(() => {
    // Sequential on purpose: SQLite answers concurrent requests on one database with database_busy, and the
    // structure read of the foreign key lookup must never make the eligibility check of the editor fail.
    void initialize().then(() => (destroyed ? undefined : loadBulk()));
  });
  onDestroy(() => {
    destroyed = true;
    generation++;
    if (busy && sent) onwritephase('unknown');
    contextController.abort();
    operationController.abort();
    fields = [];
    original = null;
    pendingChanges = [];
    after = null;
  });
</script>

<div class="row-tools">
  <p>{eligibilityMessage}</p>
  {#if insertAllowed}<Button
      variant="outline"
      size="sm"
      disabled={busy || needsReload}
      onclick={() => begin('insert')}><Plus size={14} />{t('rowEditor.add')}</Button
    >{/if}
</div>
{#if selected.size > 0}
  <div class="bulk-bar" role="group" aria-label={t('bulk.barLabel')} data-testid="bulk-bar">
    <p data-testid="bulk-count">
      {t('bulk.selected', { count: selected.size, max: support.maxRows })}
    </p>
    {#if bulkAllowed}
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onclick={() => startBulk('update')}
        data-testid="bulk-update">{t('bulk.update')}</Button
      >
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onclick={() => startBulk('copy')}
        data-testid="bulk-copy">{t('bulk.copy')}</Button
      >
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onclick={() => startBulk('delete')}
        data-testid="bulk-delete">{t('bulk.delete')}</Button
      >
    {/if}
    <Button variant="ghost" size="sm" onclick={() => (selected = new Set())}
      >{t('bulk.clear')}</Button
    >
  </div>
  {#key selected}
    <ExportControls
      result={selectionResult}
      scope={{
        kind: 'table_selection',
        offset: result.offset,
        page_size: result.page_size,
        has_more: result.has_more,
      }}
    />
  {/key}
{/if}
{#if bulkChecked && !support.bulk && eligibility}<p class="row-help" data-testid="bulk-unavailable">
    {t('bulk.unavailable')}
  </p>{/if}
<ResultTable
  selection={bulkChecked && display.rows.length
    ? {
        selected,
        max: support.maxRows,
        disabled: busy || !!bulkAction,
        onchange: setSelected,
        onall: selectAll,
      }
    : undefined}
  result={display}
  {transforms}
  exportScope={{
    kind: 'table_page',
    offset: result.offset,
    page_size: result.page_size,
    has_more: result.has_more,
  }}
  onedit={editAllowed && !needsReload ? (index) => begin('update', index) : undefined}
  ondelete={editAllowed && !needsReload ? (index) => begin('delete', index) : undefined}
  actionsDisabled={busy}
/>
{#if bulkAction && eligibility}
  {#key bulkKey}
    <BulkDialog
      {connection}
      {token}
      {table}
      description={eligibility.update.description}
      writable={eligibility.update.writable_columns}
      requiredPk={eligibility.insert.required_pk}
      action={bulkAction}
      rows={bulkRows}
      onclose={endBulk}
      {onwritephase}
    />
  {/key}
{/if}
<Dialog.Root
  bind:open={dialogOpen}
  onOpenChange={(open) => {
    if (open) return;
    if (closeBlocked) {
      dialogOpen = true;
      return;
    }
    close();
  }}
>
  <Dialog.Content class="sm:max-w-[900px] max-h-[90dvh] overflow-y-auto p-6">
    <Dialog.Header
      ><Dialog.Title>{t(titles[operation])}</Dialog.Title><Dialog.Description
        >{tableLabel} · {identity}</Dialog.Description
      ></Dialog.Header
    >
    {#if busy}<div class="row-status" role="status">
        {phase === 'loading' || phase === 'checking'
          ? t('rowEditor.statusChecking')
          : t('rowEditor.statusSent')}
      </div>{/if}
    {#if message}<div
        class="row-message"
        class:row-warning={phase === 'unknown' || phase === 'conflict'}
        role={phase === 'done' ? 'status' : 'alert'}
      >
        {#if phase === 'unknown' || phase === 'conflict'}<TriangleAlert size={18} />{/if}<span
          >{message}</span
        >
      </div>{/if}
    {#if phase === 'editing'}
      <p class="row-help">
        {operation === 'insert' ? t('rowEditor.helpInsert') : t('rowEditor.helpEdit')}
      </p>
      <div class="row-field-list">
        {#each fields as field}<div class="row-field">
            <div>
              <strong>{field.column}</strong><small
                >{eligibility?.update.description.columns.find(
                  (column) => column.name === field.column,
                )?.database_type}</small
              >
            </div>
            {#if field.locked}<p>
                {operation === 'insert' && eligibility?.insert.auto_pk === field.column
                  ? t('rowEditor.keyAssigned')
                  : operation === 'insert'
                    ? t('rowEditor.computed')
                    : t('rowEditor.locked')}{#if operation !== 'insert'}
                  · {original?.values[original.columns.indexOf(field.column)]?.kind === 'null'
                    ? 'NULL'
                    : field.value}{/if}
              </p>{:else}<label
                >{t('rowEditor.fieldMode', { column: field.column })}<select
                  aria-label={t('rowEditor.fieldMode', { column: field.column })}
                  bind:value={field.mode}
                  ><option value={operation === 'insert' ? 'default' : 'unchanged'}
                    >{operation === 'insert'
                      ? t('rowEditor.modeDefault')
                      : t('rowEditor.modeUnchanged')}</option
                  >{#if eligibility?.update.description.columns.find((column) => column.name === field.column)?.nullable && !eligibility?.update.description.primary_key.includes(field.column)}<option
                      value="null">NULL</option
                    >{/if}<option value="value">{t('rowEditor.modeValue')}</option></select
                ></label
              >{#if field.mode === 'value'}<label
                  >{t('rowEditor.fieldKind', { column: field.column })}<select
                    aria-label={t('rowEditor.fieldKind', { column: field.column })}
                    bind:value={field.kind}
                    ><option value="text">Text</option><option value="integer"
                      >{t('rowEditor.kindInteger')}</option
                    ><option value="decimal">{t('rowEditor.kindDecimal')}</option><option
                      value="float">{t('rowEditor.kindFloat')}</option
                    ><option value="boolean">{t('rowEditor.kindBoolean')}</option><option
                      value="binary">{t('rowEditor.kindBinary')}</option
                    ><option value="timestamp">{t('rowEditor.kindTimestamp')}</option></select
                  ></label
                >{#if transforms?.mappingFor(field.column)?.input}{@const input =
                    transforms.mappingFor(field.column)!.input!}<TransformEditor
                    column={field.column}
                    id={input.id}
                    options={input.options}
                    bind:value={field.value}
                    {transforms}
                  />{:else}<label
                    >{t('rowEditor.fieldValue', { column: field.column })}<Textarea
                      aria-label={t('rowEditor.fieldValue', { column: field.column })}
                      bind:value={field.value}
                      rows={2}
                      maxlength={1048576}
                      autocomplete="off"
                      spellcheck={false}
                    /></label
                  >{/if}{#if foreignKeys.some((fk) => fk.column === field.column)}<Button
                    variant="outline"
                    size="sm"
                    onclick={() => openLookup(field.column)}
                    data-testid={`fk-open-${field.column}`}
                    >{t('bulk.fk.open', { column: field.column })}</Button
                  >{/if}{#if lookupColumn === field.column}{@const info = foreignKeys.find(
                    (fk) => fk.column === field.column,
                  )}{#if info}<FkLookup
                      {connection}
                      {token}
                      {table}
                      column={field.column}
                      displayColumns={lookupColumns}
                      initialDisplay={lookupColumns.find((name) => name !== info.targetColumn) ??
                        info.targetColumn}
                      onpick={(cell) => pickLookup(field.column, cell)}
                      onclose={() => (lookupColumn = null)}
                    />{/if}{/if}{/if}{/if}
          </div>{/each}
      </div>
      {#if lookupError}<p role="alert">{lookupError}</p>{/if}
      {#if operation === 'update' && original && fileColumns.length}
        <FileValuePanel
          {connection}
          {token}
          {table}
          expected={original}
          columns={fileColumns}
          maxBytes={support.maxFileBytes}
          disabled={busy}
          {onwritephase}
          onchanged={() => (needsReload = true)}
          onbusychange={(value) => (fileBusy = value)}
        />
      {/if}
      <div class="row-dialog-actions">
        <Button variant="outline" onclick={close} disabled={closeBlocked}
          >{t('rowEditor.discard')}</Button
        ><Button onclick={review} disabled={needsReload}>{t('rowEditor.review')}</Button>
      </div>
    {:else if phase === 'confirm'}
      <div class="row-confirm">
        <h3>
          {operation === 'delete'
            ? t('rowEditor.confirmDelete')
            : operation === 'insert'
              ? t('rowEditor.confirmInsert')
              : t('rowEditor.confirmUpdate')}
        </h3>
        <p><strong>{tableLabel}</strong><br />{identity}</p>
        {#if operation !== 'delete'}<ul>
            {#each pendingChanges as change}<li>
                <strong>{change.column}</strong> · {change.value.kind}:
                <code
                  >{change.value.kind === 'null'
                    ? 'NULL'
                    : change.value.value === ''
                      ? '""'
                      : change.value.value}</code
                >
              </li>{/each}
          </ul>
          {#if operation === 'insert' && pendingChanges.length === 0}<p>
              {t('rowEditor.allDefault')}
            </p>{/if}{/if}
        <p>
          {t('rowEditor.mayConvert')}
        </p>
        <label class="row-confirm-check"
          ><input type="checkbox" bind:checked={confirmed} />{t('rowEditor.confirmCheck')}</label
        >
      </div>
      <div class="row-dialog-actions">
        <Button
          variant="outline"
          onclick={operation === 'delete'
            ? close
            : () => {
                phase = 'editing';
                confirmed = false;
              }}>{t('rowEditor.back')}</Button
        ><Button onclick={submit} disabled={!confirmed}
          >{#if operation === 'delete'}<Trash2 size={14} />{:else}<Pencil size={14} />{/if}{t(
            submitLabels[operation],
          )}</Button
        >
      </div>
    {:else if phase === 'done'}
      {#if after && eligibility}<p class="row-help">
          {t('rowEditor.savedRow')}
        </p>
        <ResultTable
          {transforms}
          result={snapshotResult(after, eligibility.update.description)}
        />{:else if operation !== 'delete'}<p>
          {t('rowEditor.noAfterRow')}
        </p>{/if}
      <Button onclick={close}>{t('rowEditor.closeReload')}</Button>
    {:else if ['conflict', 'unknown', 'blocked'].includes(phase)}
      <p class="row-help">
        {t('rowEditor.notRepeated')}
      </p>
      <Button
        onclick={() => {
          needsReload = true;
          close();
        }}>{t('rowEditor.discardReload')}</Button
      >
    {/if}
  </Dialog.Content>
</Dialog.Root>
