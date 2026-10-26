<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { FeatureProps } from '$lib/features';
  import type { Session } from '$lib/shell/session.svelte';
  import { setShellContext } from '$lib/shell/context';
  import MaintenancePanel from '../MaintenancePanel.svelte';
  let { session, ...rest }: FeatureProps & { session: Session } = $props();
  setShellContext({ session: untrack(() => session), sql: undefined as never });
</script>

<MaintenancePanel {...rest} />
