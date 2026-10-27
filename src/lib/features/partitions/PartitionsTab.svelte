<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { Plus, RefreshCw, Trash2, TriangleAlert } from '@lucide/svelte';
  import { toConnection } from '$lib/api';
  import CapabilityNotice from '$lib/components/shared/CapabilityNotice.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import type { FeatureProps } from '$lib/features';
  import { formatNumber, t } from '$lib/i18n';
  import { getShellContext } from '$lib/shell/context';
  import { CapabilityState } from './capabilities.svelte';
  import { errorCode, partitionsClient, structureErrorMessage } from './client';
  import {
    apiDriverOf,
    boundShape,
    METHODS,
    NEEDS_PARTITIONS,
    PARTITION_ACTIONS,
    partitionTitle,
    tableLabel,
    type Method,
    type PartitionAction,
    type PartitionDefinition,
    type PartitionInfo,
    type PartitionsResult,
  } from './model';
  import StructureCard from './StructureCard.svelte';

  let { connection, token, object, onwritephase }: FeatureProps = $props();
  const shell = getShellContext();
  const caps = new CapabilityState();
  const uid = $props.id();

  interface DefRow {
    name: string;
    lessThan: string;
    from: string;
    to: string;
    values: string;
    modulus: string;
    remainder: string;
  }
  const newRow = (): DefRow => ({
    name: '',
    lessThan: '',
    from: '',
    to: '',
    values: '',
    modulus: '',
    remainder: '',
  });

  let list = $state<PartitionsResult | null>(null);
  let listError = $state('');
  let listBusy = $state(false);
  let listGeneration = 0;

  let action = $state<PartitionAction>('analyze');
  let method = $state<Method>('RANGE');
  let column = $state('');
  let count = $state('');
  let selected = $state<string[]>([]);
  let rows = $state<DefRow[]>([newRow()]);

  const driver = $derived(connection ? apiDriverOf(connection.driver) : 'sqlite');
  const driverCaps = $derived(caps.data?.drivers[driver]);
  const inspect = $derived(driverCaps?.inspect);
  const isBase = $derived(!!object && object.type !== 'view');
  const ref = $derived(
    object ? { ...(object.schema ? { schema: object.schema } : {}), name: object.name } : null,
  );
  const objectKey = $derived(object ? `${object.schema ?? ''}\u0000${object.name}` : '');
  const capability = $derived(driverCaps?.[action]);
  const supported = $derived(capability?.support !== 'unsupported');
  /** The method definitions are written for: the chosen one for "define", else the table's own. */
  const effectiveMethod = $derived(action === 'define' ? method : (list?.method ?? ''));
  const shape = $derived(boundShape(driver, effectiveMethod));
  const upperMethod = $derived(effectiveMethod.split(/[ (]/)[0].toUpperCase());
  const needsDefs = $derived(
    action === 'attach' ||
      action === 'reorganize' ||
      (action === 'add' &&
        (driver === 'postgres' || (upperMethod !== 'HASH' && upperMethod !== 'KEY'))) ||
      (action === 'define' && (method === 'RANGE' || method === 'LIST')),
  );
  const needsCount = $derived(
    driver === 'mysql' &&
      (action === 'coalesce' ||
        (action === 'add' && (upperMethod === 'HASH' || upperMethod === 'KEY')) ||
        (action === 'define' && (method === 'HASH' || method === 'KEY'))),
  );
  const needsParts = $derived(NEEDS_PARTITIONS.has(action));
  const partitioned = $derived(!!list && list.method !== '');

  /** What the request names a partition by: the catalog name, qualified for PostgreSQL children. */
  const valueOf = (part: PartitionInfo) =>
    driver === 'postgres' ? tableLabel(part.table) : part.table.name;

  async function loadList() {
    // Only after the capabilities answered: an unsupported driver must not receive a list request.
    if (!connection || !ref || !isBase || !inspect || inspect.support === 'unsupported') return;
    const current = ++listGeneration;
    listBusy = true;
    listError = '';
    try {
      const result = await partitionsClient.listPartitions(
        { connection: toConnection(connection), table: ref },
        token,
      );
      if (current !== listGeneration) return;
      list = result;
      selected = selected.filter((name) => result.partitions.some((p) => valueOf(p) === name));
    } catch (cause) {
      if (current !== listGeneration) return;
      list = null;
      listError = structureErrorMessage(cause);
      void errorCode(cause);
    } finally {
      if (current === listGeneration) listBusy = false;
    }
  }

  $effect(() => {
    token;
    connection;
    if (!connection) return;
    untrack(() => void caps.load(token));
    return () => caps.abort();
  });
  // A different table, connection or token starts from a clean state.
  $effect(() => {
    objectKey;
    connection;
    token;
    untrack(() => {
      listGeneration++;
      list = null;
      listError = '';
      listBusy = false;
      selected = [];
      rows = [newRow()];
      count = '';
      column = '';
    });
  });
  $effect(() => {
    objectKey;
    connection;
    token;
    inspect?.support;
    isBase;
    untrack(() => void loadList());
  });
  // The form keeps the chosen action only while it is meaningful for the table.
  $effect(() => {
    action;
    untrack(() => {
      selected = [];
      rows = [newRow()];
      count = '';
    });
  });

  const wholeCount = $derived(
    /^[0-9]{1,3}$/.test(count) && Number(count) >= 1 && Number(count) <= 100,
  );
  function rowValid(row: DefRow): boolean {
    if (row.name.trim() === '') return false;
    switch (shape) {
      case 'less_than':
        return row.lessThan.trim() !== '';
      case 'from_to':
        return row.from.trim() !== '' && row.to.trim() !== '';
      case 'values':
        return valuesOf(row).length > 0 && valuesOf(row).length <= 100;
      case 'hash':
        return (
          /^[0-9]{1,3}$/.test(row.modulus) &&
          /^[0-9]{1,2}$/.test(row.remainder) &&
          Number(row.modulus) >= 1 &&
          Number(row.modulus) <= 100 &&
          Number(row.remainder) < Number(row.modulus)
        );
      default:
        return false;
    }
  }
  const valuesOf = (row: DefRow) => row.values.split(/\r?\n/).filter((line) => line.trim() !== '');
  function definitions(): PartitionDefinition[] {
    return rows.map((row) => {
      const def: PartitionDefinition = { name: row.name };
      if (shape === 'less_than') def.less_than = row.lessThan;
      else if (shape === 'from_to') {
        def.from = row.from;
        def.to = row.to;
      } else if (shape === 'values') def.values = valuesOf(row);
      else if (shape === 'hash') {
        def.modulus = Number(row.modulus);
        def.remainder = Number(row.remainder);
      }
      return def;
    });
  }
  const formValid = $derived(
    !!ref &&
      supported &&
      (action === 'define' ? column.trim() !== '' : partitioned) &&
      (!needsParts || selected.length > 0) &&
      (!needsDefs || (rows.length > 0 && rows.every(rowValid))) &&
      (!needsCount || wholeCount),
  );
  const fields = () => ({
    table: ref,
    ...(action === 'define' ? { method, column } : {}),
    ...(needsParts ? { partitions: selected } : {}),
    ...(needsDefs ? { definitions: definitions() } : {}),
    ...(needsCount ? { count: Number(count) } : {}),
  });

  function toggle(name: string) {
    selected = selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name];
  }
  function finished(_: unknown, unknown: boolean) {
    // Completed, rejected or unknown: the catalog and the partition list are read again.
    void _;
    void unknown;
    void shell?.session.loadCatalog();
    void loadList();
  }
  const cell = (value: number | null) =>
    value === null ? t('partitions.unknownValue') : formatNumber(value);
