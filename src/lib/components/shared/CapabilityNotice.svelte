<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { CircleHelp } from '@lucide/svelte';
  import { t } from '$lib/i18n';

  let {
    title = t('shared.unsupported'),
    reason = t('shared.unsupportedReason'),
  }: { title?: string; reason?: string } = $props();
</script>

<div class="feedback capability-notice" role="status">
  <CircleHelp size={20} />
  <div>
    <strong>{title}</strong>
    <p>{reason}</p>
  </div>
</div>
