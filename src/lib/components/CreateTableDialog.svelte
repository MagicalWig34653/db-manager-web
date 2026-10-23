<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { ApiError, toConnection } from '$lib/api';
  import {
    createTable,
    newCreateDraft,
    newCreateColumn,
    prepareCreate,
    CREATE_UNKNOWN_MESSAGE,
    type CreateRequest,
    type CreateResult,
  } from '$lib/create-table';
  import type { ConnectionDraft } from '$lib/workbench';
  import type { WritePhase } from '$lib/rows';
  let {
    connection,
    token,
    onclose,
    oncreated,
    onwritephase,
  }: {
    connection: ConnectionDraft;
    token: string;
    onclose: () => void;
    oncreated: () => Promise<boolean>;
    onwritephase: (phase: WritePhase) => void;
  } = $props();
  let draft = $state(newCreateDraft());
  let phase = $state<
    | 'loading'
    | 'editing'
    | 'confirm'
    | 'checking'
    | 'sending'
    | 'created'
    | 'unknown'
    | 'conflict'
    | 'blocked'
  >('loading');
  let message = $state('');
  let refreshMessage = $state('');
  let confirmed = $state(false);
  let pending = $state.raw<CreateRequest | null>(null);
  let result = $state.raw<CreateResult | null>(null);
  let nextId = 2;
  let sent = false;
  let destroyed = false;
  const controller = new AbortController();
  const busy = $derived(['loading', 'checking', 'sending'].includes(phase));
  const checkLabels = {
    transactional: 'Struktur innerhalb derselben DDL-Transaktion geprüft.',
    observed: 'Struktur nach bestätigter Anlage separat beobachtet.',
    different:
      'Anlage bestätigt; separate Strukturbeobachtung stimmt nicht mit allen geprüften Attributen überein.',
    unavailable: 'Anlage bestätigt, Strukturprüfung nicht verfügbar.',
  };
  const typeLabels = {
    int64: 'Ganzzahl (Int64)',
    text: 'Text (VARCHAR)',
    binary: 'Binärdaten',
    decimal: 'Dezimalzahl',
  };
  const typeLabel = (type: CreateRequest['columns'][number]['type']) =>
    type.kind === 'text'
      ? `Text (VARCHAR(${type.length}))`
      : type.kind === 'decimal'
        ? `Dezimalzahl (${type.precision}, ${type.scale})`
        : typeLabels[type.kind];
  onMount(() => {
    void createTable
      .capabilities(token, controller.signal)
      .then(() => {
        if (!destroyed) phase = 'editing';
      })
      .catch((cause) => {
        if (!destroyed) {
          phase = 'blocked';
          message =
            cause instanceof Error
              ? cause.message
              : 'Die Tabellenanlage konnte nicht geprüft werden.';
        }
      });
  });
  onDestroy(() => {
    destroyed = true;
    if (sent && phase === 'sending') onwritephase('unknown');
    controller.abort();
    draft = newCreateDraft();
    pending = null;
    result = null;
    message = '';
    refreshMessage = '';
  });
  function addColumn() {
    if (phase === 'editing' && draft.columns.length < 32)
      draft.columns.push(newCreateColumn(nextId++));
  }
  function removeColumn(id: number) {
    draft.columns = draft.columns.filter((field) => field.id !== id);
    draft.primary = draft.primary.filter((key) => key !== id);
  }
  function toggleKey(id: number, checked: boolean) {
    draft.primary = checked ? [...draft.primary, id] : draft.primary.filter((key) => key !== id);
  }
  function moveKey(index: number, direction: number) {
    const target = index + direction;
    if (target < 0 || target >= draft.primary.length) return;
    const copy = [...draft.primary];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    draft.primary = copy;
  }
  function prepare() {
    message = '';
    try {
      pending = prepareCreate(draft, toConnection(connection));
      confirmed = false;
      phase = 'confirm';
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'Die Definition ist ungültig.';
    }
  }
  async function submit() {
    if (phase !== 'confirm' || !pending || !confirmed || busy) return;
    phase = 'checking';
    message = '';
    try {
      const created = await createTable.create(pending, token, controller.signal, () => {
        sent = true;
        if (!destroyed) {
          phase = 'sending';
          onwritephase('sending');
        }
      });
      if (destroyed) return;
      result = created;
      phase = 'created';
      pending = null;
      onwritephase('settled');
      refreshMessage = 'Katalog wird nach bestätigter Anlage gelesen …';
      try {
        const refreshed = await oncreated();
        if (!destroyed)
          refreshMessage = refreshed
            ? 'Katalog aktualisiert.'
            : 'Anlage bleibt bestätigt. Der Katalog konnte nicht aktualisiert werden; lade ihn später erneut.';
      } catch {
        if (!destroyed)
          refreshMessage =
            'Anlage bleibt bestätigt. Der Katalog konnte nicht aktualisiert werden; lade ihn später erneut.';
      }
    } catch (cause) {
      if (destroyed) return;
      if (cause instanceof ApiError && cause.code === 'outcome_unknown') {
        phase = 'unknown';
        message = CREATE_UNKNOWN_MESSAGE;
        pending = null;
        onwritephase('unknown');
      } else {
        phase =
          cause instanceof ApiError && cause.code === 'create_conflict' ? 'conflict' : 'editing';
        message =
          cause instanceof Error ? cause.message : 'Die Anfrage konnte nicht abgeschlossen werden.';
        onwritephase('settled');
      }
    }
  }
