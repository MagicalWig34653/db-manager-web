<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { TriangleAlert } from '@lucide/svelte';
  import { toConnection, apiDriver } from '$lib/api';
  import type { FeatureProps } from '$lib/features';
  import { t } from '$lib/i18n';
  import { tables, type TableDescription } from '$lib/tables';
  import { displayCell } from '$lib/workbench';
  import { getShellContext } from '$lib/shell/context';
  import CapabilityNotice from '$lib/components/shared/CapabilityNotice.svelte';
  import ConfirmDestructiveDialog from '$lib/components/shared/ConfirmDestructiveDialog.svelte';
  import ErrorPanel from '$lib/components/shared/ErrorPanel.svelte';
  import PlanPreview from '$lib/components/shared/PlanPreview.svelte';
  import { importClient } from './client';
  import { ImportOperation } from './operation.svelte';
  import ResultView from './ResultView.svelte';
  import {
    commonProblem,
    csvExecuteMetadata,
    csvProblem,
    defaultCommon,
    defaultCsv,
    fileProblem,
    firstRecord,
    formatBytes,
    issueKey,
    mapFromHeader,
    planMetadata,
    sqlExecuteMetadata,
    suggestCompression,
    type Capabilities,
    type CommonForm,
    type CsvForm,
    type Format,
  } from './model';

  let { connection, token, object, onwritephase }: FeatureProps = $props();
  const shell = getShellContext();
  const operation = new ImportOperation();
  const format = $derived<Format>(object ? 'csv' : 'sql');
  const ref = $derived(
    object ? { ...(object.schema ? { schema: object.schema } : {}), name: object.name } : null,
  );
  const targetLabel = $derived(ref ? `${ref.schema ? `${ref.schema}.` : ''}${ref.name}` : '');

  let caps = $state<Capabilities | null>(null);
  let capsError = $state('');
  let description = $state<TableDescription | null>(null);
  let file = $state<File | null>(null);
  let csv = $state<CsvForm>(defaultCsv());
  let common = $state<CommonForm>(defaultCommon('sql'));
  let headerFields = $state<string[]>([]);
  let confirmOpen = $state(false);
  let dragging = $state(false);
  let inputKey = $state(0);

  const driver = $derived(connection ? apiDriver(connection.driver) : null);
  const driverCaps = $derived(caps?.drivers.find((entry) => entry.driver === driver));
  const available = $derived(
    !!connection && !!caps?.available && !!caps.formats.includes(format) && !!driverCaps,
  );
  const mappable = $derived(
    description ? description.columns.filter((c) => c.generated === 'none').map((c) => c.name) : [],
  );
  const tableOk = $derived(
    format === 'sql' || (description?.kind === 'table' && description.transactional !== 'no'),
  );
  const busy = $derived(operation.busy);
  const locked = $derived(busy || !!shell?.session.writeInFlight);
  const editable = $derived(operation.phase === 'idle');
  const fileError = $derived(file ? fileProblem(file, caps?.max_file_bytes) : null);
  const optionError = $derived(
    commonProblem(common, format) ?? (format === 'csv' ? csvProblem(csv, mappable) : null),
  );
  const canStart = $derived(
    available && tableOk && !fileError && !!file && !optionError && !locked && editable,
  );
  const canPlan = $derived(
    available &&
      tableOk &&
      !fileError &&
      !!file &&
      !optionError &&
      !locked &&
      (editable ||
        (['planned', 'finished', 'unknown'].includes(operation.phase) && operation.consumed)),
  );
  const plan = $derived(operation.plan);
  const planBlocked = $derived(
    !!plan &&
      (plan.valid_rows === 0 ||
        (common.mode === 'stop' && (plan.errors.length > 0 || plan.valid_rows < plan.rows))),
  );
  const percent = $derived(
    operation.progress.total
      ? Math.min(100, Math.floor((operation.progress.loaded / operation.progress.total) * 100))
      : 0,
  );
  const jobPercent = $derived(
    operation.job?.progress.total
      ? Math.min(
          100,
          Math.floor((operation.job.progress.processed / operation.job.progress.total) * 100),
        )
      : 0,
  );

  $effect(() => {
    const current = connection;
    const secret = token;
    const target = ref;
    const kind = format;
    const probe = new AbortController();
    let active = true;
    untrack(() => {
      operation.reset();
      caps = null;
      capsError = '';
      description = null;
      file = null;
      inputKey++;
      csv = defaultCsv();
      common = defaultCommon(kind);
      headerFields = [];
      confirmOpen = false;
      if (!current) return;
      void (async () => {
        try {
          const loaded = await importClient.capabilities(secret, probe.signal);
          if (!active) return;
          caps = loaded;
          if (kind === 'csv' && target && loaded.available) {
            const described = await tables.describe(
              { connection: toConnection(current), table: target },
              secret,
              probe.signal,
            );
            if (!active) return;
            description = described;
            csv.columns = described.columns
              .filter((c) => c.generated === 'none')
              .map((c) => c.name);
          }
        } catch {
          if (active) capsError = t('importData.unavailable');
        }
      })();
    });
    return () => {
      active = false;
      probe.abort();
      operation.reset();
    };
  });

  async function peek() {
    headerFields = [];
    if (!file || format !== 'csv' || common.compression !== 'none') return;
    try {
      const bytes = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
      const text = new TextDecoder(csv.charset, { fatal: false }).decode(bytes);
      if (!oneChar(csv.separator) || !oneChar(csv.quote)) return;
      headerFields = firstRecord(text, csv.separator, csv.quote, csv.escape).slice(0, 1024);
    } catch {
      headerFields = [];
    }
  }
  const oneChar = (value: string) => [...value].length === 1;

  function choose(next: File | null) {
    operation.reset();
    file = next;
    headerFields = [];
    if (next) {
      common.compression = suggestCompression(next.name);
      void peek().then(() => {
        const mapped = csv.header ? mapFromHeader(headerFields, mappable) : null;
        if (mapped) csv.columns = mapped;
      });
    }
  }
  function useHeader() {
    const mapped = mapFromHeader(headerFields, mappable);
    if (mapped) csv.columns = mapped;
  }

  function startPlan() {
    if (!canPlan || !connection || !ref || !file || format !== 'csv') return;
    void operation.makePlan(planMetadata(connection, ref, csv, common), file, token);
  }
  function confirmed() {
    confirmOpen = false;
    if (!connection || !file || locked) return;
    if (format === 'csv') {
      const planned = operation.plannedRequest;
      if (!planned || !plan) return;
      void operation.execute(
        csvExecuteMetadata(planned, plan.plan_sha256),
        file,
        token,
        onwritephase,
      );
    } else if (canStart) {
      void operation.execute(sqlExecuteMetadata(connection, common), file, token, onwritephase);
    }
  }
