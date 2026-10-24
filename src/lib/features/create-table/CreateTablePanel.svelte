<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { ArrowDown, ArrowUp, CircleCheck, Plus, Trash2, TriangleAlert } from '@lucide/svelte';
  import { toConnection } from '$lib/api';
  import CapabilityNotice from '$lib/components/shared/CapabilityNotice.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import type { FeatureProps } from '$lib/features';
  import { t } from '$lib/i18n';
  import { getShellContext } from '$lib/shell/context';
  import { createClient, createErrorMessage, type CreateTableResult } from './client';
  import {
    LIMITS,
    buildRequest,
    emptyDraft,
    newColumn,
    normalizeColumn,
    typeLabel,
    validateDraft,
    type ColumnDraft,
    type TableDraft,
    type TypeKind,
  } from './model';

  let { connection, token, onwritephase }: FeatureProps = $props();
  const shell = getShellContext();
  const uid = $props.id();

  let draft = $state<TableDraft>(emptyDraft());
  let step = $state<'edit' | 'review'>('edit');
  let confirmed = $state(false);
  let sending = $state(false);
  let result = $state<CreateTableResult | null>(null);
  let createdName = $state('');
  let errorText = $state('');
  let unknown = $state(false);
  let caps = $state<'loading' | 'ready' | 'unsupported' | 'failed'>('loading');
  let capsMessage = $state('');
  // Bumped whenever token or connection change; answers of an older generation are discarded.
  let generation = 0;

  const issues = $derived(
    validateDraft(
      draft,
      connection ? { driver: connection.driver, database: connection.database } : undefined,
    ),
  );
  const driver = $derived(connection?.driver ?? 'sqlite');
  const columnNames = $derived(new Map(draft.columns.map((c) => [c.key, c.name])));
  const nameExists = $derived(
    !!shell?.session.objects.some(
      (object) =>
        object.name === draft.name &&
        (draft.schema === '' || object.schema === undefined || object.schema === draft.schema),
    ),
  );
  const frozen = $derived(unknown || result !== null);

  function resetAll() {
    draft = emptyDraft();
    step = 'edit';
    confirmed = false;
    sending = false;
    result = null;
    createdName = '';
    errorText = '';
    unknown = false;
  }

  $effect(() => {
    const currentConnection = connection;
    const currentToken = token;
    const current = ++generation;
    untrack(() => {
      resetAll();
      caps = 'loading';
      capsMessage = '';
    });
    if (!currentConnection) return;
    const controller = new AbortController();
    createClient
      .capabilities(currentToken, controller.signal)
      .then(() => {
        if (current === generation) caps = 'ready';
      })
      .catch((cause: unknown) => {
        if (current !== generation || controller.signal.aborted) return;
        const code = (cause as { code?: string }).code;
        caps = code === 'unsupported_feature' ? 'unsupported' : 'failed';
        capsMessage = createErrorMessage(cause);
      });
    return () => controller.abort();
  });

  const label = (key: number) => {
    const name = columnNames.get(key) ?? '';
    return name === '' ? t('table-create.unnamedColumn') : name;
  };
  const position = (column: ColumnDraft) => draft.columns.indexOf(column) + 1;
  const inKey = (column: ColumnDraft) => draft.primaryKey.includes(column.key);
  const issuesFor = (column: ColumnDraft, field: string) =>
    issues.filter((i) => i.scope === 'column' && i.key === column.key && i.field === field);

  function update(column: ColumnDraft, patch: Partial<ColumnDraft>) {
    const index = draft.columns.findIndex((c) => c.key === column.key);
    if (index >= 0) draft.columns[index] = normalizeColumn({ ...draft.columns[index], ...patch });
  }
  function addColumn() {
    if (draft.columns.length < LIMITS.columns) draft.columns.push(newColumn());
  }
  function removeColumn(column: ColumnDraft) {
    if (draft.columns.length <= 1) return;
    draft.columns = draft.columns.filter((c) => c.key !== column.key);
    draft.primaryKey = draft.primaryKey.filter((key) => key !== column.key);
  }
  function toggleKey(column: ColumnDraft, checked: boolean) {
    if (checked) {
      if (!inKey(column)) draft.primaryKey = [...draft.primaryKey, column.key];
      update(column, { nullable: false });
    } else draft.primaryKey = draft.primaryKey.filter((key) => key !== column.key);
  }
  function moveKey(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= draft.primaryKey.length) return;
    const next = [...draft.primaryKey];
    [next[index], next[target]] = [next[target], next[index]];
    draft.primaryKey = next;
  }
  function defaultText(column: ColumnDraft) {
    if (column.defaultMode === 'null') return t('table-create.reviewDefaultNull');
    if (column.defaultMode === 'value')
      return t('table-create.reviewDefaultValue', { value: JSON.stringify(column.defaultValue) });
    return t('table-create.reviewDefaultNone');
  }
  function toReview() {
    if (issues.length > 0 || frozen) return;
    errorText = '';
    confirmed = false;
    step = 'review';
  }

  async function submit() {
    // The flag is set before the first await so that a double click can never send twice.
    if (sending || frozen || step !== 'review' || !confirmed || !connection) return;
    if (issues.length > 0) {
      step = 'edit';
      return;
    }
    const current = generation;
    const request = buildRequest(draft, toConnection(connection), connection.driver !== 'sqlite');
    sending = true;
    errorText = '';
    try {
      const outcome = await createClient.create(request, token, () => onwritephase?.('sending'));
      if (current !== generation) return;
      result = outcome;
      createdName = request.table.name;
      onwritephase?.('settled');
      void shell?.session.loadCatalog();
    } catch (cause) {
      if (current !== generation) return;
      const code = (cause as { code?: string }).code;
      errorText = createErrorMessage(cause);
      if (code === 'outcome_unknown') {
        unknown = true;
        onwritephase?.('unknown');
      } else {
        onwritephase?.('settled');
        step = 'edit';
        confirmed = false;
      }
    } finally {
      if (current === generation) sending = false;
    }
  }
  const kinds: { value: TypeKind; key: string }[] = [
    { value: 'int64', key: 'table-create.typeInt64' },
    { value: 'text', key: 'table-create.typeText' },
    { value: 'binary', key: 'table-create.typeBinary' },
    { value: 'decimal', key: 'table-create.typeDecimal' },
  ];
  const checkKey = {
    transactional: 'table-create.checkTransactional',
    observed: 'table-create.checkObserved',
    different: 'table-create.checkDifferent',
    unavailable: 'table-create.checkUnavailable',
  } as const;
