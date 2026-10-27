<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  // SQL editor. CodeMirror 6 is loaded lazily (own chunk); until it is there, or when it cannot be loaded,
  // a plain textarea with the same id and label keeps the editor usable. No {@html}: all text is rendered as text.
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n';
  import type { CatalogObject, ConnectionDraft, Driver } from '$lib/workbench';
  import { buildColumnIndex, buildSchema } from './catalog-hints.svelte';
  import type { EditorHandle, Texts } from './cm';
  import { formatSql } from './format';

  let {
    value = $bindable(''),
    connection,
    objects,
    readOnly = false,
  }: {
    value: string;
    connection: ConnectionDraft | null;
    objects: CatalogObject[];
    readOnly?: boolean;
  } = $props();

  const hintId = $props.id();
  let host = $state<HTMLDivElement>();
  let fallback = $state<HTMLTextAreaElement>();
  let handle = $state.raw<EditorHandle | null>(null);
  let focusMode = $state(false);
  const driver = $derived<Driver>(connection?.driver ?? 'sqlite');

  const phrases = () => ({
    Find: t('sqlEditor.cm.find'),
    Replace: t('sqlEditor.cm.replace'),
    next: t('sqlEditor.cm.next'),
    previous: t('sqlEditor.cm.previous'),
    all: t('sqlEditor.cm.all'),
    'match case': t('sqlEditor.cm.matchCase'),
    regexp: t('sqlEditor.cm.regexp'),
    'by word': t('sqlEditor.cm.byWord'),
    replace: t('sqlEditor.cm.replaceOne'),
    'replace all': t('sqlEditor.cm.replaceAll'),
    close: t('sqlEditor.cm.close'),
    'current match': t('sqlEditor.cm.currentMatch'),
    'on line': t('sqlEditor.cm.onLine'),
    'replaced $ matches': t('sqlEditor.cm.replacedMany'),
    'replaced match on line $': t('sqlEditor.cm.replacedOne'),
    Completions: t('sqlEditor.cm.completions'),
  });
  const texts = (): Texts => ({
    label: t('sql.queryLabel'),
    describedBy: hintId,
    hint: t('sqlEditor.tabHint'),
    placeholder: t('sql.placeholder'),
    phrases: phrases(),
  });

  onMount(() => {
    let active = true;
    let created: EditorHandle | undefined;
    void import('./cm')
      .then((module) => {
        if (!active || !host) return;
        const refocus = document.activeElement === fallback;
        created = module.createEditor({
          parent: host,
          doc: value,
          driver,
          schema: buildSchema(objects, connection),
          columns: buildColumnIndex(objects, connection),
          texts: texts(),
          readOnly,
          onChange: (doc) => (value = doc),
          onTabMode: (mode) => (focusMode = mode),
        });
        handle = created;
        if (refocus) created.focus();
      })
      .catch(() => {
        // Chunk unavailable (for example offline before first use): the textarea fallback stays.
      });
    return () => {
      active = false;
      created?.destroy();
      handle = null;
    };
  });

  $effect(() => {
    const current = value;
    handle?.setDoc(current);
  });
  $effect(() => {
    handle?.setLanguage(
      driver,
      buildSchema(objects, connection),
      buildColumnIndex(objects, connection),
    );
  });
  $effect(() => {
    handle?.setReadOnly(readOnly);
  });
  $effect(() => {
    handle?.setTexts(texts());
  });

  export function focus() {
    if (handle) handle.focus();
    else fallback?.focus();
  }
  export function find(): boolean {
    if (!handle) return false;
    handle.openSearch();
    return true;
  }
  /** Returns false when the text cannot be formatted safely (nothing is changed then). */
  export function format(): boolean {
    const formatted = formatSql(value, driver);
    if (formatted === null) return false;
    if (handle) handle.replaceDoc(formatted);
    else value = formatted;
    return true;
  }
</script>

<div class="editor-surface">
  <div class="sql-editor-host" bind:this={host}>
    {#if !handle}
      <textarea
        id="sql-editor"
        class="sql-editor-fallback"
        aria-label={t('sql.queryLabel')}
        aria-describedby={hintId}
        bind:this={fallback}
        bind:value
        spellcheck={false}
        autocomplete="off"
        autocapitalize="off"
        maxlength={1000000}
        placeholder={t('sql.placeholder')}
        disabled={readOnly}></textarea>
    {/if}
  </div>
</div>
{#if !handle}<p class="editor-keyhint" id={hintId}>{t('sqlEditor.loading')}</p>{/if}
<span class="sr-only" role="status">{focusMode ? t('sqlEditor.tabLeaves') : ''}</span>
