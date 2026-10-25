<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { setShellContext } from '$lib/shell/context';
  import type { Session } from '$lib/shell/session.svelte';
  import ActionCard from '../ActionCard.svelte';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let { session, ...rest }: { session: Session; [key: string]: any } = $props();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setShellContext({ session: untrack(() => session), sql: undefined as any });
</script>

<!-- eslint-disable-next-line @typescript-eslint/no-explicit-any -->
<ActionCard {...rest as any} />
