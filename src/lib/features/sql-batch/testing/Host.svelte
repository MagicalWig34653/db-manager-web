<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { setShellContext } from '$lib/shell/context';
  import type { Session } from '$lib/shell/session.svelte';
  import type { SqlRunner } from '$lib/shell/sql.svelte';
  import type { FeatureProps } from '$lib/features';
  import BatchPanel from '../BatchPanel.svelte';
  let { session, ...rest }: FeatureProps & { session: Session } = $props();
  setShellContext({ session: untrack(() => session), sql: undefined as unknown as SqlRunner });
</script>

<BatchPanel {...rest} />
