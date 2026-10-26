<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { toConnection } from '$lib/api';
  import type { FeatureProps } from '$lib/features';
  import { t } from '$lib/i18n';
  import { getShellContext } from '$lib/shell/context';
  import PlanPreview from '$lib/components/shared/PlanPreview.svelte';
  import { programsClient } from './client';
  import {
    bodyFits,
    driverOf,
    kinds,
    type Input,
    type Kind,
    type Schemas,
    type Target,
  } from './model';
  import { Resource } from './resource.svelte';
  import { Operation } from './operation.svelte';
  import DefinitionForm from './DefinitionForm.svelte';
  import Dependencies from './Dependencies.svelte';
  let { connection, token, database, onwritephase }: FeatureProps = $props();
  const shell = getShellContext();
  const caps = new Resource<Schemas['ProgramsCapabilities']>();
  const list = new Resource<Schemas['ProgramsResult']>();
  const detail = new Resource<Schemas['Program']>();
  let kind = $state<Kind>('view');
  let schema = $state('');
  let offset = $state(0);
  let action = $state<'create' | 'replace' | 'drop'>('create');
  let name = $state('');
  let tableName = $state('');
  let tableSchema = $state('');
  let input = $state<Input>({ body: '' });
  let editing = $state(false);
  let confirmed = $state(false);
  let typed = $state('');
  let replacementReviewed = $state(false);
  // Definition shown before replace/drop; the backend never returns it in plan or result.
  let previousDefinition = $state<string | null>(null);
  const hasPrevious = $derived(previousDefinition !== null);
  const driver = $derived(connection ? driverOf(connection.driver) : 'sqlite');
  const support = $derived(caps.data?.drivers[driver][kind]);
  const operation = new Operation({
    token: () => token,
    onphase: (phase) => onwritephase(phase),
    onfinished: () => {
      detail.reset();
      void loadList();
      shell?.session.loadCatalog();
    },
  });
  const writeBusy = $derived(!!shell?.session.writeInFlight || operation.phase === 'executing');
  const busy = $derived(writeBusy || operation.phase === 'planning');
  const selected = $derived(detail.data?.object as Target | undefined);
  const apiConnection = () => (connection ? toConnection(connection) : null);
  function clearEditor() {
    operation.reset();
    editing = false;
    confirmed = false;
    typed = '';
    replacementReviewed = false;
    previousDefinition = null;
    name = '';
    tableName = '';
    tableSchema = '';
    input = { body: '' };
  }
  async function loadList() {
    const conn = apiConnection();
    if (!conn || !caps.data || support?.support === 'unsupported') {
      list.reset();
      return;
    }
    await list.run((signal) =>
      programsClient.list(
        { connection: conn, kind, ...(schema ? { schema } : {}), offset, limit: 200 },
        token,
        signal,
      ),
    );
  }
  async function show(object: Schemas['ProgramRef']) {
    if (busy) return;
    clearEditor();
    const conn = apiConnection();
    if (!conn || object.kind === 'table') return;
    await detail.run((signal) =>
      programsClient.describe({ connection: conn, object: object as Target }, token, signal),
    );
  }
  function start(next: typeof action) {
    if (busy || support?.support === 'unsupported') return;
    operation.reset();
    action = next;
    confirmed = false;
    typed = '';
    replacementReviewed = false;
    previousDefinition = next === 'create' ? null : (detail.data?.definition ?? '');
    name = next === 'create' ? '' : (selected?.name ?? '');
    tableName = next === 'create' ? '' : (selected?.table?.name ?? '');
    tableSchema = next === 'create' ? schema : (selected?.table?.schema ?? schema);
    input = {
      body: next === 'replace' ? (detail.data?.body ?? '') : '',
      ...(kind === 'function' || kind === 'procedure'
        ? {
            parameters: [],
            ...(driver === 'postgres' ? { language: 'sql' as const } : {}),
            ...(kind === 'function' ? { returns: 'text' as const } : {}),
          }
        : {}),
      ...(kind === 'trigger'
        ? {
            timing: 'after' as const,
            event: 'insert' as const,
            ...(driver === 'postgres'
              ? { function: { kind: 'function' as const, schema, name: '', identity: '' } }
              : {}),
          }
        : {}),
      ...(kind === 'event' ? { schedule: { preserve: true }, status: 'disabled' as const } : {}),
    };
    editing = true;
  }
  function change() {
    const conn = apiConnection();
    if (!conn) return null;
    const object: Target =
      action === 'create'
        ? {
            kind,
            name,
            ...(schema ? { schema } : {}),
            ...(kind === 'trigger'
              ? { table: { name: tableName, ...(tableSchema ? { schema: tableSchema } : {}) } }
              : {}),
          }
        : structuredClone($state.snapshot(selected!));
    return {
      connection: conn,
      action,
      object,
      ...(action !== 'drop' ? { input: structuredClone($state.snapshot(input)) } : {}),
    };
  }
  function plan() {
    if (busy || !valid) return;
    const body = change();
    if (body) void operation.loadPlan(body);
  }
  const valid = $derived(
    !!name &&
      (action === 'create' || !!selected) &&
      (action !== 'replace' || replacementReviewed) &&
      (action === 'drop' ||
        (bodyFits(input.body) &&
          (input.body.trim() !== '' || (kind === 'trigger' && driver === 'postgres')))),
  );
  $effect(() => {
    connection;
    token;
    database;
    untrack(() => {
      caps.reset();
      list.reset();
      detail.reset();
      clearEditor();
      kind = 'view';
      schema = '';
      offset = 0;
      if (connection) void caps.run((signal) => programsClient.capabilities(token, signal));
    });
    return () => {
      caps.reset();
      list.reset();
      detail.reset();
      operation.reset();
    };
  });
  $effect(() => {
    kind;
    schema;
    offset;
    caps.data;
    untrack(() => {
      detail.reset();
      clearEditor();
      void loadList();
    });
  });
