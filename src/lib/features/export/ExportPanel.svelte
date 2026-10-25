<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { Download, Square } from '@lucide/svelte';
  import { toConnection } from '$lib/api';
  import CapabilityNotice from '$lib/components/shared/CapabilityNotice.svelte';
  import ErrorPanel from '$lib/components/shared/ErrorPanel.svelte';
  import { Button } from '$lib/components/ui/button';
  import type { FeatureProps } from '$lib/features';
  import { t } from '$lib/i18n';
  import { getShellContext } from '$lib/shell/context';
  import { loadCapabilities } from './caps';
  import {
    buildRequest,
    defaultForm,
    formatLabel,
    notices,
    previewRows,
    scopeLabel,
    type ExportForm,
    type Scope,
  } from './options';
  import {
    defaultFilename,
    ExportError,
    runExport,
    type ExportCapabilities,
    type ExportOutcome,
  } from './run';
  import { openSink, supportsFileSystemAccess } from './sinks';
  import type { ExportFormat } from './verify';

  let { connection, token, object }: FeatureProps = $props();
  const shell = getShellContext();
  const uid = $props.id();

  const form = $state<ExportForm>(defaultForm());
  let caps = $state<ExportCapabilities | null>(null);
  let capsError = $state('');
  let starting = $state(false);
  let phase = $state<'idle' | 'running' | 'done' | 'failed' | 'canceled'>('idle');
  let progress = $state(0);
  let failure = $state<ExportError | null>(null);
  let outcome = $state<ExportOutcome | null>(null);
  let controller: AbortController | null = null;
  let generation = 0;
  let lastPaint = 0;

  const streamsToDisk = supportsFileSystemAccess();
  const catalogTables = $derived((shell?.session.objects ?? []).filter((o) => o.type === 'table'));
  const driverCaps = $derived(
    connection && caps
      ? caps.drivers.find(
          (d) => d.driver === (connection.driver === 'postgresql' ? 'postgres' : connection.driver),
        )
      : undefined,
  );
  const built = $derived(
    connection
      ? buildRequest(form, {
          connection: toConnection(connection),
          streamsToDisk,
          catalogTables: catalogTables.length,
        })
      : { request: null, problems: [] },
  );
  const running = $derived(phase === 'running');
  const formats = $derived<ExportFormat[]>(
    (caps?.formats ?? ['sql', 'csv', 'excel-csv', 'json']).filter((f) =>
      form.scope === 'query' ? f !== 'sql' : true,
    ) as ExportFormat[],
  );

  const keyOf = (o: { schema?: string; name: string }) => `${o.schema ?? ''}\u0000${o.name}`;
  const selected = $derived(new Set(form.tables.map(keyOf)));
  function toggle(o: { schema?: string; name: string }) {
    const key = keyOf(o);
    form.tables = selected.has(key)
      ? form.tables.filter((x) => keyOf(x) !== key)
      : [...form.tables, { ...(o.schema ? { schema: o.schema } : {}), name: o.name }];
  }

  function discard() {
    generation++;
    controller?.abort();
    controller = null;
    phase = 'idle';
    failure = null;
    outcome = null;
    progress = 0;
  }

  // New connection or token: abort a running export and drop all state of the old one.
  $effect(() => {
    const current = connection;
    const secret = token;
    const selectedObject = object;
    untrack(() => {
      discard();
      caps = null;
      capsError = '';
      form.tables =
        selectedObject && selectedObject.type === 'table'
          ? [
              {
                ...(selectedObject.schema ? { schema: selectedObject.schema } : {}),
                name: selectedObject.name,
              },
            ]
          : [];
      if (selectedObject) form.scope = 'tables';
      if (!current) return;
      const mine = generation;
      const probe = new AbortController();
      void loadCapabilities(secret, probe.signal)
        .then((data) => {
          if (mine === generation) caps = data;
        })
        .catch((cause: unknown) => {
          if (mine === generation && !probe.signal.aborted)
            capsError = cause instanceof Error ? cause.message : t('exportDump.err.noV11');
        });
      onDestroyProbe = probe;
    });
    return () => {
      generation++;
      onDestroyProbe?.abort();
      controller?.abort();
    };
  });
  let onDestroyProbe: AbortController | null = null;

  async function start() {
    const request = built.request;
    if (!request || running || starting) return;
    starting = true;
    const mine = ++generation;
    failure = null;
    outcome = null;
    progress = 0;
    // The save dialog needs the click's user gesture, so it opens before the request.
    const sink = await openSink(
      defaultFilename(request),
      request.gzip ? 'application/gzip' : 'application/octet-stream',
    );
    if (!sink || mine !== generation) {
      starting = false;
      if (sink) await sink.abort();
      return;
    }
    starting = false;
    controller = new AbortController();
    phase = 'running';
    try {
      const result = await runExport({
        request,
        token,
        signal: controller.signal,
        sink,
        onProgress(bytes) {
          const now = Date.now();
          if (mine === generation && now - lastPaint > 100) {
            lastPaint = now;
            progress = bytes;
          }
        },
      });
      if (mine !== generation) return;
      progress = result.rawBytes;
      outcome = result;
      phase = 'done';
    } catch (cause) {
      if (mine !== generation) return;
      failure =
        cause instanceof ExportError
          ? cause
          : new ExportError('network', 'network_error', t('exportDump.err.network'));
      phase = failure.kind === 'canceled' ? 'canceled' : 'failed';
    }
  }
  const failureText = (error: ExportError) =>
    error.code === 'invalid_export' && form.scope === 'query'
      ? t('exportDump.err.queryRejected')
      : error.message;
  const cancel = () => controller?.abort();
  const mib = (bytes: number) =>
    (bytes / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 });
  const size = (bytes: number) =>
    bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KiB` : `${mib(bytes)} MiB`;
  const scopes: Scope[] = ['tables', 'database', 'query', 'server'];
</script>

<section class="export-panel" aria-label={t('exportDump.title')} data-testid="export-panel">
  <div class="panel-heading">
    <div class="query-tab"><Download size={17} /><strong>{t('exportDump.title')}</strong></div>
  </div>
  {#if !connection}
    <p class="catalog-message">{t('server.noConnection')}</p>
  {:else}
    {#if capsError}
      <CapabilityNotice title={t('exportDump.unavailable')} reason={capsError} />
    {:else if caps && !caps.available}
      <CapabilityNotice
        title={t('exportDump.unavailable')}
        reason={t('exportDump.err.unavailable')}
      />
    {/if}
    {#if driverCaps}
      <p class="catalog-message" data-testid="driver-reason">{driverCaps.reason}</p>
    {/if}

    <form
      class="export-form"
      onsubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      <fieldset disabled={running}>
        <legend>{t('exportDump.scopeLegend')}</legend>
        {#each scopes as scope (scope)}
          <label
            ><input
              type="radio"
              name="{uid}-scope"
              value={scope}
              bind:group={form.scope}
              onchange={() => {
                if (scope === 'query' && form.format === 'sql') form.format = 'json';
              }}
            />{scopeLabel(scope)}</label
          >
        {/each}
      </fieldset>

      {#if form.scope === 'tables'}
        <fieldset disabled={running}>
          <legend>{t('exportDump.tablesLegend')}</legend>
          {#if catalogTables.length === 0}
            <p class="hint">{t('exportDump.noCatalog')}</p>
          {/if}
          <div class="table-pick">
            {#each catalogTables as table (keyOf(table))}
              <label
                ><input
                  type="checkbox"
                  checked={selected.has(keyOf(table))}
                  onchange={() => toggle(table)}
                />{table.schema ? `${table.schema}.` : ''}{table.name}</label
              >
            {/each}
          </div>
        </fieldset>
      {:else if form.scope === 'database'}
        <p class="hint">
          {t('exportDump.databaseHint', { n: catalogTables.length, database: connection.database })}
        </p>
      {:else if form.scope === 'server'}
        <label class="stack"
          >{t('exportDump.databasesLabel')}
          <textarea rows="3" bind:value={form.databases} disabled={running} data-testid="databases"
          ></textarea>
        </label>
        <p class="hint">{t('exportDump.serverHint')}</p>
      {:else}
        <label class="stack"
          >{t('exportDump.sqlLabel')}
          <textarea
            rows="5"
            bind:value={form.sql}
            disabled={running}
            spellcheck="false"
            data-testid="query-sql"></textarea>
        </label>
      {/if}

      <fieldset disabled={running}>
        <legend>{t('exportDump.formatLegend')}</legend>
        {#each formats as format (format)}
          <label
            ><input
              type="radio"
              name="{uid}-format"
              value={format}
              bind:group={form.format}
            />{formatLabel(format)}</label
          >
        {/each}
      </fieldset>

      {#if form.format === 'sql'}
        <fieldset disabled={running}>
          <legend>{t('exportDump.sqlLegend')}</legend>
          <label
            ><input type="checkbox" bind:checked={form.structure} />{t(
              'exportDump.structure',
            )}</label
          >
          <label><input type="checkbox" bind:checked={form.data} />{t('exportDump.data')}</label>
          <label><input type="checkbox" bind:checked={form.drop} />{t('exportDump.optDrop')}</label>
          <label><input type="checkbox" bind:checked={form.ifNotExists} />IF NOT EXISTS</label>
          <label
            ><input type="checkbox" bind:checked={form.extended} />{t('exportDump.extended')}</label
          >
          <label
            ><input type="checkbox" bind:checked={form.transaction} />{t(
              'exportDump.transaction',
            )}</label
          >
          <label
            ><input
              type="checkbox"
              bind:checked={form.disableFk}
              disabled={connection.driver === 'postgresql'}
            />{t('exportDump.disableFk')}</label
          >
          <label class="stack"
            >{t('exportDump.statementKiB')}<input
              class="num"
              inputmode="numeric"
              bind:value={form.statementKiB}
              placeholder="1024"
            /></label
          >
        </fieldset>
      {:else if form.format !== 'json'}
        <fieldset disabled={running}>
          <legend>{t('exportDump.csvLegend')}</legend>
          <label class="stack"
            >{t('exportDump.delimiter')}
            <select bind:value={form.delimiter}>
              <option value="">{t('exportDump.serverDefault')}</option>
              <option value=",">{t('exportDump.comma')}</option>
              <option value=";">{t('exportDump.semicolon')}</option>
              <option value={'\t'}>{t('exportDump.tabChar')}</option>
            </select>
          </label>
          <label><input type="checkbox" bind:checked={form.crlf} />{t('exportDump.crlf')}</label>
        </fieldset>
      {/if}

      <fieldset disabled={running}>
        <legend>{t('exportDump.fileLegend')}</legend>
        <label class="stack"
          >{t('exportDump.charset')}
          <select bind:value={form.charset}
            ><option value="utf-8">UTF-8</option><option value="utf-8-bom">UTF-8 (BOM)</option
            ></select
          >
        </label>
        <label><input type="checkbox" bind:checked={form.gzip} />{t('exportDump.gzip')}</label>
        <label class="stack"
          >{t('exportDump.filename')}<input
            bind:value={form.filename}
            placeholder="export"
            autocomplete="off"
            data-testid="filename"
          /></label
        >
      </fieldset>

      <fieldset disabled={running}>
        <legend>{t('exportDump.limitsLegend')}</legend>
        <label class="stack"
          >{t('exportDump.maxRows')}<input
            class="num"
            inputmode="numeric"
            bind:value={form.maxRows}
            placeholder="1000000"
            data-testid="max-rows"
          /></label
        >
        <label class="stack"
          >{t('exportDump.maxMiB')}<input
            class="num"
            inputmode="numeric"
            bind:value={form.maxMiB}
            placeholder="64"
            data-testid="max-mib"
          /></label
        >
        <label class="stack"
          >{t('exportDump.timeoutS')}<input
            class="num"
            inputmode="numeric"
            bind:value={form.timeoutS}
            placeholder="60"
            data-testid="timeout"
          /></label
        >
      </fieldset>

      {#if !streamsToDisk}<p class="hint" data-testid="memory-hint">
          {t('exportDump.memoryHint')}
        </p>{/if}
      {#if built.problems.length}
        <ul class="problems" role="alert" data-testid="problems">
          {#each built.problems as problem, i (i)}<li>{problem}</li>{/each}
        </ul>
      {/if}
      {#if built.request}
        <div class="preview" data-testid="preview">
          <h3>{t('exportDump.previewTitle')}</h3>
          <dl>
            {#each previewRows(built.request, streamsToDisk) as row, i (i)}
              <div>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            {/each}
          </dl>
          {#each notices(built.request, connection.driver === 'postgresql' ? 'postgres' : connection.driver) as note, i (i)}
            <p class="hint">{note}</p>
          {/each}
        </div>
      {/if}

      <div class="actions">
        {#if running}
          <Button type="button" variant="outline" onclick={cancel} data-testid="cancel"
            ><Square size={14} />{t('exportDump.cancel')}</Button
          >
        {:else}
          <Button
            type="submit"
            disabled={starting ||
              !built.request ||
              (caps !== null && !caps.available) ||
              !!capsError}
            data-testid="start"><Download size={14} />{t('exportDump.start')}</Button
          >
        {/if}
      </div>
    </form>

    <div aria-live="polite" class="result" data-testid="export-status" data-phase={phase}>
      {#if phase === 'running'}
        <p role="status">{t('exportDump.running', { size: size(progress) })}</p>
      {:else if phase === 'done' && outcome}
        <p role="status" class="ok" data-testid="export-done">
          {t('exportDump.done', { name: outcome.filename, size: size(outcome.rawBytes) })}
        </p>
        <p class="hint">{t('exportDump.verified')}</p>
      {:else if phase === 'canceled'}
        <p role="status" data-testid="export-canceled">{t('exportDump.canceled')}</p>
      {:else if phase === 'failed' && failure}
        {#if failure.kind === 'incomplete'}
          <ErrorPanel title={t('exportDump.incompleteTitle')} message={failure.message} />
          <p class="hint" data-testid="incomplete-hint">{t('exportDump.incompleteCauses')}</p>
        {:else}
          <ErrorPanel title={t('exportDump.failedTitle')} message={failureText(failure)} />
        {/if}
      {/if}
    </div>
  {/if}
</section>

<style>
  .export-panel {
    padding: 0 0 16px;
    font-size: 12px;
  }
  .export-form {
    display: grid;
    gap: 12px;
    padding: 12px 16px;
    max-width: 760px;
  }
  fieldset {
    border: 1px solid #d9e2ee;
    border-radius: 6px;
    padding: 8px 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    min-width: 0;
  }
  legend {
    font-weight: 600;
    padding: 0 4px;
  }
  label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  label.stack {
    display: grid;
    gap: 4px;
  }
  textarea,
  select,
  input:not([type='checkbox']):not([type='radio']) {
    border: 1px solid #d9e2ee;
    border-radius: 6px;
    padding: 6px 8px;
    background: white;
    max-width: 100%;
    box-sizing: border-box;
    font: inherit;
  }
  textarea {
    width: 100%;
  }
  .num {
    width: 9em;
  }
  .table-pick {
    display: grid;
    gap: 4px;
    max-height: 220px;
    overflow: auto;
    width: 100%;
  }
  .hint {
    color: #62738f;
    margin: 4px 0;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .problems {
    color: #ad3548;
    margin: 0;
    padding-left: 18px;
  }
  .preview {
    border: 1px solid #e5ebf3;
    border-radius: 6px;
    padding: 8px 12px;
    background: #f9fbfe;
  }
  .preview h3 {
    margin: 0 0 6px;
    font-size: 12px;
  }
  .preview dl {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 6px 16px;
    margin: 0;
  }
  .preview dt {
    color: #91a0b7;
  }
  .preview dd {
    margin: 2px 0 0;
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .result {
    padding: 0 16px;
  }
  .ok {
    color: #1f7a4d;
  }
</style>