</script>

<Dialog.Root
  open={true}
  onOpenChange={(open) => {
    if (!open) onclose();
  }}
>
  <Dialog.Content class="create-table-dialog">
    <Dialog.Header
      ><Dialog.Title>Neue Tabelle anlegen</Dialog.Title><Dialog.Description
        >Nur eine neue Tabelle. Bestehende Tabellen werden weder geändert noch überschrieben.</Dialog.Description
      ></Dialog.Header
    >
    {#if phase === 'loading'}<p role="status">
        Fähigkeiten der Tabellenanlage werden geprüft …
      </p>{/if}
    {#if message}<p role="alert">{message}</p>{/if}
    {#if phase === 'editing'}
      <form
        onsubmit={(event) => {
          event.preventDefault();
          prepare();
        }}
      >
        <div class="create-fields">
          <label
            >Tabellenname<input
              aria-label="Neuer Tabellenname"
              bind:value={draft.name}
              autocomplete="off"
            /></label
          ><label
            >Schema (optional)<input
              aria-label="Neues Tabellenschema"
              bind:value={draft.schema}
              autocomplete="off"
              placeholder="Standard der Verbindung"
            /></label
          >
        </div>
        <p>
          Namen bleiben unverändert. BIGINT ist keine Auto-ID. Defaults sind ausschließlich
          konstante Werte.
        </p>
        {#if connection.driver === 'sqlite'}<p>
            SQLite verwendet Typaffinitäten: deklarierte Textlänge und Dezimalpräzision sind keine
            harte Speicher- oder Längengarantie.
          </p>{/if}
        {#each draft.columns as field, index (field.id)}
          <fieldset>
            <legend>Spalte {index + 1}</legend>
            <div class="create-fields">
              <label
                >Name<input
                  aria-label={`Spalte ${index + 1} Name`}
                  bind:value={field.name}
                  autocomplete="off"
                /></label
              >
              <label
                >Typ<select aria-label={`Spalte ${index + 1} Typ`} bind:value={field.kind}
                  ><option value="int64">Ganzzahl (Int64)</option><option value="text"
                    >Text (VARCHAR)</option
                  ><option value="binary">Binärdaten</option><option value="decimal"
                    >Dezimalzahl</option
                  ></select
                ></label
              >
              {#if field.kind === 'text'}<label
                  >Textlänge<input
                    aria-label={`Spalte ${index + 1} Textlänge`}
                    inputmode="numeric"
                    bind:value={field.length}
                  /></label
                >{/if}
              {#if field.kind === 'decimal'}<label
                  >Präzision<input
                    aria-label={`Spalte ${index + 1} Präzision`}
                    inputmode="numeric"
                    bind:value={field.precision}
                  /></label
                ><label
                  >Skala<input
                    aria-label={`Spalte ${index + 1} Skala`}
                    inputmode="numeric"
                    bind:value={field.scale}
                  /></label
                >{/if}
              <label class="create-check"
                ><input
                  type="checkbox"
                  aria-label={`Spalte ${index + 1} erlaubt NULL`}
                  bind:checked={field.nullable}
                />NULL erlaubt</label
              >
              <label
                >Default<select
                  aria-label={`Spalte ${index + 1} Defaultmodus`}
                  bind:value={field.defaultMode}
                  ><option value="none">Kein Default</option><option value="null"
                    >Explizit NULL</option
                  >{#if field.kind !== 'binary'}<option value="value">Konstanter Wert</option
                    >{/if}</select
                ></label
              >
              {#if field.defaultMode === 'value'}<label
                  >Exakter Wert<textarea
                    aria-label={`Spalte ${index + 1} Defaultwert`}
                    bind:value={field.value}></textarea></label
                >{/if}
              <label class="create-check"
                ><input
                  type="checkbox"
                  aria-label={`Spalte ${index + 1} Primärschlüssel`}
                  checked={draft.primary.includes(field.id)}
                  onchange={(event) => toggleKey(field.id, event.currentTarget.checked)}
                />Primärschlüssel</label
              >
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={draft.columns.length === 1}
              onclick={() => removeColumn(field.id)}>Spalte {index + 1} entfernen</Button
            >
          </fieldset>
        {/each}
        <Button
          type="button"
          variant="outline"
          disabled={draft.columns.length >= 32}
          onclick={addColumn}>Spalte hinzufügen</Button
        >
        <h3>Primärschlüsselreihenfolge</h3>
        {#if !draft.primary.length}<p>
            Kein Primärschlüssel. Eindeutige Zeilenbearbeitung ist damit nicht zugesichert.
          </p>{/if}
        <ol>
          {#each draft.primary as id, index (id)}<li>
              {JSON.stringify(draft.columns.find((field) => field.id === id)?.name ?? '')}
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label={`Schlüssel ${index + 1} nach oben`}
                disabled={index === 0}
                onclick={() => moveKey(index, -1)}>Nach oben</Button
              >
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label={`Schlüssel ${index + 1} nach unten`}
                disabled={index === draft.primary.length - 1}
                onclick={() => moveKey(index, 1)}>Nach unten</Button
              >
            </li>{/each}
        </ol>
        <Button type="submit">Definition prüfen</Button>
      </form>
    {/if}
    {#if pending && (phase === 'confirm' || busy)}
      <p>
        <strong>Neue Tabelle:</strong>
        {pending.table.schema
          ? JSON.stringify(pending.table.schema) + ' · '
          : 'Standardschema · '}{JSON.stringify(pending.table.name)}
      </p>
      <ol>
        {#each pending.columns as column}<li>
            {JSON.stringify(column.name)} · {typeLabel(column.type)} · {column.nullable
              ? 'NULL erlaubt'
              : 'Nicht-NULL'} · {column.default.mode === 'none'
              ? 'Kein Default'
              : column.default.mode === 'null'
                ? 'Default NULL'
                : `Default ${JSON.stringify(column.default.value.value)}`}
          </li>{/each}
      </ol>
      <p>
        Primärschlüssel: {pending.primary_key.length
          ? pending.primary_key.map((name) => JSON.stringify(name)).join(' · ')
          : 'Keiner'}
      </p>
      <p>
        Nach dem Senden kann eine Anlage auch bei Verbindungsabbruch erfolgt sein. Es gibt keine
        automatische Wiederholung oder Entfernung.
      </p>
      <label class="create-check"
        ><input
          type="checkbox"
          aria-label="Tabellenanlage ausdrücklich bestätigen"
          disabled={busy}
          bind:checked={confirmed}
        />Ich möchte genau diese neue Tabelle anlegen.</label
      >
      <Dialog.Footer
        ><Button
          type="button"
          variant="outline"
          disabled={busy}
          onclick={() => {
            phase = 'editing';
            pending = null;
          }}>Definition bearbeiten</Button
        ><Button type="button" disabled={!confirmed || busy} onclick={submit}
          >{busy ? 'Anlage läuft …' : 'Tabelle verbindlich anlegen'}</Button
        ></Dialog.Footer
      >
    {/if}
    {#if phase === 'created' && result}
      <h3>Anlage bestätigt</h3>
      <p>{result.message}</p>
      <p>{checkLabels[result.structure_check]}</p>
      <p>
        Keine Garantie über den Zustand nach Commit oder Antwort; keine allgemeine
        DDL-Rollbackzusage.
      </p>
      {#if result.actual_description}<h4>Tatsächlich gelesene Spalten</h4>
        <ul>
          {#each result.actual_description.columns as column}<li>
              {JSON.stringify(column.name)} · {column.database_type} · {column.nullable
                ? 'NULL erlaubt'
                : 'Nicht-NULL'}{column.default_value !== undefined
                ? ` · Default ${JSON.stringify(column.default_value)}`
                : ''}
            </li>{/each}
        </ul>{/if}
      <p role="status">{refreshMessage}</p>
    {/if}
    {#if phase === 'conflict'}<p>
        Die vorhandene Tabelle bleibt unverändert. Prüfe den Katalog und beginne bei Bedarf mit
        einer neuen Definition.
      </p>{/if}
    <Button type="button" variant="outline" onclick={onclose}>Schließen</Button>
  </Dialog.Content>
</Dialog.Root>

<style>
  :global(.create-table-dialog) {
    max-width: 56rem;
    max-height: 90dvh;
    overflow: auto;
  }
  .create-fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(175px, 1fr));
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.85rem;
  }
  input:not([type='checkbox']),
  select,
  textarea {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    background: var(--background);
    color: var(--foreground);
  }
  .create-check {
    flex-direction: row;
    align-items: center;
  }
  fieldset {
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    padding: 0.75rem;
    margin: 1rem 0;
  }
  legend {
    padding: 0 0.4rem;
    font-weight: 600;
  }
  h3,
  h4 {
    font-weight: 600;
    margin-top: 0.8rem;
  }
  ol,
  ul {
    padding-left: 1.2rem;
  }
  li {
    margin: 0.45rem 0;
  }
  p {
    margin: 0.6rem 0;
  }
</style>
