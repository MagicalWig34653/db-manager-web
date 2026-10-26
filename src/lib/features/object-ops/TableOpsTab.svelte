<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { TriangleAlert } from '@lucide/svelte';
  import CapabilityNotice from '$lib/components/shared/CapabilityNotice.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import type { FeatureProps } from '$lib/features';
  import { t } from '$lib/i18n';
  import { toConnection } from '$lib/api';
  import { getShellContext } from '$lib/shell/context';
  import ActionCard from './ActionCard.svelte';
  import { CapabilityState } from './capabilities.svelte';
  import { errorCode, objectOpsClient, opErrorMessage } from './client';
  import {
    apiDriverOf,
    effectText,
    kindText,
    type DependenciesResult,
    type ObjectOpCapabilities,
    type ObjectOpResult,
  } from './model';

  let { connection, token, object, onwritephase, onsql }: FeatureProps = $props();
  const shell = getShellContext();
  const caps = new CapabilityState();
  const uid = $props.id();

  let renameName = $state('');
  let renameSchema = $state('');
  let copyName = $state('');
  let copySchema = $state('');
  let copyMode = $state<'structure' | 'data' | 'both'>('both');
  let restart = $state(false);
  let useEngine = $state(false);
  let engine = $state('');
  let useComment = $state(false);
  let comment = $state('');
  let useCollation = $state(false);
  let collation = $state('');
  let collationMode = $state<'default' | 'convert'>('default');
  let useAuto = $state(false);
  let autoIncrement = $state('');
  let finishedName = $state('');

  let deps = $state<DependenciesResult | null>(null);
  let depsError = $state('');
  let depsBusy = $state(false);
  let depsGeneration = 0;

  const driver = $derived(connection ? apiDriverOf(connection.driver) : 'sqlite');
  const capability = (action: keyof ObjectOpCapabilities['drivers']['sqlite']) =>
    caps.data?.drivers[driver][action];
  const optionFields = $derived(caps.data?.table_option_fields[driver] ?? []);
  const isBase = $derived(!!object && object.type !== 'view');
  const ref = $derived(
    object ? { ...(object.schema ? { schema: object.schema } : {}), name: object.name } : null,
  );
  const objectKey = $derived(object ? `${object.schema ?? ''}\u0000${object.name}` : '');

  $effect(() => {
    token;
    connection;
    if (!connection) return;
    untrack(() => void caps.load(token));
    return () => caps.abort();
  });
  // A different table or connection starts from a clean state.
  $effect(() => {
    objectKey;
    connection;
    token;
    untrack(() => {
      depsGeneration++;
      deps = null;
      depsError = '';
      depsBusy = false;
      finishedName = '';
      renameName = '';
      renameSchema = '';
      copyName = '';
      copySchema = '';
      copyMode = 'both';
      restart = false;
      useEngine = false;
      engine = '';
      useComment = false;
      comment = '';
      useCollation = false;
      collation = '';
      collationMode = 'default';
      useAuto = false;
      autoIncrement = '';
    });
  });

  const optional = (name: string, value: string) => (value === '' ? {} : { [name]: value });
  const autoValid = $derived(
    /^[1-9][0-9]{0,15}$/.test(autoIncrement) && Number(autoIncrement) <= 9007199254740991,
  );
  const optionsValid = $derived(
    (useEngine || useComment || useCollation || useAuto) &&
      (!useEngine || engine.trim() !== '') &&
      (!useCollation || collation.trim() !== '') &&
      (!useComment || comment.length <= 2048) &&
      (!useAuto || autoValid),
  );
  const optionsFields = () => ({
    table: ref,
    ...(useEngine ? { engine } : {}),
    ...(useComment ? { comment } : {}),
    ...(useCollation ? { collation, collation_mode: collationMode } : {}),
    ...(useAuto ? { auto_increment: Number(autoIncrement) } : {}),
  });

  function finished(result: ObjectOpResult | null, unknown: boolean) {
    if (unknown || result?.outcome === 'completed') void shell?.session.loadCatalog();
    if (result?.outcome === 'completed') finishedName = result.action;
  }
  async function loadDependencies() {
    if (!connection || !ref || depsBusy) return;
    const current = ++depsGeneration;
    depsBusy = true;
    depsError = '';
    try {
      const result = await objectOpsClient.dependencies(
        { connection: toConnection(connection), table: ref },
        token,
      );
      if (current === depsGeneration) deps = result;
    } catch (cause) {
      if (current === depsGeneration) {
        depsError = opErrorMessage(cause);
        void errorCode(cause);
      }
    } finally {
      if (current === depsGeneration) depsBusy = false;
    }
  }
