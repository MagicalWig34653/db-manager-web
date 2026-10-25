<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { t } from '$lib/i18n';
  import {
    TYPE_ORDER,
    typeLabels,
    usesPositions,
    type ApiDriver,
    type DefinitionDraft,
    type Issue,
    type PositionDraft,
    type TypeKind,
  } from './model';

  let {
    draft = $bindable(),
    position = $bindable(),
    issues,
    types,
    driver,
    action,
    existing,
    self = '',
    oldDefault,
    disabled = false,
  }: {
    draft: DefinitionDraft;
    position: PositionDraft;
    issues: Issue[];
    types: readonly string[];
    driver: ApiDriver;
    action: 'add' | 'change' | 'reorder';
    existing: readonly string[];
    self?: string;
    oldDefault?: string;
    disabled?: boolean;
  } = $props();
  const uid = $props.id();
  const offered = $derived(TYPE_ORDER.filter((kind) => types.includes(kind)));
  const issueFor = (field: string) => issues.filter((issue) => issue.field === field);
  const referenceColumns = $derived(existing.filter((name) => name !== self));
  const commentForced = $derived(driver === 'mysql' && action !== 'add');
  $effect(() => {
    if (commentForced && !draft.commentSet) draft.commentSet = true;
  });
  $effect(() => {
    if (draft.kind === 'binary' && draft.defaultMode === 'value') draft.defaultMode = 'none';
    if (!draft.nullable && draft.defaultMode === 'null') draft.defaultMode = 'none';
  });
</script>

