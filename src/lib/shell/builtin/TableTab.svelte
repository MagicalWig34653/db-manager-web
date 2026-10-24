<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import TableWorkbench from '$lib/components/TableWorkbench.svelte';
  import type { FeatureProps } from '$lib/features';

  let { connection, token, object, onsql, onwritephase }: FeatureProps = $props();
</script>

{#if connection && object}
  {#key object}<TableWorkbench {connection} {token} {object} {onsql} {onwritephase} />{/key}
{/if}
