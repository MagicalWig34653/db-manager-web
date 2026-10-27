<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { t } from '$lib/i18n';
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
    identifierLabel,
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
    known
      ? values.length
        ? values.map(identifierLabel).join(' · ')
        : t('structureView.noColumns')
      : t('structureView.unknown');
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
        error = cause instanceof Error ? cause.message : t('structureView.loadFailed');
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

<section class="extended-structure" aria-label={t('structureView.sectionLabel')}>
  <div class="structure-heading">
    <h3>{t('structureView.heading')}</h3>
    <Button variant="outline" size="sm" disabled={busy} onclick={load}
      >{t('structureView.reload')}</Button
    >
  </div>
  <p>
    {t('structureView.disclaimer')}
  </p>
  {#if busy}<p role="status">{t('structureView.loading')}</p>{/if}
  {#if error}<p role="status">{error}</p>{/if}
  {#if data}
    <dl class="structure-coverage">
      <div>
        <dt>{t('structureView.indexCoverage')}</dt>
        <dd>{coverageLabel(data.coverage.indexes)}</dd>
      </div>
      <div>
        <dt>{t('structureView.constraintCoverage')}</dt>
        <dd>{coverageLabel(data.coverage.constraints)}</dd>
      </div>
      <div>
        <dt>{t('structureView.checkCoverage')}</dt>
        <dd>{coverageLabel(data.coverage.checks)}</dd>
      </div>
    </dl>
    <h4>{t('structureView.indexesCount', { count: data.indexes.length })}</h4>
    {#if data.indexes.length === 0}<p>{t('structureView.noIndexes')}</p>{/if}
    {#each data.indexes as index}<article
        class="structure-card"
        aria-label={t('structureView.indexAria', { name: index.name })}
      >
        <h5>{index.name || '""'}</h5>
        <dl class="structure-facts">
          <div>
            <dt>{t('structureView.unique')}</dt>
            <dd>{stateLabel(index.unique)}</dd>
          </div>
          <div>
            <dt>{t('structureView.primaryIndex')}</dt>
            <dd>{stateLabel(index.primary)}</dd>
          </div>
          <div>
            <dt>{t('structureView.method')}</dt>
            <dd>{index.method_known ? index.method || '""' : t('structureView.unknown')}</dd>
          </div>
          <div>
            <dt>{t('structureView.partialIndex')}</dt>
            <dd>{stateLabel(index.partial)}</dd>
          </div>
          <div>
            <dt>{t('structureView.valid')}</dt>
            <dd>{stateLabel(index.valid)}</dd>
          </div>
          <div>
            <dt>{t('structureView.nullsDistinct')}</dt>
            <dd>{stateLabel(index.nulls_distinct)}</dd>
          </div>
        </dl>
        <div class="metadata-scroll">
          <table class="metadata-table">
            <thead
              ><tr
                ><th>{t('structureView.thPosition')}</th><th>{t('structureView.thTerm')}</th><th
                  >{t('structureView.thRole')}</th
                ><th>{t('structureView.thDirection')}</th><th>{t('structureView.thCollation')}</th
                ><th>{t('structureView.thPrefix')}</th></tr
              ></thead
            ><tbody>
              {#each index.terms as term}<tr
                  ><td>{term.position}</td><td
                    >{term.kind === 'column'
                      ? term.column || '""'
                      : term.kind === 'expression'
                        ? t('structureView.termExpression')
                        : term.kind === 'rowid'
                          ? t('structureView.termRowid')
                          : t('structureView.unknown')}</td
                  ><td>{roleLabel(term.role)}</td><td>{directionLabel(term.direction)}</td><td
                    >{term.collation_state === 'known' && term.collation
                      ? objectLabel(term.collation)
                      : term.collation_state === 'not_applicable'
                        ? t('structureView.notApplicable')
                        : t('structureView.unknown')}</td
                  ><td
                    >{term.prefix_state === 'present'
                      ? t('structureView.prefixUnit', { length: term.prefix_length ?? '' })
                      : term.prefix_state === 'none'
                        ? t('structureView.noPrefix')
                        : t('structureView.unknown')}</td
                  ></tr
                >{/each}
            </tbody>
          </table>
        </div>
      </article>{/each}
    <h4>{t('structureView.constraintsCount', { count: data.constraints.length })}</h4>
    {#if data.constraints.length === 0}<p>{t('structureView.noConstraints')}</p>{/if}
    {#each data.constraints as constraint}<article
        class="structure-card"
        aria-label={`${kindLabel(constraint.kind)} ${constraint.name_known ? constraint.name : t('structureView.nameUnknown')}`}
      >
        <h5>
          {kindLabel(constraint.kind)} · {constraint.name_known
            ? constraint.name || '""'
            : t('structureView.nameUnknown')}
        </h5>
        <dl class="structure-facts">
          <div>
            <dt>{t('structureView.columns')}</dt>
            <dd>{names(constraint.columns, constraint.columns_known)}</dd>
          </div>
          <div>
            <dt>{t('structureView.deferrable')}</dt>
            <dd>{stateLabel(constraint.deferrable)}</dd>
          </div>
          <div>
            <dt>{t('structureView.initiallyDeferred')}</dt>
            <dd>{stateLabel(constraint.initially_deferred)}</dd>
          </div>
          <div>
            <dt>{t('structureView.enforced')}</dt>
            <dd>{stateLabel(constraint.enforced)}</dd>
          </div>
          <div>
            <dt>{t('structureView.validated')}</dt>
            <dd>{stateLabel(constraint.validated)}</dd>
          </div>
        </dl>
        {#if constraint.kind === 'foreign_key'}<dl class="structure-facts">
            <div>
              <dt>{t('structureView.refTable')}</dt>
              <dd>
                {constraint.referenced_table
                  ? objectLabel(constraint.referenced_table)
                  : t('structureView.notReported')}
              </dd>
            </div>
            <div>
              <dt>{t('structureView.refColumns')}</dt>
              <dd>{names(constraint.referenced_columns, constraint.referenced_columns_known)}</dd>
            </div>
            <div>
              <dt>{t('structureView.onUpdate')}</dt>
              <dd>{actionLabel(constraint.on_update)}</dd>
            </div>
            <div>
              <dt>{t('structureView.onDelete')}</dt>
              <dd>{actionLabel(constraint.on_delete)}</dd>
            </div>
          </dl>{/if}
      </article>{/each}
  {/if}
</section>
