<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import TableWorkbench from '$lib/components/TableWorkbench.svelte';
  import type { FeatureProps } from '$lib/features';
  import { recordRecent } from '$lib/features/config-store/record';
  import { configStoreFor } from '$lib/features/config-store/store.svelte';

  let { connection, token, object, onsql, onwritephase }: FeatureProps = $props();
  // Writes of the config store (recently used) take part in the session write lock while this tab is open.
  $effect(() => configStoreFor(token).observe((phase) => onwritephase(phase)));
  // Server mode only; the call returns immediately in local mode.
  $effect(() => {
    if (connection && object) void recordRecent(connection, token, object).catch(() => {});
  });
</script>

{#if connection && object}
  {#key object}<TableWorkbench {connection} {token} {object} {onsql} {onwritephase} />{/key}
{/if}
