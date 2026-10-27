<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import SqlEditor from '$lib/features/sql-editor/SqlEditor.svelte';
  import SqlLibraryPanel from '$lib/features/sql-editor/SqlLibraryPanel.svelte';
  import VariablesDialog from '$lib/features/sql-editor/VariablesDialog.svelte';
  import { t, formatNumber } from '$lib/i18n';
  import {
    Check,
    CheckCheck,
    Clock3,
    Code2,
    FileCode2,
    LoaderCircle,
    Play,
    Square,
    Table2,
    TriangleAlert,
    Search,
    WandSparkles,
  } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import ResultTable from '$lib/components/ResultTable.svelte';
  import { getShellContext } from '../context';

  const { session, sql } = getShellContext();
  let editor = $state<SqlEditor>();
  let note = $state('');

  onMount(() => {
    sql.focus = () => editor?.focus();
    return () => {
      sql.focus = () => {};
    };
  });
  function format() {
    note = editor?.format() ? t('sqlEditor.formatted') : t('sqlEditor.formatRefused');
  }
  function find() {
    if (!editor?.find()) note = t('sqlEditor.findLoading');
  }
</script>

<section class="editor-panel" aria-label={t('sql.queryLabel')}>
  <div class="panel-heading">
    <div class="query-tab">
      <FileCode2 size={17} /><strong>{t('sql.queryTab')}</strong><Badge variant="secondary"
        >SQL</Badge
      >
    </div>
    <span class="editor-hint"><span>{t('shortcuts.focusEditor')}</span><kbd>⌘ / Strg K</kbd></span>
  </div>
  <SqlEditor
    bind:this={editor}
    bind:value={sql.sql}
    connection={session.connection}
    objects={session.objects}
    readOnly={sql.running || sql.hiddenPending !== null}
  />
  <div class="editor-toolbar">
    <div class="execution-actions">
      <Button
        class="run-button"
        aria-label={t('sql.runLabel')}
        aria-keyshortcuts="Control+Enter Meta+Enter"
        onclick={() => void sql.execute(session)}
        disabled={!session.connection || !sql.sql.trim() || sql.running || session.connectionBusy}
        >{#if sql.running}<LoaderCircle class="animate-spin" />{t('sql.running')}{:else}<Play
            size={15}
            fill="currentColor"
          />{t('sql.run')}{/if}<kbd>⌘ ↵</kbd></Button
      >{#if sql.running}<Button variant="outline" onclick={() => sql.cancel()}
          ><Square size={13} />{t('shared.cancel')}</Button
        >{/if}
      <span class="editor-extra-actions">
        <Button variant="outline" onclick={format} disabled={sql.running || !sql.sql.trim()}
          ><WandSparkles size={14} />{t('sqlEditor.format')}</Button
        >
        <Button variant="outline" onclick={find} disabled={sql.running}
          ><Search size={14} />{t('sqlEditor.find')}</Button
        >
      </span>
    </div>
    <div class="execution-options">
      <label for="row-limit">{t('sql.rowLimit')}</label><select
        id="row-limit"
        bind:value={sql.rowLimit}
        disabled={sql.running}
        ><option value={100}>100</option><option value={500}>500</option><option value={1000}
          >1.000</option
        ></select
      ><span class="toolbar-divider"></span><Clock3 size={14} /><select
        aria-label={t('sql.timeLimit')}
        bind:value={sql.timeoutMs}
        disabled={sql.running}
        ><option value={10000}>{t('sql.seconds10')}</option><option value={30000}
          >{t('sql.seconds30')}</option
        ><option value={60000}>{t('sql.seconds60')}</option></select
      >
    </div>
  </div>
  {#if sql.hiddenPending !== null}<div class="feedback warning-feedback" role="alert">
      <TriangleAlert size={18} />
      <div>
        <strong>{t('sqlEditor.hiddenTitle')}</strong>
        <p>{t('sqlEditor.hiddenText')}</p>
        <Button variant="outline" onclick={() => void sql.runHiddenConfirmed(session)}
          >{t('sqlEditor.hiddenRun')}</Button
        ><Button variant="ghost" onclick={() => sql.cancelPrompt()}>{t('shared.cancel')}</Button>
      </div>
    </div>{/if}
  {#if note}<p class="editor-note" role="status">{note}</p>{/if}
</section>
<section class="results-panel" aria-label={t('sql.resultsLabel')} aria-busy={sql.running}>
  <div class="panel-heading">
    <div class="result-title">
      <Table2 size={17} /><strong>{t('sql.results')}</strong>{#if sql.currentResult}<Badge
          variant="secondary"
          >{sql.currentResult.rows.length}
          {sql.currentResult.rows.length === 1 ? t('sql.rowOne') : t('sql.rowMany')}</Badge
        >{/if}
    </div>
    {#if sql.execution}<span class="execution-time"
        ><CheckCheck size={15} />{formatNumber(sql.execution.elapsedMs)} ms</span
      >{/if}
  </div>
  {#if sql.error}<div class="feedback error-feedback" role="alert">
      <TriangleAlert size={21} />
      <div>
        <strong>{t('sql.failed')}</strong>
        <p>{sql.error}</p>
      </div>
    </div>
  {:else if sql.cancelled}<div class="feedback warning-feedback" role="status">
      <Square size={18} />
      <div>
        <strong>{t('sql.cancelRequested')}</strong>
        <p>
          {t('sql.cancelHint')}
        </p>
      </div>
    </div>
  {:else if sql.running}<div class="results-empty" role="status">
      <div class="empty-icon running-icon">
        <LoaderCircle size={25} class="animate-spin" />
      </div>
      <h2>{t('sql.runningTitle')}</h2>
      <p>{t('sql.runningHint')}</p>
    </div>
  {:else if sql.execution}
    {#if sql.execution.results.length > 1}<div
        class="result-tabs"
        role="tablist"
        aria-label={t('sql.resultSets')}
      >
        {#each sql.execution.results as result, index}<button
            role="tab"
            aria-selected={sql.activeResult === index}
            onclick={() => (sql.activeResult = index)}
            >{t('sql.resultTab', { n: index + 1 })}<span>{result.rows.length}</span></button
          >{/each}
      </div>{/if}
    {#if sql.currentResult}<ResultTable
        result={sql.currentResult}
        exportScope={{ kind: 'sql_result' }}
      />{#if sql.currentResult.truncated}<div class="limit-note" role="status">
          <TriangleAlert size={16} /><span
            >{t('sql.truncated', { limit: formatNumber(sql.rowLimit) })}</span
          >
        </div>{/if}{:else}<div class="feedback">
        <Check size={20} />{t('sql.noResultSet')}
      </div>{/if}
    {#each sql.execution.warnings as warning}<div class="limit-note" role="status">
        <TriangleAlert size={16} />{warning}
      </div>{/each}
  {:else}<div class="results-empty">
      <div class="empty-icon"><Code2 size={27} strokeWidth={1.4} /></div>
      <h2>{t('sql.emptyTitle')}</h2>
      <p>
        {t('sql.emptyText')}
      </p>
      <span class="empty-shortcut"
        ><kbd>⌘ / Strg</kbd><span>+</span><kbd>Enter</kbd><span>{t('sql.toRun')}</span></span
      >
    </div>{/if}
  <div class="results-footer">
    <span
      ><span class="footer-dot"></span>{sql.execution ? t('sql.noRounding') : t('sql.ready')}</span
    ><span>{t('sql.rowsMax', { limit: formatNumber(sql.rowLimit) })}</span>
  </div>
</section>

<SqlLibraryPanel
  connection={session.connection}
  token={session.backendToken}
  value={sql.sql}
  disabled={sql.running}
  onwritephase={session.databaseWriteReceiver(session.sessionVersion)}
  onrestore={(value) => {
    sql.cancelPrompt();
    sql.sql = value;
    sql.focus();
  }}
/>

<VariablesDialog
  names={sql.variablePrompt}
  sql={sql.sql}
  driver={session.connection?.driver ?? 'sqlite'}
  initial={sql.variableValues}
  onrun={(values) => void sql.runWithValues(session, values)}
  onunchanged={() => void sql.runUnchanged(session)}
  oncancel={() => sql.cancelPrompt()}
/>