</script>

<section class="programs" aria-label={t('programs.tab')} data-testid="programs">
  <h2>{t('programs.tab')}</h2>
  <p>{t('programs.scope')}</p>
  {#if !connection}<p>{t('programs.noConnection')}</p>{:else if caps.busy}<p role="status">
      {t('programs.loading')}
    </p>{:else if caps.error}<p role="alert">{caps.error}</p>{:else if caps.data}
    <fieldset disabled={busy} class="filters">
      <label
        >{t('programs.kind')}<select bind:value={kind} onchange={() => (offset = 0)}
          >{#each kinds as item}<option value={item}>{t(`programs.kinds.${item}`)}</option
            >{/each}</select
        ></label
      >
      <label
        >{t('programs.schema')}<input
          bind:value={schema}
          oninput={() => (offset = 0)}
          autocomplete="off"
        /></label
      >
    </fieldset>
    {#if support && 'reason' in support && support.reason}<p role="status">{support.reason}</p>{/if}
    {#if support?.support !== 'unsupported'}
      <button
        disabled={busy || list.busy}
        onclick={() => {
          detail.reset();
          clearEditor();
          void loadList();
        }}>{t('programs.reload')}</button
      >
      <button disabled={busy} onclick={() => start('create')}>{t('programs.create')}</button>
      {#if list.busy}<p role="status">{t('programs.loading')}</p>{/if}
      {#if list.error}<p role="alert">{list.error}</p>{/if}
      {#if list.data}
        {#each list.data.warnings as warning}<p role="alert">{warning}</p>{/each}
        {#if kind === 'event'}<p>
            {t('programs.scheduler')}: {list.data.scheduler ?? t('programs.none')}
          </p>
          <p>{t('programs.eventErrors')}</p>{/if}
        <ul data-testid="program-list">
          {#each list.data.objects as item}<li>
              <button disabled={busy} onclick={() => show(item.object)}
                >{item.object.schema ?? ''}.{item.object.name}
                {item.object.identity ?? ''}{item.object.table
                  ? ` (${item.object.table.name})`
                  : ''}</button
              >
            </li>{/each}
        </ul>
        <button disabled={busy || offset === 0} onclick={() => (offset = Math.max(0, offset - 200))}
          >{t('programs.previous')}</button
        >
        <button
          disabled={busy || !list.data.has_more || offset >= 100000}
          onclick={() => (offset += 200)}>{t('programs.next')}</button
        >
        {#if list.data.has_more}<p>{t('programs.more')}</p>{/if}
      {/if}
      {#if detail.busy}<p role="status">{t('programs.loading')}</p>{/if}
      {#if detail.error}<p role="alert">{detail.error}</p>{/if}
      {#if detail.data}
        <section data-testid="program-detail">
          <h3>{detail.data.object.name} {detail.data.object.identity ?? ''}</h3>
          <h4>{t('programs.definition')}</h4>
          <pre>{detail.data.definition ?? t('programs.none')}</pre>
          <p>
            {t('programs.definer')}: {detail.data.definer?.name ?? t('programs.none')}
            {detail.data.definer?.host ?? ''}
          </p>
          <p>{t('programs.security')}: {detail.data.security ?? t('programs.none')}</p>
          {#if detail.data.security === 'definer' || detail.data.definer}<p
              role="alert"
              data-testid="definer-warning"
            >
              {t('programs.definerWarning')}
            </p>{/if}
          <h4>{t('programs.properties')}</h4>
          <dl>
            {#each Object.entries(detail.data.properties) as [key, value]}<dt>
                {t(`programs.propertiesNames.${key}`)}
              </dt>
              <dd>{value}</dd>{/each}
          </dl>
          <h4>{t('programs.parameters')}</h4>
          <ul>
            {#each detail.data.parameters as p}<li>
                {p.mode.toUpperCase()}
                {p.name}: {p.type}
              </li>{/each}
          </ul>
          {#each detail.data.warnings as warning}<p role="alert">{warning}</p>{/each}
          <Dependencies
            items={detail.data.dependencies}
            truncated={detail.data.dependencies_truncated}
          />
          <button disabled={busy} onclick={() => start('replace')}>{t('programs.replace')}</button
          ><button disabled={busy} onclick={() => start('drop')}>{t('programs.drop')}</button>
        </section>
      {/if}
      {#if editing}
        <section aria-label={t(`programs.${action}`)}>
          <h3>{t(`programs.${action}`)}</h3>
          {#if operation.phase === 'idle'}
            <fieldset disabled={busy}>
              <label
                >{t('programs.name')}<input
                  bind:value={name}
                  readonly={action !== 'create'}
                /></label
              >
              {#if action === 'create' && kind === 'trigger'}<label
                  >{t('programs.tableSchema')}<input bind:value={tableSchema} /></label
                ><label>{t('programs.table')}<input bind:value={tableName} /></label>{/if}
              {#if action === 'replace'}<p role="alert">{t('programs.replaceWarning')}</p>
                <label
                  ><input type="checkbox" bind:checked={replacementReviewed} />{t(
                    'programs.replaceReviewed',
                  )}</label
                >{/if}
              {#if action !== 'drop'}<DefinitionForm
                  bind:value={input}
                  {kind}
                  {driver}
                  disabled={busy}
                />{/if}
            </fieldset>
            {#if !bodyFits(input.body)}<p role="alert">{t('programs.tooLarge')}</p>{/if}
            <button disabled={busy || !valid} onclick={plan}>{t('programs.plan')}</button>
          {/if}
          {#if operation.plan}
            <div data-testid="program-plan">
              <PlanPreview
                statements={operation.plan.statements}
                warnings={operation.plan.warnings}
                planSha256={operation.plan.plan_sha256}
              />
              <p>
                {operation.plan.transactional
                  ? t('programs.transactional')
                  : t('programs.nonAtomic')}
              </p>
              <p>{t('programs.planHint')}</p>
              {#if hasPrevious}<h4>{t('programs.previousDefinition')}</h4>
                <pre data-testid="previous-definition">{previousDefinition ||
                    t('programs.none')}</pre>{/if}
              <h4>{t('programs.affected')}</h4>
              <ul>
                {#each operation.plan.affected_objects as item}<li>{item}</li>{/each}
              </ul>
              <Dependencies
                items={operation.plan.dependencies}
                truncated={operation.plan.dependencies_truncated}
              />
            </div>
            {#if operation.phase === 'planned'}
              <label
                ><input type="checkbox" bind:checked={confirmed} disabled={writeBusy} />{t(
                  'programs.confirm',
                )}</label
              >
              {#if operation.plan.action !== 'create' || operation.plan.destructive}<label
                  >{t('programs.typed', { name: operation.plan.object.name })}<input
                    bind:value={typed}
                    disabled={writeBusy}
                    autocomplete="off"
                    spellcheck={false}
                  /></label
                >{/if}
              <button
                disabled={writeBusy ||
                  !confirmed ||
                  ((operation.plan.action !== 'create' || operation.plan.destructive) &&
                    typed !== operation.plan.object.name)}
                onclick={() => {
                  if (!writeBusy) void operation.execute(confirmed, typed);
                }}>{t('programs.execute')}</button
              >
            {/if}
          {/if}
          {#if operation.error}<p role="alert">{operation.error}</p>{/if}
          {#if operation.result}<p role="status">
              {t(`programs.${operation.result.outcome}`)}
              {operation.result.statements_executed}/{operation.result.statements_total}; {t(
                'programs.observation',
              )}
            </p>
            {#if operation.result.reason}<p>
                {t(
                  `object-ops.${{ permission_denied: 'reasonPermission', object_exists: 'reasonExists', object_not_found: 'reasonNotFound', dependency_blocks: 'reasonDependency', lock_timeout: 'reasonLock', in_use: 'reasonInUse', invalid_value: 'reasonInvalid', database_error: 'reasonDatabase' }[operation.result.reason]}`,
                )}
              </p>{/if}{/if}
          {#if operation.result && operation.result.statements_executed > 0 && operation.result.statements_executed < operation.result.statements_total}<p
              role="alert"
              data-testid="partial-replace"
            >
              {t('programs.partial')}
            </p>
            {#if hasPrevious}<h4>{t('programs.previousDefinition')}</h4>
              <pre data-testid="previous-definition-result">{previousDefinition ||
                  t('programs.none')}</pre>{/if}{/if}
          {#if operation.unknown}<p role="alert">{t('programs.unknown')}</p>{/if}
          {#if operation.phase === 'finished'}<p>{t('programs.locked')}</p>{/if}
          <button
            disabled={busy}
            onclick={() => {
              clearEditor();
              detail.reset();
            }}>{t('programs.newPlan')}</button
          >
        </section>
      {/if}
    {/if}
  {/if}
</section>

<style>
  .programs {
    display: grid;
    gap: 0.75rem;
    padding: 1rem;
    min-width: 0;
  }
  fieldset,
  label {
    display: grid;
    gap: 0.4rem;
    min-width: 0;
  }
  fieldset {
    border: 0;
    padding: 0;
    gap: 0.75rem;
  }
  input,
  select,
  button {
    border: 1px solid var(--border);
    border-radius: 0.3rem;
    padding: 0.4rem;
    min-width: 0;
    max-width: 100%;
  }
  input[type='checkbox'] {
    width: auto;
  }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-family: monospace;
  }
  p,
  li,
  dd,
  button {
    overflow-wrap: anywhere;
  }
  dd {
    margin-left: 1rem;
  }
  section {
    min-width: 0;
  }
</style>
