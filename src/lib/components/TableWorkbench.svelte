<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    ArrowLeft,
    ArrowRight,
    Plus,
    RefreshCw,
    Square,
    Table2,
    TriangleAlert,
    X,
  } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import ResultTable from './ResultTable.svelte';
  import { toConnection, ApiError } from '$lib/api';
  import {
    tables,
    tableResult,
    prepareFilters,
    emptyFilter,
    type TableDescription,
    type BrowseResult,
    type FilterDraft,
    type TableSort,
    type TableFilter,
  } from '$lib/tables';
  import type { ConnectionDraft, CatalogObject } from '$lib/workbench';
  let {
    connection,
    token,
    object,
    onsql,
  }: { connection: ConnectionDraft; token: string; object: CatalogObject; onsql: () => void } =
    $props();
  let description = $state<TableDescription | null>(null);
  let result = $state<BrowseResult | null>(null);
  let busy = $state(false);
  let error = $state('');
  let cancelled = $state(false);
  let unsupported = $state(false);
  let tab = $state<'data' | 'structure'>('data');
  let pageSize = $state(100);
  let filters = $state<FilterDraft[]>([]);
  let sort = $state<TableSort[]>([]);
  let appliedSnapshot = $state(JSON.stringify({ filters: [], sort: [], pageSize: 100 }));
  let appliedFilters: TableFilter[] = [];
  let appliedSort: TableSort[] = [];
  let appliedPageSize = 100;
  let version = 0;
  let destroyed = false;
  let controller = new AbortController();
  const dirty = $derived(JSON.stringify({ filters, sort, pageSize }) !== appliedSnapshot);
  const display = $derived(result ? tableResult(result) : null);
  const table = $derived({
    name: object.name,
    ...(object.schema ? { schema: object.schema } : {}),
  });
  const generatedNames = {
    none: 'Nein',
    virtual: 'Virtuell',
    stored: 'Gespeichert',
    identity: 'Identität',
    hidden: 'Versteckt',
  };
  const kindNames = {
    table: 'Tabelle',
    view: 'View',
    virtual: 'Virtuelle Tabelle',
    foreign: 'Fremdtabelle',
  };
  async function initialize() {
    const current = ++version;
    busy = true;
    try {
      await tables.capabilities(token, controller.signal);
      const metadata = await tables.describe(
        { connection: toConnection(connection), table },
        token,
        controller.signal,
      );
      if (destroyed || current !== version) return;
      description = metadata;
      await loadPage(0);
    } catch (cause) {
      if (!destroyed && current === version) {
        if (controller.signal.aborted) cancelled = true;
        else {
          unsupported = cause instanceof ApiError && cause.code === 'unsupported_feature';
          error =
            cause instanceof Error ? cause.message : 'Die Tabelle konnte nicht geöffnet werden.';
        }
      }
    } finally {
      if (!destroyed && current === version) busy = false;
    }
  }
  async function loadPage(offset: number) {
    controller.abort();
    controller = new AbortController();
    const request = controller;
    const current = ++version;
    busy = true;
    error = '';
    cancelled = false;
    result = null;
    try {
      const loaded = await tables.browse(
        {
          connection: toConnection(connection),
          table,
          page_size: appliedPageSize,
          offset,
          sort: appliedSort,
          filters: appliedFilters,
          timeout_ms: 10000,
        },
        token,
        request.signal,
      );
      if (destroyed || current !== version) return;
      description = loaded.description;
      result = loaded;
    } catch (cause) {
      if (!destroyed && current === version) {
        if (request.signal.aborted) cancelled = true;
        else {
          unsupported = cause instanceof ApiError && cause.code === 'unsupported_feature';
          error =
            cause instanceof Error
              ? cause.message
              : 'Die Tabellenzeilen konnten nicht geladen werden.';
        }
      }
    } finally {
      if (!destroyed && current === version) busy = false;
    }
  }
  function apply() {
    if (!description || busy) return;
    try {
      appliedFilters = prepareFilters(
        filters,
        description.columns.map((column) => column.name),
      );
      if (
        sort.some((order) => !description!.columns.some((column) => column.name === order.column))
      )
        throw new Error('Wähle vorhandene Sortierspalten.');
      if (new Set(sort.map((order) => order.column)).size !== sort.length)
        throw new Error('Jede Sortierspalte darf nur einmal vorkommen.');
      appliedSort = sort.map((order) => ({ ...order }));
      appliedPageSize = pageSize;
      appliedSnapshot = JSON.stringify({ filters, sort, pageSize });
      void loadPage(0);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Prüfe die Filterwerte.';
    }
  }
  onMount(() => {
    void initialize();
  });
  onDestroy(() => {
    destroyed = true;
    version++;
    controller.abort();
  });
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === 'Escape' && busy) controller.abort();
  }}
