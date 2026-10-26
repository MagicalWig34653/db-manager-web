<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { t } from '$lib/i18n';
  import type { Schemas } from './model';
  let { items, truncated }: { items: Schemas['ProgramDependency'][]; truncated: boolean } =
    $props();
</script>

<section aria-label={t('programs.dependencies')}>
  <h3>{t('programs.dependencies')}</h3>
  <p>{t('programs.dependencyHint')}</p>
  {#if truncated}<p role="alert">{t('programs.truncated')}</p>{/if}
  <ul>
    {#each items as item}<li>
        {t(`programs.${item.direction}`)}: {item.object.schema ?? ''}.{item.object.name} ({t(
          `programs.kinds.${item.object.kind}`,
        )}; {t(`programs.${item.certainty}`)}) {item.object.identity ?? ''}
      </li>{/each}
  </ul>
</section>

<style>
  li {
    overflow-wrap: anywhere;
  }
</style>