</script>

<section class="ops" aria-label={t('partitions.tableHeading')} data-testid="partitions-tab">
  <h2>{t('partitions.tableHeading')}</h2>
  {#if !connection || !object || !ref}
    <p class="catalog-message">{t('partitions.noTable')}</p>
  {:else if caps.state === 'loading'}
    <p class="catalog-message" role="status">{t('partitions.capsLoading')}</p>
  {:else if caps.state === 'unsupported'}
    <CapabilityNotice title={t('partitions.unsupportedTitle')} reason={caps.message} />
  {:else if caps.state === 'failed'}
    <div class="feedback error-feedback" role="alert">
      <TriangleAlert size={18} />
      <p>{caps.message}</p>
    </div>
  {:else if !isBase}
    <CapabilityNotice title={t('partitions.viewTitle')} reason={t('partitions.viewReason')} />
  {:else if inspect?.support === 'unsupported'}
    <div data-testid="partitions-unsupported">
      <CapabilityNotice title={t('partitions.driverUnsupportedTitle')} reason={inspect.reason} />
    </div>
    <p class="note">{t('partitions.driverUnsupportedHint')}</p>
  {:else}
    <p class="note">{t('partitions.tableIntro', { table: JSON.stringify(object.name) })}</p>

    <div class="list" data-testid="partition-list">
      <div class="row">
        <strong>{t('partitions.listTitle')}</strong>
        <Button variant="outline" size="sm" disabled={listBusy} onclick={() => void loadList()}
          ><RefreshCw size={14} />{t('partitions.refresh')}</Button
        >
      </div>
      {#if listError}
        <div class="feedback error-feedback" role="alert">
          <TriangleAlert size={18} />
          <p>{listError}</p>
        </div>
      {:else if listBusy && !list}
        <p role="status">{t('partitions.listLoading')}</p>
      {:else if list}
        {#if list.method === ''}
          <p data-testid="not-partitioned">{t('partitions.notPartitioned')}</p>
        {:else}
          <p>
            {t('partitions.method')}: <code data-testid="list-method">{list.method}</code> ·
            {t('partitions.expression')}: <code>{list.expression}</code>
          </p>
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('partitions.colPartition')}</th>
                  <th>{t('partitions.colBound')}</th>
                  <th>{t('partitions.colRows')}</th>
                </tr>
              </thead>
              <tbody>
                {#each list.partitions as part, index (index)}
                  <tr>
                    <td>{tableLabel(part.table)}</td>
                    <td><code>{part.bound}</code></td>
                    <td>{cell(part.estimated_rows)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <p class="note">{t('partitions.rowsEstimate')}</p>
        {/if}
        {#each list.notes as note, index (index)}<p class="note">{note}</p>{/each}
      {/if}
    </div>

    <div class="field">
      <label for="{uid}-action">{t('partitions.actionLabel')}</label>
      <select id="{uid}-action" bind:value={action} data-testid="partition-action">
        {#each PARTITION_ACTIONS as item (item)}
          <option value={item}
            >{partitionTitle(item)}{driverCaps?.[item].support === 'unsupported'
              ? ` (${t('partitions.notSupportedShort')})`
              : ''}</option
          >
        {/each}
      </select>
    </div>

    {#if !supported}
      <div data-testid="action-unsupported">
        <CapabilityNotice
          title={t('partitions.unsupportedTitle')}
          reason={capability?.reason ?? ''}
        />
      </div>
    {:else}
      {#if capability?.support === 'limited'}
        <p class="note" data-testid="limited-note">
          <strong>{t('partitions.limited')}</strong>
          {capability.reason}
        </p>
      {/if}
      {#if action !== 'define' && list && !partitioned}
        <p class="note" data-testid="needs-partitioned">{t('partitions.needsPartitioned')}</p>
      {/if}
      {#key `${action}\u0000${objectKey}`}
        <StructureCard
          kind="partition"
          {action}
          title={partitionTitle(action)}
          testId={`partition-${action}`}
          {connection}
          {token}
          {onwritephase}
          scope={objectKey}
          onfinished={finished}
          valid={formValid}
          {fields}
        >
          {#snippet form(busy)}
            {#if action === 'define'}
              <div class="field">
                <label for="{uid}-method">{t('partitions.method')}</label>
                <select id="{uid}-method" bind:value={method} disabled={busy}>
                  {#each METHODS as item (item)}<option value={item}>{item}</option>{/each}
                </select>
              </div>
              <div class="field">
                <label for="{uid}-column">{t('partitions.column')}</label>
                <Input
                  id="{uid}-column"
                  bind:value={column}
                  disabled={busy}
                  autocomplete="off"
                  spellcheck={false}
                />
                <small>{t('partitions.columnHint')}</small>
              </div>
            {/if}
            {#if needsParts}
              <fieldset disabled={busy}>
                <legend>{t('partitions.selectPartitions')}</legend>
                {#if !list || list.partitions.length === 0}
                  <p class="note">{t('partitions.noPartitions')}</p>
                {/if}
                {#each list?.partitions ?? [] as part (valueOf(part))}
                  <label class="check"
                    ><input
                      type="checkbox"
                      checked={selected.includes(valueOf(part))}
                      onchange={() => toggle(valueOf(part))}
                    />{tableLabel(part.table)} <code>{part.bound}</code></label
                  >
                {/each}
              </fieldset>
            {/if}
            {#if needsDefs}
              <fieldset disabled={busy} data-testid="definitions">
                <legend
                  >{action === 'attach'
                    ? t('partitions.attachDefinition')
                    : t('partitions.definitions')}</legend
                >
                {#if action === 'attach'}<p class="note">{t('partitions.attachHint')}</p>{/if}
                {#if shape === null}
                  <p class="note">{t('partitions.noShape')}</p>
                {/if}
                {#each rows as row, index (index)}
                  <div class="def">
                    <div class="field">
                      <label for="{uid}-dn{index}"
                        >{t('partitions.defName', { n: index + 1 })}</label
                      >
                      <Input
                        id="{uid}-dn{index}"
                        bind:value={row.name}
                        autocomplete="off"
                        spellcheck={false}
                      />
                    </div>
                    {#if shape === 'less_than'}
                      <div class="field">
                        <label for="{uid}-dl{index}">{t('partitions.lessThan')}</label>
                        <Input id="{uid}-dl{index}" bind:value={row.lessThan} autocomplete="off" />
                      </div>
                    {:else if shape === 'from_to'}
                      <div class="field">
                        <label for="{uid}-df{index}">{t('partitions.from')}</label>
                        <Input id="{uid}-df{index}" bind:value={row.from} autocomplete="off" />
                      </div>
                      <div class="field">
                        <label for="{uid}-dt{index}">{t('partitions.to')}</label>
                        <Input id="{uid}-dt{index}" bind:value={row.to} autocomplete="off" />
                      </div>
                    {:else if shape === 'values'}
                      <div class="field">
                        <label for="{uid}-dv{index}">{t('partitions.values')}</label>
                        <textarea
                          id="{uid}-dv{index}"
                          rows="3"
                          bind:value={row.values}
                          spellcheck="false"></textarea>
                      </div>
                    {:else if shape === 'hash'}
                      <div class="field">
                        <label for="{uid}-dm{index}">{t('partitions.modulus')}</label>
                        <Input id="{uid}-dm{index}" bind:value={row.modulus} inputmode="numeric" />
                      </div>
                      <div class="field">
                        <label for="{uid}-dr{index}">{t('partitions.remainder')}</label>
                        <Input
                          id="{uid}-dr{index}"
                          bind:value={row.remainder}
                          inputmode="numeric"
                        />
                      </div>
                    {/if}
                    {#if rows.length > 1}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={t('partitions.removeDefinition', { n: index + 1 })}
                        onclick={() => (rows = rows.filter((_, i) => i !== index))}
                        ><Trash2 size={14} /></Button
                      >
                    {/if}
                  </div>
                {/each}
                {#if action !== 'attach' && rows.length < 100}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onclick={() => (rows = [...rows, newRow()])}
                    ><Plus size={14} />{t('partitions.addDefinition')}</Button
                  >
                {/if}
                <small>{t('partitions.boundHint')}</small>
              </fieldset>
            {/if}
            {#if needsCount}
              <div class="field">
                <label for="{uid}-count">{t('partitions.count')}</label>
                <Input id="{uid}-count" bind:value={count} inputmode="numeric" disabled={busy} />
              </div>
            {/if}
            {#if action === 'remove'}
              <p class="note">{t('partitions.removeHint')}</p>
            {/if}
          {/snippet}
        </StructureCard>
      {/key}
    {/if}
  {/if}
</section>

<style>
  .ops {
    display: grid;
    gap: 0.75rem;
    min-width: 0;
    padding: 1rem;
  }
  h2,
  p {
    margin: 0;
  }
  .note,
  small {
    color: var(--color-muted-foreground);
    font-size: 0.8125rem;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .list {
    display: grid;
    gap: 0.375rem;
    min-width: 0;
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
  select,
  textarea {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 0.375rem 0.5rem;
    background: var(--color-background);
    color: inherit;
    font: inherit;
    max-width: 100%;
    box-sizing: border-box;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.875rem;
    overflow-wrap: anywhere;
  }
  fieldset {
    display: grid;
    gap: 0.5rem;
    margin: 0;
    min-width: 0;
    padding: 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }
  .def {
    display: grid;
    gap: 0.375rem;
    padding: 0.5rem;
    border: 1px dashed var(--color-border);
    border-radius: var(--radius-md);
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
    overflow-wrap: anywhere;
  }
  code {
    overflow-wrap: anywhere;
  }
</style>
