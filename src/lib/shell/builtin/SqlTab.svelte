<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
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

<section class="editor-panel" aria-label="SQL-Abfrage">
  <div class="panel-heading">
    <div class="query-tab">
      <FileCode2 size={17} /><strong>Abfrage 1</strong><Badge variant="secondary">SQL</Badge>
    </div>
    <span class="editor-hint"><span>Editor fokussieren</span><kbd>⌘ / Strg K</kbd></span>
  </div>
  <div class="editor-surface">
    <div class="line-numbers" aria-hidden="true">
      {#each Array.from({ length: sql.lineCount }, (_, index) => index + 1) as line}<span
          >{line}</span
        >{/each}
    </div>
    <textarea
      id="sql-editor"
      aria-label="SQL-Abfrage"
      bind:this={editor}
      bind:value={sql.sql}
      onkeydown={editorKey}
      spellcheck={false}
      autocomplete="off"
      autocapitalize="off"
      maxlength={1000000}
      placeholder="-- Schreibe hier deine SQL-Abfrage.&#10;-- Ausgeführt wird erst mit „Ausführen“ oder ⌘ / Strg + Enter."
      disabled={sql.running}></textarea>
  </div>
  <div class="editor-toolbar">
    <div class="execution-actions">
      <Button
        class="run-button"
        aria-label="Abfrage ausführen"
        aria-keyshortcuts="Control+Enter Meta+Enter"
        onclick={() => void sql.execute(session)}
        disabled={!session.connection || !sql.sql.trim() || sql.running || session.connectionBusy}
        >{#if sql.running}<LoaderCircle class="animate-spin" />Wird ausgeführt{:else}<Play
            size={15}
            fill="currentColor"
          />Ausführen{/if}<kbd>⌘ ↵</kbd></Button
      >{#if sql.running}<Button variant="outline" onclick={() => sql.cancel()}
          ><Square size={13} />Abbrechen</Button
        >{/if}
    </div>
    <div class="execution-options">
      <label for="row-limit">Zeilenlimit</label><select
        id="row-limit"
        bind:value={sql.rowLimit}
        disabled={sql.running}
        ><option value={100}>100</option><option value={500}>500</option><option value={1000}
          >1.000</option
        ></select
      ><span class="toolbar-divider"></span><Clock3 size={14} /><select
        aria-label="Zeitlimit"
        bind:value={sql.timeoutMs}
        disabled={sql.running}
        ><option value={10000}>10 Sek.</option><option value={30000}>30 Sek.</option><option
          value={60000}>60 Sek.</option
        ></select
      >
    </div>
  </div>
</section>
<section class="results-panel" aria-label="Abfrageergebnisse" aria-busy={sql.running}>
  <div class="panel-heading">
    <div class="result-title">
      <Table2 size={17} /><strong>Ergebnisse</strong>{#if sql.currentResult}<Badge
          variant="secondary"
          >{sql.currentResult.rows.length}
          {sql.currentResult.rows.length === 1 ? 'Zeile' : 'Zeilen'}</Badge
        >{/if}
    </div>
    {#if sql.execution}<span class="execution-time"
        ><CheckCheck size={15} />{sql.execution.elapsedMs.toLocaleString('de-DE')} ms</span
      >{/if}
  </div>
  {#if sql.error}<div class="feedback error-feedback" role="alert">
      <TriangleAlert size={21} />
      <div>
        <strong>Abfrage fehlgeschlagen</strong>
        <p>{sql.error}</p>
      </div>
    </div>
  {:else if sql.cancelled}<div class="feedback warning-feedback" role="status">
      <Square size={18} />
      <div>
        <strong>Abbruch angefordert</strong>
        <p>
          Der Serverstatus muss geprüft werden. Bereits ausgeführte Änderungen werden durch einen
          Abbruch nicht rückgängig gemacht.
        </p>
      </div>
    </div>
  {:else if sql.running}<div class="results-empty" role="status">
      <div class="empty-icon running-icon">
        <LoaderCircle size={25} class="animate-spin" />
      </div>
      <h2>Abfrage wird ausgeführt</h2>
      <p>Ergebnisse werden geladen. Mit Escape kannst du abbrechen.</p>
    </div>
  {:else if sql.execution}
    {#if sql.execution.results.length > 1}<div
        class="result-tabs"
        role="tablist"
        aria-label="Ergebnissätze"
      >
        {#each sql.execution.results as result, index}<button
            role="tab"
            aria-selected={sql.activeResult === index}
            onclick={() => (sql.activeResult = index)}
            >Ergebnis {index + 1}<span>{result.rows.length}</span></button
          >{/each}
      </div>{/if}
    {#if sql.currentResult}<ResultTable
        result={sql.currentResult}
        exportScope={{ kind: 'sql_result' }}
      />{#if sql.currentResult.truncated}<div class="limit-note" role="status">
          <TriangleAlert size={16} /><span
            >Ergebnis begrenzt. Es werden höchstens {sql.rowLimit.toLocaleString('de-DE')} Zeilen angezeigt.
            Nicht alle Datensätze sind enthalten.</span
          >
        </div>{/if}{:else}<div class="feedback">
        <Check size={20} />Anweisung ohne Ergebnissatz abgeschlossen.
      </div>{/if}
    {#each sql.execution.warnings as warning}<div class="limit-note" role="status">
        <TriangleAlert size={16} />{warning}
      </div>{/each}
  {:else}<div class="results-empty">
      <div class="empty-icon"><Code2 size={27} strokeWidth={1.4} /></div>
      <h2>Platz für deine Ergebnisse</h2>
      <p>
        Führe eine Abfrage aus, um Daten, Spalten und<br class="desktop-break" /> Rückmeldungen hier zu
        sehen.
      </p>
      <span class="empty-shortcut"
        ><kbd>⌘ / Strg</kbd><span>+</span><kbd>Enter</kbd><span>zum Ausführen</span></span
      >
    </div>{/if}
  <div class="results-footer">
    <span
      ><span class="footer-dot"></span>{sql.execution
        ? 'Werte werden ohne numerische Rundung angezeigt'
        : 'Bereit für deine erste Abfrage'}</span
    ><span>{sql.rowLimit.toLocaleString('de-DE')} Zeilen max.</span>
  </div>
</section>
