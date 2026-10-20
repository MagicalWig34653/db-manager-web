<!-- SPDX-License-Identifier: MIT; source: shadcn-svelte, see src/third-party-notices.txt -->
<script lang="ts">
  import { Dialog as DialogPrimitive } from 'bits-ui';

  let { open = $bindable(false), ...restProps }: DialogPrimitive.RootProps = $props();
</script>

<DialogPrimitive.Root bind:open {...restProps} />
