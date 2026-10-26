<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { toConnection } from '$lib/api';
  import type { FeatureProps } from '$lib/features';
  import { t } from '$lib/i18n';
  import { getShellContext } from '$lib/shell/context';
  import { tables, type TableDescription } from '$lib/tables';
  import {
    structure,
    stateLabel,
    coverageLabel,
    actionLabel,
    objectLabel,
    identifierLabel,
    roleLabel,
    directionLabel,
    type TableStructure,
  } from '$lib/structure';
  import PlanPreview from '$lib/components/shared/PlanPreview.svelte';
  import ConfirmDestructiveDialog from '$lib/components/shared/ConfirmDestructiveDialog.svelte';
  import { Button } from '$lib/components/ui/button';
  import { indexesClient, indexesErrorMessage } from './client';
  import { Operation } from './operation.svelte';
  import {
    actions,
    emptyDraft,
    emptyTerm,
    buildChange,
    draftIssues,
    isForeign,
    isIndex,
    needsTarget,
    type Action,
    type Driver,
    type IndexesCapabilities,
  } from './model';
  let { connection, token, object, onwritephase }: FeatureProps = $props();
  const shell = getShellContext();
  const uid = $props.id();
  let caps = $state<IndexesCapabilities | null>(null);
  let description = $state<TableDescription | null>(null);
  let metadata = $state<TableStructure | null>(null);
  let loading = $state(true);
  let error = $state('');
  let draft = $state(emptyDraft());
  let confirmed = $state(false);
  let dialog = $state(false);
  let controller: AbortController | null = null;
  let generation = 0;
  const driver = $derived<Driver>(
    connection?.driver === 'postgresql'
      ? 'postgres'
      : connection?.driver === 'mysql'
        ? 'mysql'
        : 'sqlite',
  );
  const ref = $derived(
    object ? { name: object.name, ...(object.schema ? { schema: object.schema } : {}) } : null,
  );
  const objectKey = $derived(JSON.stringify(ref));
  const writeBusy = $derived(!!shell?.session.writeInFlight);
  const columns = $derived(description?.columns.map((c) => c.name) ?? []);
  const support = $derived(caps?.drivers[driver]);
  const engineBlocked = $derived(
    driver === 'mysql' &&
      !!description?.storage_engine &&
      description.storage_engine.toLowerCase() !== 'innodb',
  );
  const baseTable = $derived(
    description?.kind === 'table' && object?.type !== 'view' && !engineBlocked,
  );
  const issues = $derived(caps ? draftIssues(draft, columns, driver, caps) : []);
  const availableTargets = $derived(
    draft.action.startsWith('foreign_key')
      ? (metadata?.constraints
          .filter((c) => c.kind === 'foreign_key' && c.name_known)
          .map((c) => c.name) ?? [])
      : (metadata?.indexes.filter((i) => i.primary === 'no').map((i) => i.name) ?? []),
  );
  const operation = new Operation({
    context: () => ({
      connection: connection ? toConnection(connection) : null,
      token,
      table: ref,
    }),
    writeReceiver: () => onwritephase,
    onfinished: () => {
      void reload();
    },
  });
  const locked = $derived(operation.phase !== 'idle');
  async function reload() {
    const current = ++generation;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    caps = null;
    metadata = null;
    description = null;
    loading = true;
    error = '';
    if (!connection || !ref) {
      loading = false;
      return;
    }
    try {
      const [c, d, m] = await Promise.allSettled([
        indexesClient.capabilities(token, signal),
        tables.describe({ connection: toConnection(connection), table: ref }, token, signal),
        structure.read(toConnection(connection), ref, token, signal),
      ]);
      if (signal.aborted || current !== generation) return;
      if (c.status === 'fulfilled') caps = c.value;
      if (d.status === 'fulfilled') description = d.value;
      if (m.status === 'fulfilled') metadata = m.value;
      const failure = [c, d, m].find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') error = indexesErrorMessage(failure.reason);
    } catch (cause) {
      if (!signal.aborted && current === generation) error = indexesErrorMessage(cause);
    } finally {
      if (current === generation) loading = false;
    }
  }
  $effect(() => {
    token;
    connection;
    objectKey;
    untrack(() => {
      operation.reset();
      draft = emptyDraft();
      confirmed = false;
      dialog = false;
      void reload();
    });
    return () => {
      generation++;
      controller?.abort();
      operation.reset();
    };
  });
  function choose(action: Action) {
    if (locked || writeBusy) return;
    draft = emptyDraft(action);
    confirmed = false;
  }
  function move(index: number, offset: number) {
    const next = [...draft.terms];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    draft.terms = next;
  }
  function showPlan() {
    if (
      !caps ||
      issues.length ||
      locked ||
      writeBusy ||
      !baseTable ||
      (needsTarget(draft.action) && !availableTargets.includes(draft.name))
    )
      return;
    confirmed = false;
    void operation.loadPlan(buildChange(draft));
  }
  function execute(name?: string) {
    if (writeBusy) return;
    dialog = false;
    void operation.execute(name);
  }
  function reset() {
    operation.reset();
    confirmed = false;
    dialog = false;
    draft = emptyDraft();
    void reload();
  }
  const label = (key: string) => t(`indexes.${key}`);