</script>

<section class="import-panel" aria-label={t('importData.title')} data-testid="import-panel">
  <h2>{t('importData.title')}</h2>
  {#if !connection}
    <p>{t('server.noConnection')}</p>
  {:else}
    <p>
      {format === 'csv'
        ? t('importData.contextCsv', { name: targetLabel })
        : t('importData.contextSql', { database: connection.database })}
    </p>
    {#if capsError}
      <ErrorPanel message={capsError} />
    {:else if !caps}
      <p role="status">{t('importData.loading')}</p>
    {:else if !available}
      <CapabilityNotice
        title={t('importData.unsupported')}
        reason={t('importData.unsupportedReason')}
      />
    {/if}
    {#if driverCaps}<p data-testid="import-driver-reason">{driverCaps.reason}</p>{/if}
    {#if caps}<p>
        {t('importData.limits', {
          file: formatBytes(caps.max_file_bytes),
          rows: caps.max_rows,
          statements: caps.max_statements,
        })}
      </p>{/if}
    {#if format === 'sql'}
      <div class="danger" role="alert" data-testid="import-sql-warning">
        <strong><TriangleAlert size={16} />{t('importData.sqlWarningTitle')}</strong>
        <p>{t('importData.sqlWarning')}</p>
        <p>{t('importData.sqlClasses')}</p>
        <p>{t('importData.sqlRestrictions')}</p>
      </div>
    {:else}
      <p>{t('importData.csvIntro')}</p>
      {#if description && !tableOk}<p role="alert">{t('importData.tableNotSupported')}</p>{/if}
    {/if}

    <fieldset disabled={!available || !editable || locked || (format === 'csv' && !description)}>
      <legend>{t('importData.fileLegend')}</legend>
      <div
        class="drop"
        class:dragging
        role="group"
        aria-label={t('importData.dropLabel')}
        ondragover={(event) => {
          event.preventDefault();
          dragging = true;
        }}
        ondragleave={() => (dragging = false)}
        ondrop={(event) => {
          event.preventDefault();
          dragging = false;
          const dropped = event.dataTransfer?.files?.[0];
          if (dropped && editable && !locked) choose(dropped);
        }}
      >
        <p>{t('importData.dropHint')}</p>
        {#key inputKey}
          <label
            >{t('importData.file')}<input
              type="file"
              data-testid="import-file"
              onchange={(event) => choose(event.currentTarget.files?.[0] ?? null)}
            /></label
          >
        {/key}
      </div>
      {#if file}
        <p data-testid="import-file-info">
          {t('importData.fileInfo', { name: file.name, size: formatBytes(file.size) })}
        </p>
        {#if fileError}<p role="alert">{t(fileError)}</p>{/if}
      {/if}
      <label
        >{t('importData.compression')}<select bind:value={common.compression} onchange={peek}>
          <option value="none">{t('importData.compressionNone')}</option>
          {#if !caps || caps.compression.includes('gzip')}<option value="gzip"
              >{t('importData.compressionGzip')}</option
            >{/if}
        </select></label
      >
      <p class="hint">{t('importData.compressionHint')}</p>
    </fieldset>

    {#if format === 'csv'}
      <fieldset disabled={!available || !editable || locked || !description}>
        <legend>{t('importData.csvLegend')}</legend>
        <label
          >{t('importData.separator')}<input
            bind:value={csv.separator}
            maxlength="2"
            autocomplete="off"
            onchange={peek}
            data-testid="csv-separator"
          /></label
        >
        <label
          >{t('importData.quote')}<input
            bind:value={csv.quote}
            maxlength="2"
            autocomplete="off"
            onchange={peek}
            data-testid="csv-quote"
          /></label
        >
        <label
          >{t('importData.escape')}<select bind:value={csv.escape} onchange={peek}>
            <option value="double">{t('importData.escapeDouble')}</option>
            <option value="backslash">{t('importData.escapeBackslash')}</option>
          </select></label
        >
        <label
          >{t('importData.charset')}<select bind:value={csv.charset} onchange={peek}>
            {#each caps?.charsets ?? ['utf-8'] as option (option)}<option value={option}
                >{option}</option
              >{/each}
          </select></label
        >
        <p class="hint">{t('importData.bomHint')}</p>
        <label class="check"
          ><input type="checkbox" bind:checked={csv.header} />{t('importData.header')}</label
        >
        <label class="check"
          ><input type="checkbox" bind:checked={csv.useNull} />{t('importData.useNull')}</label
        >
        {#if csv.useNull}
          <label
            >{t('importData.nullText')}<input
              bind:value={csv.nullText}
              autocomplete="off"
              data-testid="csv-null"
            /></label
          >
          <p class="hint">{t('importData.nullHint')}</p>
        {/if}
        <label
          >{t('importData.modeLabel')}<select bind:value={common.mode} data-testid="import-mode">
            <option value="stop">{t('importData.modeStop')}</option>
            <option value="skip">{t('importData.modeSkip')}</option>
          </select></label
        >
      </fieldset>

      <fieldset disabled={!available || !editable || locked || !description}>
        <legend>{t('importData.mappingLegend')}</legend>
        <p class="hint">{t('importData.mappingHint')}</p>
        {#if headerFields.length}
          <p data-testid="csv-header-peek">
            {t('importData.peek', { count: headerFields.length })}
            {#each headerFields as name, i (i)}<code>{name}</code>{' '}{/each}
          </p>
          <button
            type="button"
            onclick={useHeader}
            disabled={!mapFromHeader(headerFields, mappable)}>{t('importData.useHeader')}</button
          >
        {/if}
        {#each csv.columns as _, i (i)}
          <div class="map-row">
            <label
              >{t('importData.fieldN', { n: i + 1 })}<select bind:value={csv.columns[i]}>
                {#each mappable as name (name)}<option value={name}>{name}</option>{/each}
              </select></label
            >
            <button
              type="button"
              aria-label={t('importData.removeField', { n: i + 1 })}
              onclick={() => (csv.columns = csv.columns.filter((__, index) => index !== i))}
              >{t('importData.remove')}</button
            >
          </div>
        {/each}
        <div class="buttons">
          <button
            type="button"
            disabled={csv.columns.length >= mappable.length}
            onclick={() => {
              const next = mappable.find((name) => !csv.columns.includes(name));
              if (next) csv.columns = [...csv.columns, next];
            }}>{t('importData.addField')}</button
          >
          <button type="button" onclick={() => (csv.columns = [...mappable])}
            >{t('importData.allColumns')}</button
          >
        </div>
      </fieldset>
    {:else}
      <fieldset disabled={!available || !editable || locked}>
        <legend>{t('importData.sqlLegend')}</legend>
        <label
          >{t('importData.modeLabel')}<select bind:value={common.mode} data-testid="import-mode">
            <option value="stop">{t('importData.sqlStop')}</option>
            <option value="continue">{t('importData.sqlContinue')}</option>
          </select></label
        >
        <label
          >{t('importData.delimiter')}<input
            bind:value={common.delimiter}
            maxlength="16"
            autocomplete="off"
          /></label
        >
      </fieldset>
    {/if}

    <fieldset disabled={!available || !editable || locked}>
      <legend>{t('importData.limitsLegend')}</legend>
      <label
        >{t('importData.maxRows')}<input
          type="number"
          min="1"
          max={format === 'csv' ? 100000 : 10000}
          step="1"
          bind:value={common.maxRows}
        /></label
      >
      <label
        >{t('importData.timeout')}<input
          type="number"
          min="1"
          max="300000"
          step="1"
          bind:value={common.timeoutMs}
        /></label
      >
    </fieldset>
    {#if optionError && file}<p role="alert" data-testid="import-option-error">
        {t(optionError)}
      </p>{/if}

    <div class="buttons">
      {#if format === 'csv'}
        <button type="button" onclick={startPlan} disabled={!canPlan} data-testid="import-plan"
          >{t(operation.consumed ? 'importData.newPlan' : 'importData.makePlan')}</button
        >
      {:else}
        <button
          type="button"
          onclick={() => (confirmOpen = true)}
          disabled={!canStart}
          data-testid="import-sql-start">{t('importData.runSql')}</button
        >
      {/if}
      {#if busy}
        <button type="button" onclick={() => operation.cancel(token)} data-testid="import-cancel"
          >{t(
            operation.phase === 'running'
              ? 'importData.cancelJob'
              : operation.phase === 'starting'
                ? 'importData.stopWaiting'
                : 'importData.cancelUpload',
          )}</button
        >
      {/if}
    </div>

    <div aria-live="polite">
      {#if operation.phase === 'planning' || operation.phase === 'uploading'}
        <p role="status" data-testid="import-upload">
          {t(operation.phase === 'planning' ? 'importData.planning' : 'importData.uploading', {
            percent,
          })}
        </p>
        <progress max="100" value={percent} aria-label={t('importData.uploadProgress')}></progress>
      {:else if operation.phase === 'starting'}
        <p role="status">{t('importData.starting')}</p>
      {:else if operation.phase === 'running'}
        <p role="status" data-testid="import-running">
          {t('importData.running', {
            processed: operation.job?.progress.processed ?? 0,
            total: operation.job?.progress.total ?? 0,
          })}
          {#if operation.cancelRequested}{t('importData.cancelRequested')}{/if}
        </p>
        <progress max="100" value={jobPercent} aria-label={t('importData.jobProgress')}></progress>
      {/if}
      {#if operation.notice}<p role="status">{operation.notice}</p>{/if}
      {#if operation.error}<p role="alert" data-testid="import-error">{operation.error}</p>{/if}
    </div>

    {#if plan && format === 'csv'}
      <section class="plan" data-testid="import-plan-view" aria-label={t('importData.planTitle')}>
        <h3>{t('importData.planTitle')}</h3>
        <p>
          {t('importData.planCounts', {
            rows: plan.rows,
            valid: plan.valid_rows,
            errors: plan.errors.length,
          })}
        </p>
        <PlanPreview
          statements={plan.statements}
          warnings={plan.warnings}
          planSha256={plan.plan_sha256}
        />
        {#if plan.preview.length}
          <h4>{t('importData.previewTitle', { count: plan.preview.length })}</h4>
          <!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable table needs a keyboard focus target.) -->
          <div
            class="scroll"
            role="region"
            tabindex="0"
            aria-label={t('importData.previewTitle', { count: plan.preview.length })}
          >
            <table data-testid="import-preview">
              <thead
                ><tr
                  >{#each csv.columns as name, i (i)}<th scope="col">{name}</th>{/each}</tr
                ></thead
              >
              <tbody>
                {#each plan.preview as row, r (r)}<tr
                    >{#each row as cell, c (c)}<td title={cell.kind}
                        >{displayCell(cell) === '' ? '""' : displayCell(cell)}</td
                      >{/each}</tr
                  >{/each}
              </tbody>
            </table>
          </div>
        {/if}
        {#if plan.errors.length}
          <h4>{t('importData.issuesTitle')}</h4>
          <ul data-testid="import-plan-issues">
            {#each plan.errors as issue, i (i)}<li>
                {t('importData.issueLine', {
                  row: issue.row,
                  column: issue.column,
                  text: t(issueKey(issue.code)),
                })} (<code>{issue.code}</code>)
              </li>{/each}
          </ul>
          {#if plan.errors_truncated}<p>{t('importData.issuesTruncated')}</p>{/if}
        {/if}
        {#if operation.consumed}
          <p class="danger" role="status" data-testid="import-plan-consumed">
            {t('importData.planConsumed')}
          </p>
        {:else if operation.phase === 'planned'}
          {#if planBlocked}<p role="alert" data-testid="import-plan-blocked">
              {t(plan.valid_rows === 0 ? 'importData.planNoValidRows' : 'importData.planHasErrors')}
            </p>{/if}
          <div class="buttons">
            <button
              type="button"
              disabled={planBlocked || locked}
              onclick={() => (confirmOpen = true)}
              data-testid="import-csv-start">{t('importData.runCsv')}</button
            >
            <button type="button" onclick={() => operation.reset()} disabled={locked}
              >{t('importData.discardPlan')}</button
            >
          </div>
        {/if}
      </section>
    {/if}

    {#if operation.result}
      <ResultView result={operation.result} {format} />
    {/if}
    {#if operation.phase === 'finished' || operation.phase === 'unknown'}
      <button
        type="button"
        onclick={() => operation.reset()}
        disabled={locked}
        data-testid="import-new">{t('importData.newImport')}</button
      >
    {/if}
  {/if}
</section>

<ConfirmDestructiveDialog
  bind:open={confirmOpen}
  title={t(format === 'csv' ? 'importData.confirmCsvTitle' : 'importData.confirmSqlTitle')}
  description={format === 'csv'
    ? t('importData.confirmCsvText', { rows: plan?.valid_rows ?? 0, name: targetLabel })
    : t('importData.confirmSqlText', { name: file?.name ?? '' })}
  targetName={format === 'csv' ? targetLabel : (file?.name ?? '')}
  confirmLabel={t(format === 'csv' ? 'importData.confirmCsvButton' : 'importData.confirmSqlButton')}
  busy={locked}
  onconfirm={confirmed}
/>

<style>
  .import-panel {
    padding: 16px;
    min-width: 0;
    font-size: 13px;
    overflow-wrap: anywhere;
    display: grid;
    gap: 12px;
  }
  .import-panel > *,
  fieldset > *,
  .drop,
  label {
    min-width: 0;
  }
  input:not([type='checkbox']),
  select {
    width: 100%;
    box-sizing: border-box;
  }
  fieldset {
    display: grid;
    gap: 8px;
    min-width: 0;
    border: 1px solid var(--border);
    padding: 12px;
    margin: 0;
  }
  label {
    display: grid;
    gap: 4px;
  }
  label.check {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  input,
  select,
  button {
    font: inherit;
    max-width: 100%;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 6px;
    background: var(--surface);
    color: inherit;
  }
  input[type='checkbox'] {
    padding: 0;
  }
  button {
    cursor: pointer;
    justify-self: start;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  progress {
    width: 100%;
    max-width: 480px;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .map-row {
    display: flex;
    gap: 8px;
    align-items: end;
    flex-wrap: wrap;
  }
  .drop {
    border: 1px dashed var(--border);
    border-radius: 6px;
    padding: 12px;
    display: grid;
    gap: 6px;
  }
  .drop.dragging {
    background: var(--muted);
  }
  .hint {
    color: var(--muted-foreground);
    margin: 0;
  }
  .danger {
    border: 1px solid var(--destructive);
    border-radius: 6px;
    padding: 8px 12px;
    color: var(--destructive);
  }
  .danger p {
    margin: 4px 0;
  }
  .plan {
    display: grid;
    gap: 8px;
    min-width: 0;
  }
  .scroll {
    max-width: 100%;
    max-height: 360px;
    overflow: auto;
  }
  table {
    border-collapse: collapse;
  }
  th,
  td {
    text-align: start;
    border: 1px solid var(--border);
    padding: 4px 6px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-width: 24rem;
  }
</style>