</script>

<section class="create-panel" aria-label={t('table-create.heading')} data-testid="create-table">
  <h2>{t('table-create.heading')}</h2>
  {#if !connection}
    <p class="catalog-message">{t('table-create.noConnection')}</p>
  {:else if caps === 'loading'}
    <p class="catalog-message" role="status">{t('table-create.capsLoading')}</p>
  {:else if caps === 'unsupported'}
    <CapabilityNotice title={t('table-create.capsUnsupportedTitle')} reason={capsMessage} />
  {:else if caps === 'failed'}
    <div class="feedback error-feedback" role="alert">
      <TriangleAlert size={20} />
      <div>
        <strong>{t('table-create.capsUnsupportedTitle')}</strong>
        <p>{t('table-create.capsFailed')} {capsMessage}</p>
      </div>
    </div>
  {:else}
    <p class="intro">{t('table-create.intro')}</p>
    <p class="note">
      {t('table-create.limits', {
        columns: LIMITS.columns,
        nameBytes: LIMITS.nameBytes,
        keyColumns: LIMITS.primaryKeyColumns,
      })}
      {t('table-create.timeoutHint')}
    </p>
    {#if driver === 'sqlite'}
      <div class="note sqlite-note" role="note" data-testid="sqlite-note">
        <strong>{t('table-create.sqliteNoteTitle')}</strong>
        <ul>
          <li>{t('table-create.sqliteNoteKey')}</li>
          <li>{t('table-create.sqliteNoteTypes')}</li>
        </ul>
      </div>
    {/if}

    {#if errorText}
      <div
        class="feedback error-feedback"
        role="alert"
        data-testid={unknown ? 'create-unknown' : 'create-error'}
      >
        <TriangleAlert size={20} />
        <div>
          <strong>{unknown ? t('table-create.unknownTitle') : t('table-create.errorTitle')}</strong>
          <p>{errorText}</p>
          {#if unknown}
            <div class="actions">
              <Button variant="outline" size="sm" onclick={() => void shell?.session.loadCatalog()}
                >{t('table-create.unknownAction')}</Button
              >
              <Button variant="outline" size="sm" onclick={resetAll}
                >{t('table-create.unknownReset')}</Button
              >
            </div>
          {/if}
        </div>
      </div>
    {/if}

    {#if result}
      <div class="feedback success-feedback" role="status" data-testid="create-result">
        <CircleCheck size={20} />
        <div>
          <strong>{t('table-create.resultTitle')}</strong>
          <p>{t('table-create.resultText', { table: JSON.stringify(createdName) })}</p>
          <p>
            <strong>{t('table-create.structureCheck')}:</strong>
            <span data-testid="structure-check">{result.structure_check}</span>
            · {t('table-create.snapshotAtomic')}:
            {result.snapshot_atomic ? t('table-create.yes') : t('table-create.no')}
          </p>
          <p>{t(checkKey[result.structure_check])}</p>
          {#if result.actual_description}
            <h3>{t('table-create.actualStructure')}</h3>
            <div class="table-scroll">
              <table data-testid="actual-structure">
                <thead>
                  <tr>
                    <th>{t('table-create.actualColumn')}</th>
                    <th>{t('table-create.actualType')}</th>
                    <th>{t('table-create.actualNullable')}</th>
                    <th>{t('table-create.actualDefault')}</th>
                    <th>{t('table-create.actualKey')}</th>
                  </tr>
                </thead>
                <tbody>
                  {#each result.actual_description.columns as column (column.name)}
                    <tr>
                      <td>{JSON.stringify(column.name)}</td>
                      <td>{column.database_type}</td>
                      <td>{column.nullable ? t('table-create.yes') : t('table-create.no')}</td>
                      <td>{column.default_value ?? ''}</td>
                      <td>{column.pk_position > 0 ? column.pk_position : ''}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
          <div class="actions">
            <Button variant="outline" size="sm" onclick={resetAll}
              >{t('table-create.another')}</Button
            >
          </div>
        </div>
      </div>
    {/if}

    {#if !frozen && step === 'edit'}
      <form
        onsubmit={(event) => {
          event.preventDefault();
          toReview();
        }}
      >
        {#if driver !== 'sqlite'}
          <div class="field">
            <label for="{uid}-schema">{t('table-create.schema')}</label>
            <Input id="{uid}-schema" bind:value={draft.schema} autocomplete="off" />
            <small
              >{driver === 'postgresql'
                ? t('table-create.schemaHintPostgres')
                : t('table-create.schemaHintMysql')}</small
            >
            {#each issues.filter((i) => i.scope === 'table' && i.field === 'schema') as issue (issue.message)}
              <small class="issue">{issue.message}</small>
            {/each}
          </div>
        {/if}
        <div class="field">
          <label for="{uid}-name">{t('table-create.tableName')}</label>
          <Input id="{uid}-name" bind:value={draft.name} autocomplete="off" spellcheck="false" />
          <small>{t('table-create.tableNameHint')}</small>
          {#each issues.filter((i) => i.scope === 'table' && i.field === 'name') as issue (issue.message)}
            <small class="issue">{issue.message}</small>
          {/each}
        </div>

        <h3>{t('table-create.columnsHeading')}</h3>
        <ol class="columns">
          {#each draft.columns as column (column.key)}
            {@const n = position(column)}
            <li class="column" aria-label={t('table-create.column', { n })}>
              <div class="field">
                <label for="{uid}-c{column.key}-name">{t('table-create.labelName')}</label>
                <Input
                  id="{uid}-c{column.key}-name"
                  aria-label={t('table-create.columnName', { n })}
                  value={column.name}
                  oninput={(e) => update(column, { name: e.currentTarget.value })}
                  autocomplete="off"
                  spellcheck="false"
                />
              </div>
              <div class="field">
                <label for="{uid}-c{column.key}-type">{t('table-create.labelType')}</label>
                <select
                  id="{uid}-c{column.key}-type"
                  aria-label={t('table-create.columnType', { n })}
                  value={column.kind}
                  onchange={(e) => update(column, { kind: e.currentTarget.value as TypeKind })}
                >
                  {#each kinds as kind (kind.value)}
                    <option value={kind.value}>{t(kind.key)}</option>
                  {/each}
                </select>
              </div>
              {#if column.kind === 'text'}
                <div class="field narrow">
                  <label for="{uid}-c{column.key}-length">{t('table-create.labelLength')}</label>
                  <Input
                    id="{uid}-c{column.key}-length"
                    aria-label={t('table-create.columnLength', { n })}
                    inputmode="numeric"
                    value={column.length}
                    oninput={(e) => update(column, { length: e.currentTarget.value })}
                  />
                </div>
              {:else if column.kind === 'decimal'}
                <div class="field narrow">
                  <label for="{uid}-c{column.key}-precision"
                    >{t('table-create.labelPrecision')}</label
                  >
                  <Input
                    id="{uid}-c{column.key}-precision"
                    aria-label={t('table-create.columnPrecision', { n })}
                    inputmode="numeric"
                    value={column.precision}
                    oninput={(e) => update(column, { precision: e.currentTarget.value })}
                  />
                </div>
                <div class="field narrow">
                  <label for="{uid}-c{column.key}-scale">{t('table-create.labelScale')}</label>
                  <Input
                    id="{uid}-c{column.key}-scale"
                    aria-label={t('table-create.columnScale', { n })}
                    inputmode="numeric"
                    value={column.scale}
                    oninput={(e) => update(column, { scale: e.currentTarget.value })}
                  />
                </div>
              {/if}
              <div class="field">
                <label for="{uid}-c{column.key}-default">{t('table-create.labelDefault')}</label>
                <select
                  id="{uid}-c{column.key}-default"
                  aria-label={t('table-create.columnDefaultMode', { n })}
                  value={column.defaultMode}
                  onchange={(e) =>
                    update(column, {
                      defaultMode: e.currentTarget.value as ColumnDraft['defaultMode'],
                    })}
                >
                  <option value="none">{t('table-create.defaultNone')}</option>
                  <option value="null" disabled={!column.nullable}
                    >{t('table-create.defaultNull')}</option
                  >
                  <option value="value" disabled={column.kind === 'binary'}
                    >{t('table-create.defaultValue')}</option
                  >
                </select>
              </div>
              {#if column.defaultMode === 'value'}
                <div class="field">
                  <label for="{uid}-c{column.key}-const">{t('table-create.labelConstant')}</label>
                  <Input
                    id="{uid}-c{column.key}-const"
                    aria-label={t('table-create.columnDefaultValue', { n })}
                    value={column.defaultValue}
                    oninput={(e) => update(column, { defaultValue: e.currentTarget.value })}
                    autocomplete="off"
                    spellcheck="false"
                  />
                </div>
              {/if}
              <label class="check">
                <input
                  type="checkbox"
                  aria-label={t('table-create.columnNullable', { n })}
                  checked={column.nullable}
                  disabled={inKey(column)}
                  onchange={(e) => update(column, { nullable: e.currentTarget.checked })}
                />
                {t('table-create.labelNullable')}
              </label>
              <label class="check">
                <input
                  type="checkbox"
                  aria-label={t('table-create.columnPrimaryKey', { n })}
                  checked={inKey(column)}
                  disabled={!inKey(column) && column.kind !== 'int64' && column.kind !== 'text'}
                  onchange={(e) => toggleKey(column, e.currentTarget.checked)}
                />
                {t('table-create.labelPrimaryKey')}
              </label>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t('table-create.columnRemove', { n })}
                disabled={draft.columns.length <= 1}
                onclick={() => removeColumn(column)}><Trash2 size={15} /></Button
              >
              {#each [...issuesFor(column, 'name'), ...issuesFor(column, 'length'), ...issuesFor(column, 'precision'), ...issuesFor(column, 'default')] as issue (issue.message)}
                <small class="issue wide">{issue.message}</small>
              {/each}
            </li>
          {/each}
        </ol>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={draft.columns.length >= LIMITS.columns}
          onclick={addColumn}><Plus size={15} />{t('table-create.addColumn')}</Button
        >
        {#if draft.columns.length >= LIMITS.columns}
          <small>{t('table-create.maxColumnsReached', { max: LIMITS.columns })}</small>
        {/if}

        <h3>{t('table-create.primaryKeyHeading')}</h3>
        <p class="note">{t('table-create.primaryKeyHint')}</p>
        {#if draft.primaryKey.length === 0}
          <p>{t('table-create.primaryKeyEmpty')}</p>
        {:else}
          <ol class="key-order" data-testid="key-order">
            {#each draft.primaryKey as key, index (key)}
              <li>
                <code>{label(key)}</code>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={t('table-create.primaryKeyUp', { name: label(key) })}
                  disabled={index === 0}
                  onclick={() => moveKey(index, -1)}><ArrowUp size={14} /></Button
                >
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={t('table-create.primaryKeyDown', { name: label(key) })}
                  disabled={index === draft.primaryKey.length - 1}
                  onclick={() => moveKey(index, 1)}><ArrowDown size={14} /></Button
                >
              </li>
            {/each}
          </ol>
        {/if}

        {#if issues.length > 0}
          <div class="feedback error-feedback" role="status" data-testid="create-issues">
            <TriangleAlert size={20} />
            <div>
              <strong>{t('table-create.issuesHeading')}</strong>
              <ul>
                {#each issues as issue, index (index)}
                  <li>
                    {#if issue.key !== undefined}<em>{label(issue.key)}:</em>
                    {/if}{issue.message}
                  </li>
                {/each}
              </ul>
            </div>
          </div>
        {/if}
        <div class="actions">
          <Button type="submit" disabled={issues.length > 0}>{t('table-create.review')}</Button>
        </div>
      </form>
    {:else if !frozen && step === 'review'}
      <div class="review" data-testid="create-review">
        <h3>{t('table-create.reviewHeading')}</h3>
        <p>
          <strong>{t('table-create.reviewTarget')}:</strong>
          {draft.schema === '' || driver === 'sqlite'
            ? t('table-create.reviewTargetValue', {
                table: JSON.stringify(draft.name),
                database: JSON.stringify(connection.database),
              })
            : t('table-create.reviewTargetSchema', {
                table: JSON.stringify(draft.name),
                schema: JSON.stringify(draft.schema),
                database: JSON.stringify(connection.database),
              })}
        </p>
        {#if nameExists}
          <div class="feedback error-feedback" role="status">
            <TriangleAlert size={20} />
            <p>{t('table-create.existsWarning')}</p>
          </div>
        {/if}
        <ol class="summary">
          {#each draft.columns as column (column.key)}
            <li>
              <code>{JSON.stringify(column.name)}</code>
              {typeLabel(column)} ·
              {column.nullable ? t('table-create.reviewNullable') : t('table-create.reviewNotNull')} ·
              {defaultText(column)}
            </li>
          {/each}
        </ol>
        <p>
          {draft.primaryKey.length === 0
            ? t('table-create.reviewNoKey')
            : t('table-create.reviewKey', {
                columns: draft.primaryKey
                  .map((key) => JSON.stringify(columnNames.get(key)))
                  .join(', '),
              })}
        </p>
        <p class="note">{t('table-create.reviewNoSql')}</p>
        <label class="check confirm">
          <input type="checkbox" bind:checked={confirmed} disabled={sending} />
          {t('table-create.confirm', { table: JSON.stringify(draft.name) })}
        </label>
        <div class="actions">
          <Button type="button" variant="outline" disabled={sending} onclick={() => (step = 'edit')}
            >{t('table-create.back')}</Button
          >
          <Button type="button" disabled={!confirmed || sending} onclick={submit}
            >{sending ? t('table-create.sending') : t('table-create.submit')}</Button
          >
        </div>
      </div>
    {/if}
  {/if}
</section>

<style>
  .create-panel {
    display: grid;
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
  .note ul {
    margin: 0.25rem 0 0;
    padding-left: 1.25rem;
  }
  form {
    display: grid;
    gap: 0.75rem;
  }
  .field {
    display: grid;
    gap: 0.25rem;
    min-width: 0;
  }
  .field label {
    font-size: 0.8125rem;
    font-weight: 600;
  }
  .columns,
  .summary,
  .key-order {
    display: grid;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .column {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.5rem 0.75rem;
    padding: 0.625rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-muted);
  }
  .column .field {
    flex: 1 1 10rem;
  }
  .column .field.narrow {
    flex: 0 1 6rem;
  }
  select {
    height: 2rem;
    min-width: 0;
    padding: 0 0.5rem;
    border: 1px solid var(--color-input);
    border-radius: var(--radius-md);
    background: var(--color-background);
    color: inherit;
    font: inherit;
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.8125rem;
  }
  .confirm {
    font-size: 0.9375rem;
  }
  .issue {
    color: var(--color-destructive);
  }
  .issue.wide {
    flex: 1 1 100%;
  }
  .key-order li {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }
  .review {
    display: grid;
    gap: 0.75rem;
  }
  .summary li {
    overflow-wrap: anywhere;
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
  }
  code {
    overflow-wrap: anywhere;
  }
</style>
