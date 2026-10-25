<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { TriangleAlert } from '@lucide/svelte';
  import CapabilityNotice from '$lib/components/shared/CapabilityNotice.svelte';
  import { Input } from '$lib/components/ui/input';
  import type { FeatureProps } from '$lib/features';
  import { t } from '$lib/i18n';
  import ActionCard from './ActionCard.svelte';
  import { CapabilityState } from './capabilities.svelte';
  import { apiDriverOf } from './model';

  let { connection, token, onwritephase }: FeatureProps = $props();
  const caps = new CapabilityState();
  const uid = $props.id();
  let createName = $state('');
  let createCollation = $state('');
  let dropName = $state('');
  let collationName = $state(untrack(() => connection?.database ?? ''));
  let collation = $state('');

  const driver = $derived(connection ? apiDriverOf(connection.driver) : 'sqlite');
  const capability = (action: keyof NonNullable<typeof caps.data>['drivers']['sqlite']) =>
    caps.data?.drivers[driver][action];

  $effect(() => {
    token;
    connection;
    if (!connection) return;
    untrack(() => void caps.load(token));
    return () => caps.abort();
  });
  const optional = (name: string, value: string) => (value.trim() === '' ? {} : { [name]: value });
</script>

<section class="ops" aria-label={t('object-ops.databaseHeading')} data-testid="database-ops">
  <h2>{t('object-ops.databaseHeading')}</h2>
  {#if !connection}
    <p class="catalog-message">{t('object-ops.noConnection')}</p>
  {:else if caps.state === 'loading'}
    <p class="catalog-message" role="status">{t('object-ops.capsLoading')}</p>
  {:else if caps.state === 'unsupported'}
    <CapabilityNotice title={t('object-ops.unsupportedTitle')} reason={caps.message} />
  {:else if caps.state === 'failed'}
    <div class="feedback error-feedback" role="alert">
      <TriangleAlert size={18} />
      <p>{caps.message}</p>
    </div>
  {:else}
    <p class="note">
      {t('object-ops.databaseIntro', { database: JSON.stringify(connection.database) })}
    </p>
    <ActionCard
      action="database_create"
      capability={capability('database_create')}
      {connection}
      {token}
      {onwritephase}
      valid={createName.trim() !== ''}
      fields={() => ({ database: createName, ...optional('collation', createCollation) })}
    >
      {#snippet form(busy)}
        <div class="field">
          <label for="{uid}-cn">{t('object-ops.databaseName')}</label>
          <Input
            id="{uid}-cn"
            bind:value={createName}
            disabled={busy}
            autocomplete="off"
            spellcheck={false}
          />
        </div>
        <div class="field">
          <label for="{uid}-cc">{t('object-ops.collationOptional')}</label>
          <Input
            id="{uid}-cc"
            bind:value={createCollation}
            disabled={busy}
            autocomplete="off"
            spellcheck={false}
          />
        </div>
      {/snippet}
    </ActionCard>
    <ActionCard
      action="database_drop"
      capability={capability('database_drop')}
      {connection}
      {token}
      {onwritephase}
      valid={dropName.trim() !== ''}
      fields={() => ({ database: dropName })}
    >
      {#snippet form(busy)}
        <div class="field">
          <label for="{uid}-dn">{t('object-ops.databaseName')}</label>
          <Input
            id="{uid}-dn"
            bind:value={dropName}
            disabled={busy}
            autocomplete="off"
            spellcheck={false}
          />
          <small>{t('object-ops.dropHint')}</small>
        </div>
      {/snippet}
    </ActionCard>
    <ActionCard
      action="database_collation"
      capability={capability('database_collation')}
      {connection}
      {token}
      {onwritephase}
      valid={collationName.trim() !== '' && collation.trim() !== ''}
      fields={() => ({ database: collationName, collation })}
    >
      {#snippet form(busy)}
        <div class="field">
          <label for="{uid}-kn">{t('object-ops.databaseName')}</label>
          <Input
            id="{uid}-kn"
            bind:value={collationName}
            disabled={busy}
            autocomplete="off"
            spellcheck={false}
          />
        </div>
        <div class="field">
          <label for="{uid}-kc">{t('object-ops.collation')}</label>
          <Input
            id="{uid}-kc"
            bind:value={collation}
            disabled={busy}
            autocomplete="off"
            spellcheck={false}
          />
          <small>{t('object-ops.collationHint')}</small>
        </div>
      {/snippet}
    </ActionCard>
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
  .field {
    display: grid;
    gap: 0.25rem;
    min-width: 0;
  }
  .field label {
    font-size: 0.8125rem;
    font-weight: 600;
  }
</style>