</script>

<section class="indexes-panel" aria-label={t('indexes.tab')}>
  <h2>{t('indexes.tab')}</h2>
  {#if loading}<p role="status">{t('indexes.loading')}</p>{/if}
  {#if error}<p role="alert">{error}</p>
    <Button disabled={writeBusy || operation.phase === 'executing'} onclick={() => void reload()}
      >{t('indexes.reload')}</Button
    >{/if}
  {#if driver === 'sqlite'}<p data-testid="sqlite-indexes-note">{t('indexes.sqlite')}</p>{/if}
  {#if engineBlocked}<p role="alert">{t('indexes.engine')}</p>{/if}
  {#if metadata}
    <p>
      {t('indexes.coverage')}: {coverageLabel(metadata.coverage.indexes)} · {coverageLabel(
        metadata.coverage.constraints,
      )}
    </p>
    <div class="scroll">
      <table data-testid="index-list">
        <caption>{t('indexes.indexList')}</caption><thead
          ><tr
            ><th>{t('indexes.name')}</th><th>{t('indexes.kind')}</th><th>{t('indexes.unique')}</th
            ><th>{t('indexes.terms')}</th></tr
          ></thead
        ><tbody>
          {#each metadata.indexes as index}
            <tr
              ><td><code>{identifierLabel(index.name)}</code></td><td
                >{index.primary === 'yes'
                  ? 'PRIMARY'
                  : index.method_known
                    ? index.method
                    : t('indexes.unknown')}</td
              ><td>{stateLabel(index.unique)}</td><td
                ><ol>
                  {#each index.terms as term}<li>
                      {term.kind === 'column' && term.column !== undefined
                        ? identifierLabel(term.column)
                        : t('indexes.unknown')} · {roleLabel(term.role)} · {directionLabel(
                        term.direction,
                      )} · {t('indexes.prefix')}: {term.prefix_state === 'none'
                        ? t('indexes.none')
                        : (term.prefix_length ?? t('indexes.unknown'))} · {t('indexes.expression')}: {term.kind ===
                      'expression'
                        ? t('indexes.yes')
                        : t('indexes.no')}
                    </li>{/each}
                </ol>
                {t('indexes.partial')}: {stateLabel(index.partial)}</td
              ></tr
            >
          {:else}<tr><td colspan="4">{t('indexes.empty')}</td></tr>{/each}
        </tbody>
      </table>
    </div>
    <div class="scroll">
      <table data-testid="foreign-key-list">
        <caption>{t('indexes.foreignList')}</caption><thead
          ><tr
            ><th>{t('indexes.name')}</th><th>{t('indexes.terms')}</th><th
              >{t('indexes.reference')}</th
            ><th>ON DELETE / ON UPDATE</th></tr
          ></thead
        ><tbody>
          {#each metadata.constraints.filter((c) => c.kind === 'foreign_key') as fk}<tr
              ><td>{fk.name_known ? identifierLabel(fk.name) : t('indexes.unknown')}</td><td
                >{fk.columns_known
                  ? fk.columns.map(identifierLabel).join(', ')
                  : t('indexes.unknown')}</td
              ><td
                >{fk.referenced_table ? objectLabel(fk.referenced_table) : t('indexes.unknown')} ({fk.referenced_columns_known
                  ? fk.referenced_columns.map(identifierLabel).join(', ')
                  : t('indexes.unknown')})</td
              ><td>{actionLabel(fk.on_delete)} / {actionLabel(fk.on_update)}</td></tr
            >{:else}<tr><td colspan="4">{t('indexes.empty')}</td></tr>{/each}
        </tbody>
      </table>
    </div>
  {/if}
  {#if support}
    <ul data-testid="indexes-support">
      {#each Object.entries(support) as [key, value]}<li>
          {label(key)}: {label(value.support)} — {value.reason}
        </li>{/each}
    </ul>
    {#if !baseTable}<p>{t('indexes.baseOnly')}</p>{/if}
    <form
      onsubmit={(event) => {
        event.preventDefault();
        showPlan();
      }}
    >
      <fieldset disabled={locked || writeBusy || !baseTable}>
        <legend>{t('indexes.definition')}</legend>
        <label for="{uid}-action">{t('indexes.action')}</label><select
          id="{uid}-action"
          value={draft.action}
          onchange={(event) => choose(event.currentTarget.value as Action)}
          >{#each actions as action}<option
              value={action}
              disabled={support[action].support === 'unsupported'}>{label(action)}</option
            >{/each}</select
        >
        <p>{support[draft.action].reason}</p>
        {#if needsTarget(draft.action)}<label for="{uid}-target">{t('indexes.target')}</label
          ><select id="{uid}-target" bind:value={draft.name}
            ><option value="">{t('indexes.select')}</option>{#each availableTargets as name}<option
                value={name}>{identifierLabel(name)}</option
              >{/each}</select
          >{/if}
        {#if isIndex(draft.action) || isForeign(draft.action) || draft.action === 'index_rename'}<label
            for="{uid}-name">{t('indexes.newName')}</label
          ><input id="{uid}-name" bind:value={draft.newName} autocomplete="off" />{/if}
        {#if isIndex(draft.action) && draft.action !== 'primary_set'}<label for="{uid}-kind"
            >{t('indexes.kind')}</label
          ><select id="{uid}-kind" bind:value={draft.kind}
            >{#each ['index', 'unique', 'fulltext', 'spatial'] as kind}<option
                value={kind}
                disabled={(kind === 'fulltext' || kind === 'spatial') &&
                  support[kind].support === 'unsupported'}>{kind.toUpperCase()}</option
              >{/each}</select
          >{/if}
        {#if isIndex(draft.action) || isForeign(draft.action)}
          {#each draft.terms as term, i}<div class="term">
              <label for="{uid}-column-{i}">{t('indexes.column', { position: i + 1 })}</label
              ><select id="{uid}-column-{i}" bind:value={term.column}
                ><option value="">{t('indexes.select')}</option>{#each columns as column}<option
                    value={column}>{identifierLabel(column)}</option
                  >{/each}</select
              >
              {#if isForeign(draft.action)}<label for="{uid}-reference-{i}"
                  >{t('indexes.referenceColumn')}</label
                ><input id="{uid}-reference-{i}" bind:value={term.referenced} autocomplete="off" />
              {:else if draft.action !== 'primary_set' && !['fulltext', 'spatial'].includes(draft.kind)}
                <label for="{uid}-direction-{i}">{t('indexes.direction')}</label><select
                  id="{uid}-direction-{i}"
                  bind:value={term.direction}
                  disabled={support.direction.support === 'unsupported'}
                  ><option value="">{t('indexes.default')}</option><option value="asc">ASC</option
                  ><option value="desc">DESC</option></select
                >
                {#if support.prefix.support !== 'unsupported'}<label for="{uid}-prefix-{i}"
                    >{t('indexes.prefix')}</label
                  ><input id="{uid}-prefix-{i}" inputmode="numeric" bind:value={term.prefix} />{/if}
                {#if support.expression.support !== 'unsupported'}<label for="{uid}-expression-{i}"
                    >{t('indexes.expression')}</label
                  ><select id="{uid}-expression-{i}" bind:value={term.expression}
                    ><option value="">{t('indexes.none')}</option><option value="lower"
                      >lower</option
                    ><option value="upper">upper</option></select
                  >{/if}
              {/if}
              <div class="actions">
                <Button type="button" disabled={i === 0} onclick={() => move(i, -1)}
                  >{t('indexes.up')}</Button
                ><Button
                  type="button"
                  disabled={i === draft.terms.length - 1}
                  onclick={() => move(i, 1)}>{t('indexes.down')}</Button
                ><Button
                  type="button"
                  disabled={draft.terms.length === 1}
                  onclick={() => (draft.terms = draft.terms.filter((_, n) => n !== i))}
                  >{t('indexes.remove')}</Button
                >
              </div>
            </div>{/each}
          <Button
            type="button"
            disabled={draft.terms.length >= 16}
            onclick={() => (draft.terms = [...draft.terms, emptyTerm()])}
            >{t('indexes.addTerm')}</Button
          >
        {/if}
        {#if isIndex(draft.action) && draft.action !== 'primary_set' && support.partial.support !== 'unsupported'}<label
            for="{uid}-predicate">{t('indexes.partial')}</label
          ><select id="{uid}-predicate" bind:value={draft.predicateColumn}
            ><option value="">{t('indexes.none')}</option>{#each columns as column}<option
                value={column}>{identifierLabel(column)}</option
              >{/each}</select
          ><label for="{uid}-operator">{t('indexes.operator')}</label><select
            id="{uid}-operator"
            bind:value={draft.predicateOperator}
            ><option value="is_null">IS NULL</option><option value="is_not_null">IS NOT NULL</option
            ></select
          >{/if}
        {#if isForeign(draft.action)}
          <p role="note">{t('indexes.replacement')}</p>
          <label for="{uid}-schema">{t('indexes.referenceSchema')}</label><input
            id="{uid}-schema"
            bind:value={draft.schema}
            autocomplete="off"
          />
          <label for="{uid}-table">{t('indexes.referenceTable')}</label><input
            id="{uid}-table"
            bind:value={draft.table}
            autocomplete="off"
          />
          <label for="{uid}-delete">ON DELETE</label><select
            id="{uid}-delete"
            bind:value={draft.onDelete}
            >{#each ['no_action', 'restrict', 'cascade', 'set_null', ...(driver === 'postgres' ? ['set_default'] : [])] as action}<option
                value={action}>{actionLabel(action)}</option
              >{/each}</select
          >
          <label for="{uid}-update">ON UPDATE</label><select
            id="{uid}-update"
            bind:value={draft.onUpdate}
            >{#each ['no_action', 'restrict', 'cascade', 'set_null', ...(driver === 'postgres' ? ['set_default'] : [])] as action}<option
                value={action}>{actionLabel(action)}</option
              >{/each}</select
          >
        {/if}
        {#each issues as issue}<p role="status">{issue}</p>{/each}
        <Button
          type="submit"
          disabled={issues.length > 0 ||
            (needsTarget(draft.action) && !availableTargets.includes(draft.name))}
          >{t('indexes.showPlan')}</Button
        >
      </fieldset>
    </form>
  {/if}
  {#if operation.error}<p role="alert">{operation.error}</p>{/if}
  {#if operation.plan}
    {@const plan = operation.plan}
    <section data-testid="indexes-plan">
      <h3>{t('indexes.plan')}</h3>
      <PlanPreview
        statements={plan.statements}
        warnings={plan.warnings}
        planSha256={plan.plan_sha256}
      />
      <p>{plan.ddl_transactional ? t('indexes.transactional') : t('indexes.notTransactional')}</p>
      <p>
        {t('indexes.duplicates')}: {plan.duplicate_groups ?? t('indexes.unknown')} · {t(
          'indexes.containsNull',
        )}: {stateLabel(plan.contains_null ? 'yes' : 'no')}
      </p>
      <h4>{t('indexes.affected')}</h4>
      <ul>
        {#each plan.affected_objects as name}<li>{name}</li>{/each}
      </ul>
      <h4>{t('indexes.dependencies')}</h4>
      <p>{t('indexes.dependencyHint')}</p>
      <ul>
        {#each plan.dependencies as dependency}<li>
            {label(dependency.kind)}: {identifierLabel(dependency.schema)} / {identifierLabel(
              dependency.name,
            )} / {dependency.constraint === null
              ? t('indexes.unknown')
              : identifierLabel(dependency.constraint)} · {label(dependency.certainty)} · {label(
              dependency.effect,
            )}
          </li>{/each}
      </ul>
      {#if operation.phase === 'planned'}
        {#if plan.destructive}<p>{t('indexes.destructive', { name: plan.target_name })}</p>
          <Button disabled={writeBusy} onclick={() => (dialog = true)}
            >{t('indexes.executeDestructive')}</Button
          >
        {:else}<label
            ><input type="checkbox" bind:checked={confirmed} />{t('indexes.confirm')}</label
          ><Button disabled={!confirmed || writeBusy} onclick={() => execute()}
            >{t('indexes.execute')}</Button
          >{/if}
        <Button
          disabled={writeBusy}
          onclick={() => {
            operation.discardPlan();
            confirmed = false;
          }}>{t('indexes.edit')}</Button
        >
      {/if}
      <ConfirmDestructiveDialog
        bind:open={dialog}
        title={t('indexes.executeDestructive')}
        description={t('indexes.destructive', { name: plan.target_name })}
        targetName={plan.target_name}
        busy={operation.phase !== 'planned' || writeBusy}
        onconfirm={() => execute(plan.target_name)}
      />
    </section>
  {/if}
  {#if operation.phase === 'executing'}<p role="status">{t('indexes.executing')}</p>{/if}
  {#if operation.phase === 'finished'}<section role="status" data-testid="indexes-result">
      <h3>
        {operation.unknown
          ? t('indexes.resultUnknown')
          : operation.result?.outcome === 'completed'
            ? t('indexes.resultCompleted')
            : t('indexes.resultRejected')}
      </h3>
      {#if operation.unknown}<p>{t('indexes.errUnknown')}</p>{/if}
      {#if operation.result}<p>{label(`reason_${operation.result.reason}`)}</p>
        <p>
          {t('indexes.executed', { count: operation.result.statements_executed })} · {label(
            `observation_${operation.result.observation}`,
          )}
        </p>
        {#if operation.result.atomic}<p>{t('indexes.atomic')}</p>{/if}{/if}
      <Button disabled={writeBusy} onclick={reset}>{t('indexes.newPlan')}</Button>
    </section>{/if}
</section>

<style>
  .indexes-panel,
  form,
  fieldset,
  .term {
    display: grid;
    gap: 0.75rem;
    min-width: 0;
  }
  .indexes-panel {
    padding: 1rem;
    overflow-wrap: anywhere;
  }
  fieldset,
  .term {
    border: 1px solid var(--color-border);
    padding: 0.75rem;
  }
  input,
  select {
    min-width: 0;
    max-width: 100%;
    padding: 0.4rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-background);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .scroll {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    font-size: 0.875rem;
    width: 100%;
  }
  th,
  td {
    border: 1px solid var(--color-border);
    padding: 0.5rem;
    text-align: left;
    vertical-align: top;
  }
  caption {
    text-align: left;
    font-weight: 600;
    padding: 0.5rem 0;
  }
</style>