/>
<section
  id="table-workspace"
  tabindex="-1"
  class="table-workspace"
  aria-label="Tabellenarbeitsplatz"
  aria-busy={busy}
>
  <div class="table-heading">
    <div>
      <p class="eyebrow">{description ? kindNames[description.kind] : 'OBJEKT'}</p>
      <h2><Table2 size={20} />{object.schema ? `${object.schema}.` : ''}{object.name}</h2>
      <p>Diese Tabellenansicht ist schreibgeschützt.</p>
    </div>
    <Button
      variant="outline"
      disabled={busy || !description || dirty}
      onclick={() => loadPage(result?.offset ?? 0)}><RefreshCw size={15} />Aktualisieren</Button
    >
  </div>
  {#if description}
    <div class="table-facts">
      <span
        >Primärschlüssel: {description.primary_key.length
          ? description.primary_key.join(', ')
          : 'Nicht vorhanden'}</span
      ><span
        >Transaktionen: {description.transactional === 'yes'
          ? 'Unterstützt'
          : description.transactional === 'no'
            ? 'Nicht unterstützt'
            : 'Nicht gemeldet'}</span
      ><span>Speicher: {description.storage_engine || 'Nicht gemeldet'}</span>
    </div>
    <div class="table-tabs" role="tablist" aria-label="Tabellenbereich">
      <button role="tab" aria-selected={tab === 'data'} onclick={() => (tab = 'data')}>Daten</button
      ><button role="tab" aria-selected={tab === 'structure'} onclick={() => (tab = 'structure')}
        >Struktur · {description.columns.length} Spalten</button
      >
    </div>
    {#if tab === 'structure'}
      <div
        class="metadata-scroll"
        role="region"
        aria-label="Tabellenstruktur, horizontal scrollbar"
      >
        <table class="metadata-table">
          <thead
            ><tr
              ><th>Spalte</th><th>Datentyp</th><th>NULL erlaubt</th><th>Standardausdruck</th><th
                >PK-Position</th
              ><th>Generiert</th><th>Zugriff</th></tr
            ></thead
          ><tbody
            >{#each description.columns as column}<tr
                ><th scope="row">{column.name}</th><td
                  >{column.database_type || 'Nicht gemeldet'}</td
                ><td>{column.nullable ? 'Ja' : 'Nein'}</td><td
                  ><code
                    >{column.default_value === undefined
                      ? 'Nicht gemeldet'
                      : column.default_value === ''
                        ? '""'
                        : column.default_value}</code
                  ></td
                ><td>{column.pk_position || '–'}</td><td>{generatedNames[column.generated]}</td><td
                  >{column.read_only ? 'Nur lesen' : 'Nicht gemeldet'}</td
                ></tr
              >{/each}</tbody
          >
        </table>
      </div>
    {:else}
      <form
        class="table-controls"
        onsubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <details>
          <summary
            >Sortierung und Filter {filters.length || sort.length
              ? `(${sort.length} / ${filters.length})`
              : ''}</summary
          >
          <fieldset disabled={busy}>
            <legend>Sortierung</legend>
            {#each sort as order, index}<div class="sort-row">
                <label
                  >Sortierspalte {index + 1}<select bind:value={order.column}
                    >{#each description.columns as column}<option value={column.name}
                        >{column.name}</option
                      >{/each}</select
                  ></label
                ><label
                  >Richtung {index + 1}<select bind:value={order.direction}
                    ><option value="asc">Aufsteigend</option><option value="desc">Absteigend</option
                    ></select
                  ></label
                ><Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Sortierung ${index + 1} entfernen`}
                  onclick={() => (sort = sort.filter((_, i) => i !== index))}
                  ><X size={15} /></Button
                >
              </div>{/each}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={sort.length >= 16 || !description.columns.length}
              onclick={() =>
                (sort = [
                  ...sort,
                  {
                    column:
                      description!.columns.find(
                        (column) => !sort.some((order) => order.column === column.name),
                      )?.name ?? description!.columns[0].name,
                    direction: 'asc',
                  },
                ])}><Plus size={14} />Sortierung hinzufügen</Button
            >
          </fieldset>
          <fieldset disabled={busy}>
            <legend>Filter · alle Bedingungen gelten gemeinsam (UND)</legend>
            {#each filters as filter, index}<div class="filter-row">
                <label
                  >Filterspalte {index + 1}<select bind:value={filter.column}
                    >{#each description.columns as column}<option value={column.name}
                        >{column.name}</option
                      >{/each}</select
                  ></label
                ><label
                  >Bedingung {index + 1}<select bind:value={filter.operator}
                    ><option value="eq">Ist gleich</option><option value="is_null">Ist NULL</option
                    ><option value="is_not_null">Ist nicht NULL</option></select
                  ></label
                >{#if filter.operator === 'eq'}<label
                    >Werttyp {index + 1}<select bind:value={filter.kind}
                      ><option value="text">Text</option><option value="integer">Ganze Zahl</option
                      ><option value="decimal">Dezimalzahl</option><option value="float"
                        >Fließkommazahl</option
                      ><option value="boolean">Wahrheitswert</option><option value="binary"
                        >Binär (Base64)</option
                      ><option value="timestamp">Zeitwert</option></select
                    ></label
                  ><label
                    >Filterwert {index + 1}<Input
                      bind:value={filter.value}
                      placeholder={filter.kind === 'boolean'
                        ? 'true oder false'
                        : filter.kind === 'text'
                          ? 'Auch Leertext erlaubt'
                          : 'Wert eingeben'}
                    /></label
                  >{/if}<Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Filter ${index + 1} entfernen`}
                  onclick={() => (filters = filters.filter((_, i) => i !== index))}
                  ><X size={15} /></Button
                >
              </div>{/each}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={filters.length >= 16 || !description.columns.length}
              onclick={() => (filters = [...filters, emptyFilter(description!.columns[0].name)])}
              ><Plus size={14} />Filter hinzufügen</Button
            >
          </fieldset>
          <p class="control-hint">
            NULL über „Ist NULL“ filtern. Dezimalwerte mit Punkt; Binärwerte als Base64. Werte
            werden ohne numerische Rundung übertragen.
          </p>
        </details>
        <div class="table-actions">
          <label
            >Zeilen pro Seite<select bind:value={pageSize} disabled={busy}
              ><option value={25}>25</option><option value={100}>100</option><option value={500}
                >500</option
              ><option value={1000}>1.000</option></select
            ></label
          ><Button type="submit" disabled={busy}>Anwenden</Button>{#if dirty}<span
              class="control-hint">Änderungen noch nicht angewendet.</span
            >{/if}
        </div>
      </form>
      {#if result && display}<ResultTable result={display} />
        <div class="pagination" aria-label="Seitennavigation">
          <span
            >{result.result.rows.length
              ? `Zeilen ${result.offset + 1}–${result.offset + result.result.rows.length}`
              : 'Keine passenden Zeilen'} · Gesamtzahl nicht ermittelt</span
          >
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || dirty || result.offset === 0}
              onclick={() => loadPage(Math.max(0, result!.offset - result!.page_size))}
              ><ArrowLeft size={14} />Zurück</Button
            ><Button
              variant="outline"
              size="sm"
              disabled={busy ||
                dirty ||
                !result.has_more ||
                result.offset + result.page_size > 1000000}
              onclick={() => loadPage(result!.offset + result!.page_size)}
              >Weiter<ArrowRight size={14} /></Button
            >
          </div>
        </div>
        {#if !result.stable_order}<p class="table-warning">
            <TriangleAlert size={15} />Keine stabile Reihenfolge zugesagt. Seiten können sich bei
            Änderungen verschieben oder überschneiden.
          </p>{:else}<p class="control-hint">
            Reihenfolge mit eindeutigem Schlüssel; parallele Datenänderungen können Seiten weiterhin
            verschieben.
          </p>{/if}
        {#if result.has_more}<p class="control-hint">
            Weitere Zeilen vorhanden.{result.offset + result.page_size > 1000000
              ? ' Die maximale Seitengrenze ist erreicht. Bitte weiter filtern.'
              : ''}
          </p>{/if}
        {#if result.result.truncated && !result.has_more}<p class="table-warning">
            Ergebnis begrenzt; nicht als vollständig behandeln.
          </p>{/if}
      {/if}
    {/if}
  {/if}
  {#if busy}<div class="table-feedback" role="status">
      <p>Tabelleninformationen werden geladen …</p>
      <Button variant="outline" onclick={() => controller.abort()}
        ><Square size={14} />Laden abbrechen</Button
      >
    </div>{/if}
  {#if error}<div class="table-feedback table-error" role="alert">
      {error}{#if unsupported}<Button variant="outline" onclick={onsql}>Zu SQL wechseln</Button
        >{/if}
    </div>{/if}
  {#if cancelled}<div class="table-feedback" role="status">
      Laden abgebrochen. Keine Tabellenzeilen verändert.
    </div>{/if}
</section>
