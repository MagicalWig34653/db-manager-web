<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { t } from '$lib/i18n';
  import type { ConnectionDraft } from '$lib/workbench';
  import { errorText } from './model';
  import type { Item } from './client';
  import { scopeFor } from './identity';
  import type { ConfigStore } from './store.svelte';

  let { store, connection }: { store: ConfigStore; connection: ConnectionDraft | null } = $props();
  let scope = $state('');
  let favorites = $state<Item[]>([]);
  let recents = $state<Item[]>([]);
  let database = $state('');
  let table = $state('');
  let busy = $state(false);
  let message = $state('');
  let failed = $state(false);
  const uid = $props.id();
  const label = (item: Item) =>
    [item.data.database, item.data.table].filter((x) => typeof x === 'string' && x).join('.');

  async function load(target: string) {
    const [fav, rec] = await Promise.all([
      store.listPage('favorites', { scope: target, limit: 100 }),
      store.listPage('recents', { scope: target, limit: 20 }),
    ]);
    if (target !== scope) return;
    failed = !fav.ok || !rec.ok;
    if (fav.ok) favorites = fav.value.items;
    if (rec.ok) recents = rec.value.items;
    if (!fav.ok) message = errorText(fav.code);
    else if (!rec.ok) message = errorText(rec.code);
  }
  $effect(() => {
    const source = connection;
    void store.revision;
    let alive = true;
    favorites = [];
    recents = [];
    message = '';
    if (!source) {
      scope = '';
      return;
    }
    void scopeFor(source).then((hash) => {
      if (!alive) return;
      scope = hash;
      void load(hash);
    });
    return () => {
      alive = false;
    };
  });
  async function add() {
    if (busy || !table.trim() || !scope) return;
    busy = true;
    try {
      message = '';
      const result = await store.addFavorite(scope, table.trim(), database.trim() || undefined);
      if (result.ok) {
        message = t('configStore.favoriteSaved');
        table = '';
        database = '';
        await load(scope);
      } else message = errorText(result.code);
    } finally {
      busy = false;
    }
  }
  async function remove(item: Item) {
    if (busy) return;
    busy = true;
    try {
      const result = await store.deleteItem(item);
      if (result.ok) favorites = favorites.filter((f) => f.id !== item.id);
      else message = errorText(result.code);
    } finally {
      busy = false;
    }
  }
</script>

<section class="favorites" aria-labelledby="{uid}-h">
  <h3 id="{uid}-h">{t('configStore.favoritesTitle')}</h3>
  {#if !connection}
    <p>{t('configStore.connectFirst')}</p>
  {:else}
    <p>{t('configStore.favoritesHint')}</p>
    <div class="row">
      <label for="{uid}-db">{t('configStore.favoriteDatabase')}</label>
      <input id="{uid}-db" bind:value={database} maxlength={128} />
      <label for="{uid}-table">{t('configStore.favoriteTable')}</label>
      <input id="{uid}-table" bind:value={table} maxlength={128} />
      <button type="button" disabled={busy || !table.trim()} onclick={add}
        >{t('configStore.favoriteAdd')}</button
      >
    </div>
    {#if message}<p role={failed ? 'alert' : 'status'}>{message}</p>{/if}
    <ul>
      {#each favorites as item (item.id)}
        <li>
          {label(item)}
          <button
            type="button"
            aria-label={t('configStore.favoriteRemove', { name: label(item) })}
            disabled={busy}
            onclick={() => remove(item)}>×</button
          >
        </li>
      {:else}<li>{t('configStore.favoritesEmpty')}</li>{/each}
    </ul>
    <h4>{t('configStore.recentsTitle')}</h4>
    <ul>
      {#each recents as item (item.id)}<li>{label(item)}</li>{:else}<li>
          {t('configStore.recentsEmpty')}
        </li>{/each}
    </ul>
  {/if}
</section>

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  h3,
  h4 {
    font-weight: 600;
    margin: 0.5rem 0;
  }
  p,
  li {
    overflow-wrap: anywhere;
    margin: 0.25rem 0;
  }
  input {
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
</style>
