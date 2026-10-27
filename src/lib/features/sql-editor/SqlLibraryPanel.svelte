<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { t } from '$lib/i18n';
  import type { WritePhase } from '$lib/rows';
  import type { ConnectionDraft } from '$lib/workbench';
  import ServerLibraryView from '../config-store/ServerLibraryView.svelte';
  import { configStoreFor } from '../config-store/store.svelte';
  import { libraryFor, MAX_BYTES, type SqlLibrary } from './storage.svelte';
  let {
    connection,
    token,
    value,
    disabled = false,
    onrestore,
    onwritephase = () => {},
  }: {
    connection: ConnectionDraft | null;
    token: string;
    value: string;
    disabled?: boolean;
    onrestore: (sql: string) => void;
    onwritephase?: (phase: WritePhase) => void;
  } = $props();
  // The server store is used only when the capabilities say so; otherwise this browser-local mode stays active.
  const store = $derived(configStoreFor(token));
  const server = $derived(store.phase === 'ready' && store.mode === 'server');
  $effect(() => {
    void store.ensureReady();
  });
  let library = $state<SqlLibrary>();
  let search = $state('');
  let name = $state('');
  let message = $state('');
  const uid = $props.id();
  $effect(() => {
    const source = connection;
    let active = true;
    library = undefined;
    search = '';
    name = '';
    message = '';
    if (source)
      void libraryFor(source).then((result) => {
        if (active) library = result;
      });
    return () => {
      active = false;
    };
  });
  const secrets = () => [connection?.password ?? '', token];
  async function importFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    const target = library;
    input.value = '';
    if (!file || !target) return;
    const activeSecrets = secrets();
    try {
      if (file.size > MAX_BYTES) throw new Error('Size limit');
      const text = await file.text();
      if (target !== library) return;
      target.importBookmarks(text, activeSecrets);
      message = t('sqlEditor.imported');
    } catch {
      if (target === library) message = t('sqlEditor.invalid');
    }
  }
  function download() {
    if (!library) return;
    const url = URL.createObjectURL(
      new Blob([library.exportBookmarks()], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sql-lesezeichen.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
</script>

{#if server}
  <ServerLibraryView {store} {connection} {token} {value} {disabled} {onrestore} {onwritephase} />
{:else if token && store.phase !== 'ready'}
  <section class="sql-library" aria-label={t('sqlEditor.title')}>
    <h2>{t('sqlEditor.title')}</h2>
    <p role="status">{t('configStore.checking')}</p>
  </section>
{:else}
  <section class="sql-library" aria-label={t('sqlEditor.title')}>
    <h2>{t('sqlEditor.title')}</h2>
    <p>{t('sqlEditor.privacy')}</p>
    {#if library}
      <label
        ><input
          type="checkbox"
          checked={library.enabled}
          onchange={(e) => library?.setEnabled(e.currentTarget.checked)}
        />
        {t('sqlEditor.enable')}</label
      >
      <p>{t('sqlEditor.limits')}</p>
      {#if library.storageUnavailable}<p role="status">{t('sqlEditor.unavailable')}</p>{/if}
      <div class="actions">
        <label for="{uid}-name">{t('sqlEditor.name')}</label>
        <input id="{uid}-name" bind:value={name} maxlength={100} />
        <button
          disabled={!value.trim() || !name.trim()}
          onclick={() => {
            message = library?.bookmark(name, value, secrets())
              ? t('sqlEditor.saved')
              : t('sqlEditor.invalid');
          }}>{t('sqlEditor.save')}</button
        >
        <button onclick={download} disabled={!library.bookmarks.length}
          >{t('sqlEditor.export')}</button
        >
        <label for="{uid}-import">{t('sqlEditor.import')}</label>
        <input
          id="{uid}-import"
          type="file"
          accept="application/json,.json"
          onchange={importFile}
        />
      </div>
      {#if message}<p role="status">{message}</p>{/if}
      <h3>{t('sqlEditor.bookmarks')}</h3>
      <button disabled={!library.bookmarks.length} onclick={() => library?.remove('bookmarks')}
        >{t('sqlEditor.clearBookmarks')}</button
      >
      <ul>
        {#each library.bookmarks as entry (entry.id)}
          <li>
            <strong>{entry.name}</strong>
            <pre>{entry.sql}</pre>
            <button {disabled} onclick={() => onrestore(entry.sql)}>{t('sqlEditor.restore')}</button
            >
            <button
              aria-label={t('sqlEditor.deleteBookmark', { name: entry.name })}
              onclick={() => library?.remove('bookmarks', entry.id)}>{t('sqlEditor.delete')}</button
            >
          </li>
        {:else}<li>{t('sqlEditor.empty')}</li>{/each}
      </ul>
      <h3>{t('sqlEditor.history')}</h3>
      <label for="{uid}-search">{t('sqlEditor.search')}</label>
      <input id="{uid}-search" type="search" bind:value={search} />
      <button disabled={!library.history.length} onclick={() => library?.remove('history')}
        >{t('sqlEditor.clearHistory')}</button
      >
      <ul>
        {#each library.history.filter((e) => e.sql
            .toLowerCase()
            .includes(search.toLowerCase())) as entry (entry.id)}
          <li>
            <time datetime={entry.time}>{new Date(entry.time).toLocaleString('de-DE')}</time>
            <pre>{entry.sql}</pre>
            <button {disabled} onclick={() => onrestore(entry.sql)}>{t('sqlEditor.restore')}</button
            >
            <button
              aria-label={t('sqlEditor.deleteHistory')}
              onclick={() => library?.remove('history', entry.id)}>{t('sqlEditor.delete')}</button
            >
          </li>
        {:else}<li>{t('sqlEditor.empty')}</li>{/each}
      </ul>
    {:else}<p>{t('sqlEditor.connect')}</p>{/if}
  </section>
{/if}

<style>
  .sql-library {
    padding: 1rem;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
  }
  h2,
  h3 {
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
