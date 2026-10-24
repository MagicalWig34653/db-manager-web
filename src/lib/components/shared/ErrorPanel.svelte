<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { TriangleAlert } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { t } from '$lib/i18n';

  let {
    title = t('shared.error'),
    message,
    onretry,
  }: { title?: string; message: string; onretry?: () => void } = $props();
</script>

<div class="feedback error-feedback" role="alert">
  <TriangleAlert size={21} />
  <div>
    <strong>{title}</strong>
    <p>{message}</p>
    {#if onretry}<Button variant="outline" size="sm" onclick={onretry}>{t('shared.retry')}</Button
      >{/if}
  </div>
</div>
