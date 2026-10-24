<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { TriangleAlert } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as Dialog from '$lib/components/ui/dialog';
  import { t } from '$lib/i18n';

  let {
    open = $bindable(false),
    title,
    description = '',
    targetName,
    confirmLabel = t('shared.confirmAction'),
    busy = false,
    onconfirm,
    oncancel,
  }: {
    open?: boolean;
    title: string;
    description?: string;
    /** The exact name the user has to type before the action is enabled. */
    targetName: string;
    confirmLabel?: string;
    busy?: boolean;
    onconfirm: () => void;
    oncancel?: () => void;
  } = $props();
  let typed = $state('');
  const matches = $derived(targetName.length > 0 && typed === targetName);

  $effect(() => {
    if (!open) typed = '';
  });
  function close() {
    open = false;
    oncancel?.();
  }
  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (matches && !busy) onconfirm();
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-[480px] p-7" data-testid="confirm-destructive">
    <Dialog.Header>
      <div class="dialog-mark"><TriangleAlert size={22} /></div>
      <Dialog.Title class="text-xl">{title}</Dialog.Title>
      {#if description}<Dialog.Description>{description}</Dialog.Description>{/if}
    </Dialog.Header>
    <form autocomplete="off" onsubmit={submit}>
      <div class="form-field">
        <label for="confirm-target-name">{t('shared.confirmTypeName', { name: targetName })}</label>
        <Input
          id="confirm-target-name"
          aria-label={t('shared.confirmNameLabel')}
          bind:value={typed}
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
        />
      </div>
      <div class="dialog-actions">
        <Button variant="ghost" type="button" onclick={close}>{t('shared.cancel')}</Button>
        <Button variant="destructive" type="submit" disabled={!matches || busy}
          >{confirmLabel}</Button
        >
      </div>
    </form>
  </Dialog.Content>
</Dialog.Root>
