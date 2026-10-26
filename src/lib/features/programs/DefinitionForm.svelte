<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { t } from '$lib/i18n';
  import { types, type Input, type Kind } from './model';
  let {
    value = $bindable(),
    kind,
    driver,
    disabled = false,
  }: { value: Input; kind: Kind; driver: string; disabled?: boolean } = $props();
  const routine = $derived(kind === 'function' || kind === 'procedure');
</script>

<fieldset {disabled}>
  {#if !(kind === 'trigger' && driver === 'postgres')}
    <label
      >{t('programs.body')}<textarea
        rows="10"
        spellcheck={false}
        autocomplete="off"
        bind:value={value.body}></textarea></label
    >
    <p>{t('programs.bodyHint')}</p>
  {/if}
  {#if driver !== 'sqlite' && (kind === 'view' || routine)}
    <label
      >{t('programs.security')}<select bind:value={value.security}
        ><option value={undefined}>{t('programs.default')}</option><option value="invoker"
          >INVOKER</option
        ><option value="definer">DEFINER</option></select
      ></label
    >
  {/if}
  {#if driver !== 'sqlite' && !(kind === 'trigger' && driver === 'postgres')}
    <label
      >{t('programs.definer')}<input
        value={value.definer?.name ?? ''}
        oninput={(e) => {
          const name = e.currentTarget.value;
          value.definer = name ? { ...value.definer, name } : undefined;
        }}
        autocomplete="off"
      /></label
    >
    {#if driver === 'mysql' && value.definer}<label
        >{t('programs.host')}<input bind:value={value.definer.host} autocomplete="off" /></label
      >{/if}
    {#if value.definer || value.security === 'definer'}<p role="alert">
        {t('programs.definerWarning')}
      </p>{/if}
  {/if}
  {#if kind === 'view' && driver !== 'sqlite'}
    <label
      >{t('programs.checkOption')}<select bind:value={value.check_option}
        ><option value={undefined}>{t('programs.none')}</option><option value="local">LOCAL</option
        ><option value="cascaded">CASCADED</option></select
      ></label
    >
  {/if}
  {#if routine}
    {#if kind === 'function'}<label
        >{t('programs.returns')}<select bind:value={value.returns}
          >{#each [...types, ...(driver === 'postgres' ? (['void', 'trigger'] as const) : [])] as type}<option
              value={type}>{type}</option
            >{/each}</select
        ></label
      >{/if}
    {#if driver === 'postgres'}<label
        >{t('programs.language')}<select bind:value={value.language}
          ><option value="sql">SQL</option><option value="plpgsql">PL/pgSQL</option></select
        ></label
      >{/if}
    {#if driver === 'mysql'}<label
        ><input type="checkbox" bind:checked={value.deterministic} />{t(
          'programs.deterministic',
        )}</label
      >{/if}
    <h3>{t('programs.parameters')}</h3>
    {#each value.parameters ?? [] as parameter, index}
      <div class="parameter">
        <label>{t('programs.name')}<input bind:value={parameter.name} /></label>
        <label
          >{t('programs.mode')}<select bind:value={parameter.mode}
            ><option value="in">IN</option>{#if !(driver === 'mysql' && kind === 'function')}<option
                value="out">OUT</option
              ><option value="inout">INOUT</option>{/if}</select
          ></label
        >
        <label
          >{t('programs.type')}<select bind:value={parameter.type}
            >{#each types as type}<option value={type}>{type}</option>{/each}</select
          ></label
        >
        <button
          type="button"
          onclick={() => (value.parameters = value.parameters?.filter((_, i) => i !== index))}
          >{t('programs.removeParameter')}</button
        >
      </div>
    {/each}
    <button
      type="button"
      disabled={(value.parameters?.length ?? 0) >= 32}
      onclick={() =>
        (value.parameters = [...(value.parameters ?? []), { name: '', mode: 'in', type: 'text' }])}
      >{t('programs.addParameter')}</button
    >
  {/if}
  {#if kind === 'trigger'}
    <label
      >{t('programs.timing')}<select bind:value={value.timing}
        ><option value="before">BEFORE</option><option value="after">AFTER</option
        >{#if driver !== 'mysql'}<option value="instead_of">INSTEAD OF</option>{/if}</select
      ></label
    >
    <label
      >{t('programs.event')}<select bind:value={value.event}
        ><option value="insert">INSERT</option><option value="update">UPDATE</option><option
          value="delete">DELETE</option
        ></select
      ></label
    >
    {#if driver === 'postgres' && value.function}
      <label>{t('programs.functionSchema')}<input bind:value={value.function.schema} /></label>
      <label>{t('programs.functionName')}<input bind:value={value.function.name} /></label>
      <p>{t('programs.functionHint')}</p>
    {/if}
  {/if}
  {#if kind === 'event' && value.schedule}
    <label
      >{t('programs.at')}<input
        bind:value={value.schedule.at}
        placeholder="2030-01-01 00:00:00"
      /></label
    >
    <p>{t('programs.scheduleHint')}</p>
    <label
      >{t('programs.every')}<input
        type="number"
        min="1"
        max="1000000"
        bind:value={value.schedule.every}
      /></label
    >
    <label
      >{t('programs.unit')}<select bind:value={value.schedule.unit}
        >{#each ['second', 'minute', 'hour', 'day', 'week', 'month', 'year'] as unit}<option
            value={unit}>{t(`programs.units.${unit}`)}</option
          >{/each}</select
      ></label
    >
    <label>{t('programs.starts')}<input bind:value={value.schedule.starts} /></label>
    <label>{t('programs.ends')}<input bind:value={value.schedule.ends} /></label>
    <label
      ><input type="checkbox" bind:checked={value.schedule.preserve} />{t(
        'programs.preserve',
      )}</label
    >
    <label
      >{t('programs.status')}<select bind:value={value.status}
        ><option value="disabled">{t('programs.disabled')}</option><option value="enabled"
          >{t('programs.enabled')}</option
        ></select
      ></label
    >
    <p role="alert">{t('programs.eventWarning')}</p>
  {/if}
</fieldset>

<style>
  fieldset,
  label {
    display: grid;
    gap: 0.4rem;
    min-width: 0;
  }
  fieldset {
    border: 0;
    padding: 0;
    gap: 0.75rem;
  }
  input,
  select,
  textarea {
    border: 1px solid var(--border);
    border-radius: 0.3rem;
    padding: 0.4rem;
    min-width: 0;
    max-width: 100%;
  }
  textarea {
    font-family: monospace;
    width: 100%;
  }
  input[type='checkbox'] {
    width: auto;
  }
  .parameter {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  p {
    font-size: 0.85rem;
    overflow-wrap: anywhere;
  }
</style>
