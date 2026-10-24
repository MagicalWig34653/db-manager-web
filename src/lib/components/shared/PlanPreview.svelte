<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { TriangleAlert } from '@lucide/svelte';
  import { t } from '$lib/i18n';

  let {
    statements,
    warnings = [],
    planSha256 = '',
  }: {
    statements: string[];
    warnings?: string[];
    planSha256?: string;
  } = $props();
</script>

<section class="plan-preview" aria-label={t('shared.planTitle')}>
  <h3>{t('shared.planTitle')}</h3>
  <p class="plan-note">{t('shared.planReadonly')}</p>
  {#if statements.length === 0}
    <p>{t('shared.planEmpty')}</p>
  {:else}
    <ol class="plan-statements">
      {#each statements as statement, index (index)}
        <li><pre><code>{statement}</code></pre></li>
      {/each}
    </ol>
  {/if}
  {#if warnings.length}
    <div class="plan-warnings" role="alert">
      <strong><TriangleAlert size={16} />{t('shared.planWarnings')}</strong>
      <ul>
        {#each warnings as warning, index (index)}<li>{warning}</li>{/each}
      </ul>
    </div>
  {/if}
  {#if planSha256}
    <p class="plan-hash">{t('shared.planHash')}: <code>{planSha256}</code></p>
  {/if}
</section>

<style>
  .plan-preview {
    display: grid;
    gap: 0.5rem;
    min-width: 0;
  }
  .plan-statements {
    display: grid;
    gap: 0.5rem;
    margin: 0;
    padding-left: 1.25rem;
  }
  pre {
    margin: 0;
    padding: 0.5rem 0.75rem;
    overflow-x: auto;
    border-radius: 0.5rem;
    background: var(--muted);
    font-size: 0.8125rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: text;
  }
  .plan-hash {
    overflow-wrap: anywhere;
    font-size: 0.75rem;
  }
  .plan-warnings {
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid var(--border);
  }
</style>
