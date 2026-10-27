<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import SqlLibraryPanel from '$lib/features/sql-editor/SqlLibraryPanel.svelte';
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
  } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import ResultTable from '$lib/components/ResultTable.svelte';
  import { getShellContext } from '../context';

  const { session, sql } = getShellContext();
  let editor = $state<HTMLTextAreaElement>();

  onMount(() => {
    sql.focus = () => editor?.focus();
    return () => {
      sql.focus = () => {};
    };
  });
  function editorKey(event: KeyboardEvent) {
    if (event.key === 'Tab' && !event.shiftKey && editor) {
      event.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      sql.sql = sql.sql.slice(0, start) + '  ' + sql.sql.slice(end);
      requestAnimationFrame(() => {
        if (editor) editor.selectionStart = editor.selectionEnd = start + 2;
      });
    }
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
  <div class="editor-surface">
    <div class="line-numbers" aria-hidden="true">
      {#each Array.from({ length: sql.lineCount }, (_, index) => index + 1) as line}<span
          >{line}</span
        >{/each}
    </div>
    <textarea
      id="sql-editor"
      aria-label={t('sql.queryLabel')}
      bind:this={editor}
      bind:value={sql.sql}
      onkeydown={editorKey}
      spellcheck={false}
      autocomplete="off"
      autocapitalize="off"
      maxlength={1000000}
      placeholder={t('sql.placeholder')}
      disabled={sql.running}></textarea>
  </div>
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
    sql.sql = value;
    sql.focus();
  }}
/>
