<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { t, formatDate } from '$lib/i18n';
  import type { WritePhase } from '$lib/rows';
  import type { ConnectionDraft } from '$lib/workbench';
  import ClearPanel from './ClearPanel.svelte';
  import { scopeFor } from './identity';
  import { ServerLibrary, type ViewEntry } from './library.svelte';
  import type { ConfigStore } from './store.svelte';

  let {
    store,
    connection,
    token,
    value,
    disabled = false,
    onrestore,
    onwritephase = () => {},
  }: {
    store: ConfigStore;
    connection: ConnectionDraft | null;
    token: string;
    value: string;
    disabled?: boolean;
    onrestore: (sql: string) => void;
    onwritephase?: (phase: WritePhase) => void;
  } = $props();
  let library = $state<ServerLibrary>();
  let search = $state('');
  let name = $state('');
  let message = $state('');
  let editing = $state<string | null>(null);
  let editName = $state('');
  const uid = $props.id();
  const when = (time: string) =>
    formatDate(new Date(time), { dateStyle: 'short', timeStyle: 'short' });

  $effect(() => {
    const source = connection;
    let active = true;
    library = undefined;
    search = '';
    name = '';
    message = '';
    editing = null;
    if (source)
      void scopeFor(source).then((scope) => {
        if (!active) return;
        const next = new ServerLibrary(store, scope, () => [source.password, token]);
        library = next;
        void next.load();
      });
    return () => {
      active = false;
    };
  });
  // Entries written through the store (history of a run, buffered writes, replays) refresh the lists.
  $effect(() => {
    void store.revision;
    untrack(() => void library?.load());
  });

  async function save() {
    const target = library;
    if (!target) return;
    const result = await target.bookmark(name, value);
    if (result === 'saved') message = t('sqlEditor.saved');
    else if (result === 'buffered') message = t('configStore.library.buffered');
    else message = '';
    if (result === 'saved' || result === 'buffered') name = '';
  }
  async function saveEdit(entry: ViewEntry) {
    if (await library?.edit(entry, editName, entry.sql)) editing = null;
  }
  function download() {
    if (!library) return;
    const text = JSON.stringify(
      {
        version: 1,
        bookmarks: library.bookmarks.map(({ name, sql, time }) => ({ name, sql, time })),
      },
      null,
      2,
    );
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sql-lesezeichen.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const matches = (entry: ViewEntry) => entry.sql.toLowerCase().includes(search.toLowerCase());
</script>

<section class="sql-library" aria-label={t('sqlEditor.title')}>
  <h2>{t('sqlEditor.title')}</h2>
  <p>{t('configStore.library.server')}</p>
  {#if store.degraded}<p role="alert">
      {t('configStore.degraded', { count: store.buffer.entries.length })}
    </p>{/if}
  {#if library}
    {#if !store.historyEnabled}<p>{t('configStore.library.historyOff')}</p>{/if}
    {#if library.error}<p role="alert">{library.error}</p>{/if}
    {#if library.conflict}
      {@const conflict = library.conflict}
      <section class="conflict" role="alert" aria-labelledby="{uid}-conflict">
        <h3 id="{uid}-conflict">{t('configStore.library.conflictTitle')}</h3>
        <p>{t('configStore.library.conflictBody')}</p>
        <h4>{t('configStore.library.conflictServer')}</h4>
        {#if conflict.current}
          <strong>{String(conflict.current.data.name ?? '')}</strong>
          <pre>{String(conflict.current.data.sql ?? '')}</pre>
        {:else}<p>{t('configStore.library.conflictGone')}</p>{/if}
        <h4>{t('configStore.library.conflictMine')}</h4>
        <strong>{conflict.mine.name}</strong>
        <pre>{conflict.mine.sql}</pre>
        <div class="actions">
          <button type="button" disabled={library.busy} onclick={() => library?.resolve('server')}
            >{t('configStore.library.keepServer')}</button
          >
          <button
            type="button"
            disabled={library.busy || !conflict.current}
            onclick={() => library?.resolve('mine')}>{t('configStore.library.saveMine')}</button
          >
        </div>
      </section>
    {/if}
    <div class="actions">
      <label for="{uid}-name">{t('sqlEditor.name')}</label>
      <input id="{uid}-name" bind:value={name} maxlength={100} />
      <button disabled={!value.trim() || !name.trim() || library.busy} onclick={save}
        >{t('sqlEditor.save')}</button
      >
      <button onclick={download} disabled={!library.bookmarks.length}
        >{t('sqlEditor.export')}</button
      >
    </div>
    {#if message}<p role="status">{message}</p>{/if}
    <h3>{t('sqlEditor.bookmarks')}</h3>
    <ClearPanel
      {store}
      kinds={['bookmarks']}
      scope={library.scope}
      label={t('configStore.clear.bookmarks')}
      {onwritephase}
    />
    <ul>
      {#each library.shown('bookmarks') as entry (entry.id)}
        <li>
          {#if editing === entry.id}
            <label for="{uid}-edit">{t('configStore.library.editName')}</label>
            <input id="{uid}-edit" bind:value={editName} maxlength={100} />
            <button disabled={library.busy || !editName.trim()} onclick={() => saveEdit(entry)}
              >{t('configStore.library.editSave')}</button
            >
            <button onclick={() => (editing = null)}>{t('configStore.library.editCancel')}</button>
          {:else}
            <strong>{entry.name}</strong>
            {#if entry.pending}<em>({t('configStore.library.pending')})</em>{/if}
          {/if}
          <pre>{entry.sql}</pre>
          <button {disabled} onclick={() => onrestore(entry.sql)}>{t('sqlEditor.restore')}</button>
          {#if !entry.pending && editing !== entry.id}
            <button
              disabled={library.busy}
              onclick={() => {
                editing = entry.id;
                editName = entry.name;
              }}>{t('configStore.library.edit')}</button
            >
          {/if}
          <button
            aria-label={t('sqlEditor.deleteBookmark', { name: entry.name })}
            disabled={library.busy}
            onclick={() => library?.remove('bookmarks', entry)}>{t('sqlEditor.delete')}</button
          >
        </li>
      {:else}<li>{t('sqlEditor.empty')}</li>{/each}
    </ul>
    {#if library.cursor.bookmarks}
      <button type="button" disabled={library.loading} onclick={() => library?.more('bookmarks')}
        >{t('configStore.library.more')}</button
      >
    {/if}
    <h3>{t('sqlEditor.history')}</h3>
    <label for="{uid}-search">{t('sqlEditor.search')}</label>
    <input id="{uid}-search" type="search" bind:value={search} />
    <ClearPanel
      {store}
      kinds={['history']}
      scope={library.scope}
      label={t('sqlEditor.clearHistory')}
      {onwritephase}
    />
    <ul>
      {#each library.shown('history').filter(matches) as entry (entry.id)}
        <li>
          <time datetime={entry.time}>{when(entry.time)}</time>
          {#if entry.pending}<em>({t('configStore.library.pending')})</em>{/if}
          <pre>{entry.sql}</pre>
          <button {disabled} onclick={() => onrestore(entry.sql)}>{t('sqlEditor.restore')}</button>
          <button
            aria-label={t('sqlEditor.deleteHistory')}
            disabled={library.busy}
            onclick={() => library?.remove('history', entry)}>{t('sqlEditor.delete')}</button
          >
        </li>
      {:else}<li>{t('sqlEditor.empty')}</li>{/each}
    </ul>
    {#if library.cursor.history}
      <button type="button" disabled={library.loading} onclick={() => library?.more('history')}
        >{t('configStore.library.more')}</button
      >
    {/if}
  {:else}<p>{connection ? t('configStore.library.loading') : t('sqlEditor.connect')}</p>{/if}
</section>

<style>
  .sql-library {
    padding: 1rem;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
  }
  h2,
  h3,
  h4 {
    font-weight: 600;
    margin: 0.5rem 0;
  }
  p {
    margin: 0.5rem 0;
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .conflict {
    border: 1px solid var(--border);
    border-radius: 0.3rem;
    padding: 0.5rem;
    margin: 0.5rem 0;
  }
  input:not([type='checkbox']) {
    max-width: 100%;
    min-width: 0;
    border: 1px solid var(--border);
    padding: 0.3rem;
  }
  button {
    border: 1px solid var(--border);
    padding: 0.3rem 0.6rem;
    border-radius: 0.3rem;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  ul {
    max-height: 18rem;
    overflow: auto;
  }
  li {
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border);
  }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 7rem;
    overflow: auto;
  }
</style>
