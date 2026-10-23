<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { toConnection } from '$lib/api';
  import {
    structure,
    stateLabel,
    coverageLabel,
    actionLabel,
    kindLabel,
    roleLabel,
    directionLabel,
    objectLabel,
    type TableStructure,
    type StructureSchemas,
  } from '$lib/structure';
  import type { ConnectionDraft } from '$lib/workbench';
  let {
    connection,
    table,
    token,
  }: { connection: ConnectionDraft; table: StructureSchemas['TableRef']; token: string } = $props();
  let data = $state<TableStructure | null>(null);
  let busy = $state(false);
  let error = $state('');
  let controller = new AbortController();
  let generation = 0;
  let destroyed = false;
  const names = (values: string[], known: boolean) =>
    known ? (values.length ? values.join(' · ') : 'Keine Spalten') : 'Unbekannt';
  async function load() {
    controller.abort();
    controller = new AbortController();
    const current = ++generation;
    busy = true;
    error = '';
    data = null;
    try {
      const result = await structure.read(
        toConnection(connection),
        table,
        token,
        controller.signal,
      );
      if (!destroyed && generation === current) data = result;
    } catch (cause) {
      if (!destroyed && generation === current && !controller.signal.aborted)
        error =
          cause instanceof Error
            ? cause.message
            : 'Die erweiterten Strukturangaben konnten nicht geladen werden.';
    } finally {
      if (!destroyed && generation === current) busy = false;
    }
  }
  onMount(() => {
    void load();
  });
  onDestroy(() => {
    destroyed = true;
    generation++;
    controller.abort();
    data = null;
  });
</script>

<section class="extended-structure" aria-label="Index- und Constraintstruktur">
  <div class="structure-heading">
    <h3>Indexe und Constraints</h3>
    <Button variant="outline" size="sm" disabled={busy} onclick={load}
      >Erweiterte Struktur neu laden</Button
    >
  </div>
  <p>
    Katalogsicht ohne vollständige oder atomare Schemaaufnahme. Ausdrucks- und CHECK-SQL werden
    nicht geliefert. Unbekannte Angaben bleiben unbekannt.
  </p>
  {#if busy}<p role="status">Index- und Constraintangaben werden geladen …</p>{/if}
  {#if error}<p role="status">{error}</p>{/if}
  {#if data}
    <dl class="structure-coverage">
      <div>
        <dt>Indexabdeckung</dt>
        <dd>{coverageLabel(data.coverage.indexes)}</dd>
      </div>
      <div>
        <dt>Constraintabdeckung</dt>
        <dd>{coverageLabel(data.coverage.constraints)}</dd>
      </div>
      <div>
        <dt>CHECK-Abdeckung</dt>
        <dd>{coverageLabel(data.coverage.checks)}</dd>
      </div>
    </dl>
    <h4>Indexe · {data.indexes.length}</h4>
    {#if data.indexes.length === 0}<p>
        Keine Indexeinträge gemeldet. Beachte die Katalogabdeckung.
      </p>{/if}
    {#each data.indexes as index}<article class="structure-card" aria-label={`Index ${index.name}`}>
        <h5>{index.name || '""'}</h5>
        <dl class="structure-facts">
          <div>
            <dt>Eindeutig</dt>
            <dd>{stateLabel(index.unique)}</dd>
          </div>
          <div>
            <dt>Primärindex</dt>
            <dd>{stateLabel(index.primary)}</dd>
          </div>
          <div>
            <dt>Methode</dt>
            <dd>{index.method_known ? index.method || '""' : 'Unbekannt'}</dd>
          </div>
          <div>
            <dt>Teilindex</dt>
            <dd>{stateLabel(index.partial)}</dd>
          </div>
          <div>
            <dt>Gültig</dt>
            <dd>{stateLabel(index.valid)}</dd>
          </div>
          <div>
            <dt>NULL-Werte verschieden</dt>
            <dd>{stateLabel(index.nulls_distinct)}</dd>
          </div>
        </dl>
        <div class="metadata-scroll">
          <table class="metadata-table">
            <thead
              ><tr
                ><th>Position</th><th>Term</th><th>Rolle</th><th>Richtung</th><th>Kollation</th><th
                  >Präfix</th
                ></tr
              ></thead
            ><tbody>
              {#each index.terms as term}<tr
                  ><td>{term.position}</td><td
                    >{term.kind === 'column'
                      ? term.column || '""'
                      : term.kind === 'expression'
                        ? 'Ausdruck (Definition nicht geliefert)'
                        : term.kind === 'rowid'
                          ? 'Zeilenkennung (rowid)'
                          : 'Unbekannt'}</td
                  ><td>{roleLabel(term.role)}</td><td>{directionLabel(term.direction)}</td><td
                    >{term.collation_state === 'known' && term.collation
                      ? objectLabel(term.collation)
                      : term.collation_state === 'not_applicable'
                        ? 'Nicht anwendbar'
                        : 'Unbekannt'}</td
                  ><td
                    >{term.prefix_state === 'present'
                      ? `${term.prefix_length} · Einheit unbekannt`
                      : term.prefix_state === 'none'
                        ? 'Kein Präfix'
                        : 'Unbekannt'}</td
                  ></tr
                >{/each}
            </tbody>
          </table>
        </div>
      </article>{/each}
    <h4>Constraints · {data.constraints.length}</h4>
    {#if data.constraints.length === 0}<p>
        Keine Constraints gemeldet. Beachte die Katalogabdeckung.
      </p>{/if}
    {#each data.constraints as constraint}<article
        class="structure-card"
        aria-label={`${kindLabel(constraint.kind)} ${constraint.name_known ? constraint.name : 'Name unbekannt'}`}
      >
        <h5>
          {kindLabel(constraint.kind)} · {constraint.name_known
            ? constraint.name || '""'
            : 'Name unbekannt'}
        </h5>
        <dl class="structure-facts">
          <div>
            <dt>Spalten</dt>
            <dd>{names(constraint.columns, constraint.columns_known)}</dd>
          </div>
          <div>
            <dt>Aufschiebbar</dt>
            <dd>{stateLabel(constraint.deferrable)}</dd>
          </div>
          <div>
            <dt>Anfangs aufgeschoben</dt>
            <dd>{stateLabel(constraint.initially_deferred)}</dd>
          </div>
          <div>
            <dt>Durchgesetzt</dt>
            <dd>{stateLabel(constraint.enforced)}</dd>
          </div>
          <div>
            <dt>Validiert</dt>
            <dd>{stateLabel(constraint.validated)}</dd>
          </div>
        </dl>
        {#if constraint.kind === 'foreign_key'}<dl class="structure-facts">
            <div>
              <dt>Zieltabelle</dt>
              <dd>
                {constraint.referenced_table
                  ? objectLabel(constraint.referenced_table)
                  : 'Nicht gemeldet'}
              </dd>
            </div>
            <div>
              <dt>Zielspalten</dt>
              <dd>{names(constraint.referenced_columns, constraint.referenced_columns_known)}</dd>
            </div>
            <div>
              <dt>Bei Änderung</dt>
              <dd>{actionLabel(constraint.on_update)}</dd>
            </div>
            <div>
              <dt>Bei Löschung</dt>
              <dd>{actionLabel(constraint.on_delete)}</dd>
            </div>
          </dl>{/if}
      </article>{/each}
  {/if}
</section>
