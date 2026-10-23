<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Plus, Pencil, Trash2, TriangleAlert } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';
  import * as Dialog from '$lib/components/ui/dialog';
  import ResultTable from './ResultTable.svelte';
  import { ApiError, toConnection } from '$lib/api';
  import { tableResult, type BrowseResult } from '$lib/tables';
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
  onMount(() => {
    void initialize();
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
<ResultTable
  result={display}
  onedit={editAllowed && !needsReload ? (index) => begin('update', index) : undefined}
  ondelete={editAllowed && !needsReload ? (index) => begin('delete', index) : undefined}
  actionsDisabled={busy}
/>
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
                >{/if}{/if}
          </div>{/each}
      </div>
      <div class="row-dialog-actions">
        <Button variant="outline" onclick={close}>Verwerfen</Button><Button onclick={review}
          >Änderung prüfen</Button
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
