<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { Plus, Pencil, Trash2, TriangleAlert } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';
  import * as Dialog from '$lib/components/ui/dialog';
  import ResultTable from './ResultTable.svelte';
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
    UNKNOWN_MESSAGE,
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
  }: {
    connection: ConnectionDraft;
    token: string;
    result: BrowseResult;
    onreload: () => void;
    onwritephase: (phase: WritePhase) => void;
  } = $props();
  let eligibility = $state<Eligibility | null>(null);
  let eligibilityMessage = $state('Bearbeitungsmöglichkeiten werden geprüft …');
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
            return `${name} = ${cell?.kind === 'null' ? 'NULL' : (cell?.value ?? 'Nicht gemeldet')}`;
          })
          .join(' · ')
      : 'Neue Zeile · Schlüsselvergabe gemäß Datenbank',
  );
  const titles = {
    insert: 'Zeile hinzufügen',
    update: 'Zeile bearbeiten',
    delete: 'Zeile löschen',
  };
  const submitLabels = {
    insert: 'Zeile verbindlich hinzufügen',
    update: 'Änderung verbindlich speichern',
    delete: 'Zeile endgültig löschen',
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
      throw new Error(
        'Diese Tabelle ist für die gewählte Zeilenänderung nicht geeignet. Lade die Daten neu.',
      );
    const description = value.update.description;
    if (
      expected &&
      (expected.columns.length !== description.columns.length ||
        expected.values.length !== expected.columns.length ||
        new Set(expected.columns).size !== expected.columns.length ||
        description.columns.some((column) => !expected.columns.includes(column.name)))
    )
      throw new Error(
        'Die Tabellenstruktur hat sich geändert. Lade die Daten neu und beginne einen neuen Vorgang.',
      );
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
        throw new Error('Eine ausgewählte Spalte ist nicht mehr bearbeitbar. Lade die Daten neu.');
      if (
        change.value.kind === 'null' &&
        (!column.nullable || description.primary_key.includes(column.name))
      )
        throw new Error(`Die Spalte „${column.name}“ erlaubt kein NULL.`);
    }
    if (
      action === 'insert' &&
      value.insert.required_pk.some(
        (name) => !changes.some((change) => change.column === name && change.value.kind !== 'null'),
      )
    )
      throw new Error('Gib alle erforderlichen Primärschlüsselwerte ausdrücklich an.');
  }
  async function initialize() {
    try {
      const checked = await loadEligibility(contextController.signal);
      if (destroyed) return;
      eligibility = checked;
      eligibilityMessage = baseAllowed(checked)
        ? 'Einzelzeilenänderungen werden vor dem Senden erneut geprüft.'
        : 'Für diese Tabelle sind keine Zeilenänderungen freigegeben (Tabellenart, Primärschlüssel oder Transaktionsgrundlage).';
    } catch (cause) {
      if (!destroyed)
        eligibilityMessage =
          cause instanceof Error ? cause.message : 'Der Zeileneditor ist nicht verfügbar.';
    }
  }
  async function begin(action: Operation, index?: number) {
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
        throw new Error('Diese Tabelle ist für die gewählte Zeilenänderung nicht freigegeben.');
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
    } catch (cause) {
      if (!destroyed && current === generation) {
        phase = 'blocked';
        message =
          cause instanceof Error ? cause.message : 'Der Vorgang konnte nicht vorbereitet werden.';
      }
    }
  }
  function review() {
    try {
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
      message = cause instanceof Error ? cause.message : 'Prüfe die Eingaben.';
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
          ? 'Der Server hat das Löschen bestätigt.'
          : operation === 'update' && 'changed' in response && !response.changed
            ? 'Der Server bestätigt die Zeile ohne Änderung.'
            : 'Der Server hat das Speichern bestätigt.';
      phase = 'done';
      fields = [];
      pendingChanges = [];
    } catch (cause) {
      if (destroyed || current !== generation) return;
      needsReload = true;
      if (cause instanceof ApiError && cause.code === 'outcome_unknown') {
        phase = 'unknown';
        message = UNKNOWN_MESSAGE;
        onwritephase('unknown');
      } else {
        phase =
          cause instanceof ApiError && ['row_conflict', 'insert_conflict'].includes(cause.code)
            ? 'conflict'
            : 'blocked';
        message =
          cause instanceof Error
            ? cause.message
            : 'Die Anfrage wurde nicht bestätigt. Lade die Daten neu.';
        onwritephase('settled');
      }
      sent = false;
      fields = [];
      pendingChanges = [];
    }
  }
  function close() {
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
  async function loadBulk() {
    try {
      const caps = await bulkClient.capabilities(token, contextController.signal);
      if (destroyed) return;
      support = supportFor(caps, apiDriver(connection.driver));
      if (support.lookup) {
        try {
          const found = await structureClient.read(
            toConnection(connection),
            table,
            token,
            contextController.signal,
          );
          if (!destroyed) foreignKeys = singleForeignKeys(found);
        } catch {
          if (!destroyed) foreignKeys = [];
        }
      }
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
      onclick={() => begin('insert')}><Plus size={14} />Zeile hinzufügen</Button
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
  open={dialogOpen}
  onOpenChange={(open) => {
    if (!open) close();
  }}
>
  <Dialog.Content class="sm:max-w-[900px] max-h-[90dvh] overflow-y-auto p-6">
    <Dialog.Header
      ><Dialog.Title>{titles[operation]}</Dialog.Title><Dialog.Description
        >{tableLabel} · {identity}</Dialog.Description
      ></Dialog.Header
    >
    {#if busy}<div class="row-status" role="status">
        {phase === 'loading' || phase === 'checking'
          ? 'Eignung wird aktuell geprüft …'
          : 'Anfrage gesendet. Eine unterbrochene Antwort kann bereits gespeicherte Änderungen verbergen.'}
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
        {operation === 'insert'
          ? 'DB-Default lässt die Spalte weg. NULL und ein leerer Textwert sind eigene Angaben.'
          : 'Unverändert verwendet den ursprünglichen Zellwert. Primärschlüssel und generierte Spalten bleiben gesperrt.'}
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
                  ? 'Schlüssel wird von der Datenbank vergeben'
                  : operation === 'insert'
                    ? 'Von der Datenbank berechnet'
                    : 'Gesperrt'}{#if operation !== 'insert'}
                  · {original?.values[original.columns.indexOf(field.column)]?.kind === 'null'
                    ? 'NULL'
                    : field.value}{/if}
              </p>{:else}<label
                >Angabe für {field.column}<select
                  aria-label={`Angabe für ${field.column}`}
                  bind:value={field.mode}
                  ><option value={operation === 'insert' ? 'default' : 'unchanged'}
                    >{operation === 'insert'
                      ? 'DB-Default (nicht übergeben)'
                      : 'Unverändert'}</option
                  >{#if eligibility?.update.description.columns.find((column) => column.name === field.column)?.nullable && !eligibility?.update.description.primary_key.includes(field.column)}<option
                      value="null">NULL</option
                    >{/if}<option value="value">Wert angeben</option></select
                ></label
              >{#if field.mode === 'value'}<label
                  >Werttyp für {field.column}<select
                    aria-label={`Werttyp für ${field.column}`}
                    bind:value={field.kind}
                    ><option value="text">Text</option><option value="integer">Ganze Zahl</option
                    ><option value="decimal">Dezimalzahl</option><option value="float"
                      >Fließkommazahl</option
                    ><option value="boolean">Wahrheitswert</option><option value="binary"
                      >Binär (Base64)</option
                    ><option value="timestamp">Zeitwert</option></select
                  ></label
                ><label
                  >Wert für {field.column}<Textarea
                    aria-label={`Wert für ${field.column}`}
                    bind:value={field.value}
                    rows={2}
                    maxlength={1048576}
                    autocomplete="off"
                    spellcheck={false}
                  /></label
                >{#if foreignKeys.some((fk) => fk.column === field.column)}<Button
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
        />
      {/if}
      <div class="row-dialog-actions">
        <Button variant="outline" onclick={close}>Verwerfen</Button><Button
          onclick={review}
          disabled={needsReload}>Änderung prüfen</Button
        >
      </div>
    {:else if phase === 'confirm'}
      <div class="row-confirm">
        <h3>
          {operation === 'delete'
            ? 'Genau diese Zeile löschen?'
            : operation === 'insert'
              ? 'Diese neue Zeile speichern?'
              : 'Genau diese Zeile ändern?'}
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
              Alle Spalten werden der Datenbank überlassen.
            </p>{/if}{/if}
        <p>
          Die Datenbank kann Werte konvertieren. Maßgeblich ist die anschließend vom Server
          gemeldete Zeile.
        </p>
        <label class="row-confirm-check"
          ><input type="checkbox" bind:checked={confirmed} />Ich bestätige diesen einzelnen
          Schreibvorgang.</label
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
              }}>Zurück</Button
        ><Button onclick={submit} disabled={!confirmed}
          >{#if operation === 'delete'}<Trash2 size={14} />{:else}<Pencil
              size={14}
            />{/if}{submitLabels[operation]}</Button
        >
      </div>
    {:else if phase === 'done'}
      {#if after && eligibility}<p class="row-help">
          Tatsächlich gespeicherte Zeile laut Server. Konvertierte Werte können von der Eingabe
          abweichen.
        </p>
        <ResultTable
          result={snapshotResult(after, eligibility.update.description)}
        />{:else if operation !== 'delete'}<p>
          Die Nachherzeile wurde nicht gemeldet. Bitte den Datenbankstand prüfen.
        </p>{/if}
      <Button onclick={close}>Schließen und Tabelle neu laden</Button>
    {:else if ['conflict', 'unknown', 'blocked'].includes(phase)}
      <p class="row-help">
        Der Vorgang wird nicht wiederholt. Verwirf den Entwurf, lade aktuelle Daten und beginne bei
        Bedarf eine neue bestätigte Änderung.
      </p>
      <Button
        onclick={() => {
          needsReload = true;
          close();
        }}>Entwurf verwerfen und Daten neu laden</Button
      >
    {/if}
  </Dialog.Content>
</Dialog.Root>
