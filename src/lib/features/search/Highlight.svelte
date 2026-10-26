<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { highlight, type Mode } from './model';
  let { value, term, mode }: { value: string; term: string; mode: Mode } = $props();
</script>

{#each highlight(value, term, mode) as part, i (i)}{#if part.hit}<mark>{part.text}</mark
    >{:else}{part.text}{/if}{/each}