<div class="definition" data-testid="definition-form">
  {#if action === 'add'}
    <div class="field">
      <label for="{uid}-name">{t('columns.fieldName')}</label>
      <Input id="{uid}-name" bind:value={draft.name} {disabled} autocomplete="off" />
      {#each issueFor('name') as issue (issue.message)}<small class="issue">{issue.message}</small
        >{/each}
    </div>
  {/if}
  <div class="field">
    <label for="{uid}-kind">{t('columns.fieldType')}</label>
    <select id="{uid}-kind" bind:value={draft.kind} {disabled}>
      <option value="">{t('columns.chooseType')}</option>
      {#each offered as kind (kind)}<option value={kind}>{t(typeLabels[kind as TypeKind])}</option
        >{/each}
    </select>
    {#each issueFor('kind') as issue (issue.message)}<small class="issue">{issue.message}</small
      >{/each}
  </div>
  {#if draft.kind === 'text'}
    <div class="field narrow">
      <label for="{uid}-length">{t('columns.fieldLength')}</label>
      <Input id="{uid}-length" inputmode="numeric" bind:value={draft.length} {disabled} />
      {#each issueFor('length') as issue (issue.message)}<small class="issue">{issue.message}</small
        >{/each}
    </div>
  {/if}
  {#if draft.kind === 'decimal'}
    <div class="field narrow">
      <label for="{uid}-precision">{t('columns.fieldPrecision')}</label>
      <Input id="{uid}-precision" inputmode="numeric" bind:value={draft.precision} {disabled} />
    </div>
    <div class="field narrow">
      <label for="{uid}-scale">{t('columns.fieldScale')}</label>
      <Input id="{uid}-scale" inputmode="numeric" bind:value={draft.scale} {disabled} />
    </div>
    {#each issueFor('precision') as issue (issue.message)}<small class="issue wide"
        >{issue.message}</small
      >{/each}
  {/if}
  {#if draft.kind === 'enum' || draft.kind === 'set'}
    <div class="field wide">
      <label for="{uid}-values">{t('columns.fieldValues')}</label>
      <Textarea id="{uid}-values" rows={4} bind:value={draft.values} {disabled} />
      <small>{t('columns.valuesHint')}</small>
      {#each issueFor('values') as issue (issue.message)}<small class="issue">{issue.message}</small
        >{/each}
    </div>
  {/if}
  {#if draft.kind === 'text' && driver !== 'sqlite'}
    <div class="field">
      <label for="{uid}-collation">
        {driver === 'mysql' && action !== 'add'
          ? t('columns.fieldCollationRequired')
          : t('columns.fieldCollation')}
      </label>
      <Input id="{uid}-collation" bind:value={draft.collation} {disabled} autocomplete="off" />
      {#each issueFor('collation') as issue (issue.message)}<small class="issue"
          >{issue.message}</small
        >{/each}
    </div>
  {/if}
  <label class="check">
    <input type="checkbox" bind:checked={draft.nullable} {disabled} />
    {t('columns.fieldNullable')}
  </label>
  <div class="field">
    <label for="{uid}-default-mode">{t('columns.fieldDefault')}</label>
    <select id="{uid}-default-mode" bind:value={draft.defaultMode} {disabled}>
      <option value="none">{t('columns.defaultNone')}</option>
      {#if draft.nullable}<option value="null">{t('columns.defaultNull')}</option>{/if}
      {#if draft.kind !== 'binary'}<option value="value">{t('columns.defaultValue')}</option>{/if}
    </select>
    {#if draft.defaultMode === 'value'}
      {#if draft.kind === 'boolean'}
        <select aria-label={t('columns.defaultValue')} bind:value={draft.defaultValue} {disabled}>
          <option value="">{t('columns.chooseType')}</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      {:else}
        <Input
          aria-label={t('columns.defaultValue')}
          bind:value={draft.defaultValue}
          {disabled}
          autocomplete="off"
        />
      {/if}
    {/if}
    {#if oldDefault !== undefined}<small data-testid="old-default"
        >{t('columns.oldDefault', { value: oldDefault })}</small
      >{/if}
    {#each issueFor('default') as issue (issue.message)}<small class="issue">{issue.message}</small
      >{/each}
  </div>
  {#if !commentForced && action === 'change'}
    <label class="check">
      <input type="checkbox" bind:checked={draft.commentSet} {disabled} />
      {t('columns.commentChange')}
    </label>
  {/if}
  {#if draft.commentSet}
    <div class="field wide">
      <label for="{uid}-comment">{t('columns.fieldComment')}</label>
      <Input id="{uid}-comment" bind:value={draft.comment} {disabled} autocomplete="off" />
      {#if commentForced}<small>{t('columns.commentReplaces')}</small>{/if}
      {#each issueFor('comment') as issue (issue.message)}<small class="issue"
          >{issue.message}</small
        >{/each}
    </div>
  {/if}
  {#if usesPositions(driver) && (action === 'add' || action === 'reorder')}
    <div class="field">
      <label for="{uid}-position">{t('columns.fieldPosition')}</label>
      <select id="{uid}-position" bind:value={position.mode} {disabled}>
        {#if action === 'add'}<option value="keep">{t('columns.posEnd')}</option>{/if}
        {#if action === 'reorder'}<option value="keep">{t('columns.posChoose')}</option>{/if}
        <option value="first">{t('columns.posFirst')}</option>
        <option value="after">{t('columns.posAfter')}</option>
        <option value="before">{t('columns.posBefore')}</option>
      </select>
      {#if position.mode === 'before' || position.mode === 'after'}
        <select aria-label={t('columns.posReference')} bind:value={position.column} {disabled}>
          <option value="">{t('columns.posReference')}</option>
          {#each referenceColumns as name (name)}<option value={name}>{name}</option>{/each}
        </select>
      {/if}
      {#each issueFor('position') as issue (issue.message)}<small class="issue"
          >{issue.message}</small
        >{/each}
    </div>
  {/if}
</div>

<style>
  .definition {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.5rem 0.75rem;
  }
  .field {
    display: grid;
    flex: 1 1 11rem;
    gap: 0.25rem;
    min-width: 0;
  }
  .field.narrow {
    flex: 0 1 7rem;
  }
  .field.wide,
  .wide {
    flex: 1 1 100%;
  }
  .field label {
    font-size: 0.8125rem;
    font-weight: 600;
  }
  select {
    height: 2rem;
    min-width: 0;
    padding: 0 0.5rem;
    border: 1px solid var(--color-input);
    border-radius: var(--radius-md);
    background: var(--color-background);
    color: inherit;
    font: inherit;
  }
  small {
    color: var(--color-muted-foreground);
    font-size: 0.8125rem;
  }
  .issue {
    color: var(--color-destructive);
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    flex: 1 1 100%;
    font-size: 0.8125rem;
  }
</style>