</script>

<section class="ops" aria-label={t('object-ops.tableHeading')} data-testid="table-ops">
  <h2>{t('object-ops.tableHeading')}</h2>
  {#if !connection || !object || !ref}
    <p class="catalog-message">{t('object-ops.noTable')}</p>
  {:else if caps.state === 'loading'}
    <p class="catalog-message" role="status">{t('object-ops.capsLoading')}</p>
  {:else if caps.state === 'unsupported'}
    <CapabilityNotice title={t('object-ops.unsupportedTitle')} reason={caps.message} />
  {:else if caps.state === 'failed'}
    <div class="feedback error-feedback" role="alert">
      <TriangleAlert size={18} />
      <p>{caps.message}</p>
    </div>
  {:else if !isBase}
    <CapabilityNotice title={t('object-ops.viewTitle')} reason={t('object-ops.viewReason')} />
  {:else}
    <p class="note">
      {t('object-ops.tableIntro', { table: JSON.stringify(object.name) })}
    </p>
    {#if finishedName === 'table_rename' || finishedName === 'table_drop'}
      <div class="feedback" role="status" data-testid="gone-hint">
        <p>{t('object-ops.goneHint')}</p>
        <Button variant="outline" size="sm" onclick={onsql}>{t('object-ops.toDatabase')}</Button>
      </div>
    {/if}

    <div class="deps" data-testid="deps-box">
      <Button variant="outline" size="sm" disabled={depsBusy} onclick={loadDependencies}
        >{t('object-ops.checkDeps')}</Button
      >
      {#if depsError}<p class="issue" role="alert">{depsError}</p>{/if}
      {#if deps}
        {#if deps.dependencies.length === 0}<p>{t('object-ops.noDeps')}</p>{:else}
          <ul data-testid="deps-list">
            {#each deps.dependencies as dep, index (index)}
              <li>
                {kindText(dep.kind)}: {dep.schema ? `${dep.schema}.` : ''}{dep.name} · {effectText(
                  dep.effect,
                )}
                {#if dep.certainty === 'textual'}({t('object-ops.certaintyTextual')}){/if}
              </li>
            {/each}
          </ul>
        {/if}
        {#if deps.truncated}<p class="note">{t('object-ops.truncated')}</p>{/if}
        {#each deps.notes as note, index (index)}<p class="note">{note}</p>{/each}
      {/if}
    </div>

    <ActionCard
      action="table_rename"
      capability={capability('table_rename')}
      {connection}
      {token}
      {onwritephase}
      scope={objectKey}
      onfinished={finished}
      valid={renameName.trim() !== '' || renameSchema.trim() !== ''}
      fields={() => ({
        table: ref,
        ...optional('new_name', renameName),
        ...optional('new_schema', renameSchema),
      })}
    >
      {#snippet form(busy)}
        <div class="field">
          <label for="{uid}-rn">{t('object-ops.newName')}</label>
          <Input
            id="{uid}-rn"
            bind:value={renameName}
            disabled={busy}
            autocomplete="off"
            spellcheck={false}
          />
        </div>
        {#if driver !== 'sqlite'}
          <div class="field">
            <label for="{uid}-rs">{t('object-ops.newSchemaOptional')}</label>
            <Input
              id="{uid}-rs"
              bind:value={renameSchema}
              disabled={busy}
              autocomplete="off"
              spellcheck={false}
            />
          </div>
        {/if}
      {/snippet}
    </ActionCard>

    <ActionCard
      action="table_copy"
      capability={capability('table_copy')}
      {connection}
      {token}
      {onwritephase}
      scope={objectKey}
      onfinished={finished}
      valid={copyName.trim() !== ''}
      fields={() => ({
        table: ref,
        new_name: copyName,
        ...optional('new_schema', copySchema),
        mode: copyMode,
      })}
    >
      {#snippet form(busy)}
        <div class="field">
          <label for="{uid}-cpn">{t('object-ops.newName')}</label>
          <Input
            id="{uid}-cpn"
            bind:value={copyName}
            disabled={busy}
            autocomplete="off"
            spellcheck={false}
          />
        </div>
        {#if driver !== 'sqlite'}
          <div class="field">
            <label for="{uid}-cps">{t('object-ops.newSchemaOptional')}</label>
            <Input
              id="{uid}-cps"
              bind:value={copySchema}
              disabled={busy}
              autocomplete="off"
              spellcheck={false}
            />
          </div>
        {/if}
        <fieldset disabled={busy}>
          <legend>{t('object-ops.copyMode')}</legend>
          <label
            ><input type="radio" bind:group={copyMode} value="structure" />
            {t('object-ops.modeStructure')}</label
          >
          <label
            ><input type="radio" bind:group={copyMode} value="data" />
            {t('object-ops.modeData')}</label
          >
          <label
            ><input type="radio" bind:group={copyMode} value="both" />
            {t('object-ops.modeBoth')}</label
          >
          {#if copyMode === 'data'}<small>{t('object-ops.modeDataHint')}</small>{/if}
        </fieldset>
      {/snippet}
    </ActionCard>

    <ActionCard
      action="table_truncate"
      capability={capability('table_truncate')}
      {connection}
      {token}
      {onwritephase}
      scope={objectKey}
      onfinished={finished}
      fields={() => ({
        table: ref,
        ...(driver === 'postgres' && restart ? { restart_identity: true } : {}),
      })}
    >
      {#snippet form(busy)}
        <p class="note">{t('object-ops.truncateHint')}</p>
        {#if driver === 'postgres'}
          <label class="check"
            ><input type="checkbox" bind:checked={restart} disabled={busy} />
            {t('object-ops.restartIdentity')}</label
          >
        {/if}
      {/snippet}
    </ActionCard>

    <ActionCard
      action="table_drop"
      capability={capability('table_drop')}
      {connection}
      {token}
      {onwritephase}
      scope={objectKey}
      onfinished={finished}
      fields={() => ({ table: ref })}
    >
      {#snippet form()}
        <p class="note">{t('object-ops.dropTableHint')}</p>
      {/snippet}
    </ActionCard>

    <ActionCard
      action="table_options"
      capability={capability('table_options')}
      {connection}
      {token}
      {onwritephase}
      scope={objectKey}
      onfinished={finished}
      valid={optionsValid}
      fields={optionsFields}
    >
      {#snippet form(busy)}
        {#if optionFields.includes('engine')}
          <label class="check"
            ><input type="checkbox" bind:checked={useEngine} disabled={busy} />
            {t('object-ops.changeEngine')}</label
          >
          {#if useEngine}<Input
              aria-label={t('object-ops.engine')}
              bind:value={engine}
              disabled={busy}
            />{/if}
        {/if}
        {#if optionFields.includes('comment')}
          <label class="check"
            ><input type="checkbox" bind:checked={useComment} disabled={busy} />
            {t('object-ops.changeComment')}</label
          >
          {#if useComment}<Input
              aria-label={t('object-ops.comment')}
              bind:value={comment}
              disabled={busy}
            />{/if}
        {/if}
        {#if optionFields.includes('collation')}
          <label class="check"
            ><input type="checkbox" bind:checked={useCollation} disabled={busy} />
            {t('object-ops.changeCollation')}</label
          >
          {#if useCollation}
            <Input aria-label={t('object-ops.collation')} bind:value={collation} disabled={busy} />
            <fieldset disabled={busy}>
              <legend>{t('object-ops.collationMode')}</legend>
              <label
                ><input type="radio" bind:group={collationMode} value="default" />
                {t('object-ops.modeDefault')}</label
              >
              <label
                ><input type="radio" bind:group={collationMode} value="convert" />
                {t('object-ops.modeConvert')}</label
              >
            </fieldset>
          {/if}
        {/if}
        {#if optionFields.includes('auto_increment')}
          <label class="check"
            ><input type="checkbox" bind:checked={useAuto} disabled={busy} />
            {t('object-ops.changeAuto')}</label
          >
          {#if useAuto}<Input
              aria-label={t('object-ops.autoIncrement')}
              bind:value={autoIncrement}
              inputmode="numeric"
              disabled={busy}
            />{/if}
        {/if}
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
  .issue {
    color: var(--color-destructive);
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
  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.875rem;
  }
  /* WCAG 2.5.8: radio targets of at least 24x24 px. */
  fieldset input[type='radio'] {
    inline-size: 1.5rem;
    block-size: 1.5rem;
    margin: 0;
    flex: none;
  }
  fieldset label:has(input[type='radio']) {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }
  fieldset {
    display: grid;
    gap: 0.25rem;
    margin: 0;
    padding: 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }
  .deps {
    display: grid;
    gap: 0.375rem;
  }
  ul {
    margin: 0;
    padding-left: 1.25rem;
  }
</style>
