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
    /** Fires on every dismissal (cancel button, Escape, backdrop, close icon), not on confirm. */
    oncancel?: () => void;
  } = $props();
  const fieldId = $props.id();
  let typed = $state('');
  let confirmed = false;
  let wasOpen = false;
  let confirmButton = $state<HTMLButtonElement | null>(null);
  const matches = $derived(targetName.length > 0 && typed === targetName);

  $effect(() => {
    if (open) {
      wasOpen = true;
      confirmed = false;
    } else {
      typed = '';
      if (wasOpen && !confirmed) oncancel?.();
      wasOpen = false;
    }
  });
  function confirm() {
    if (!matches || busy) return;
    confirmed = true;
    onconfirm();
  }
  // Enter never confirms. With a matching name it only moves focus to the explicit button.
  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (matches) confirmButton?.focus();
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content
    class="sm:max-w-[480px] p-7"
    data-testid="confirm-destructive"
    onOpenAutoFocus={(event) => {
      // Initial focus on the name field, never on the destructive button.
      event.preventDefault();
      document.getElementById(fieldId)?.focus();
    }}
  >
    <Dialog.Header>
      <div class="dialog-mark"><TriangleAlert size={22} /></div>
      <Dialog.Title class="text-xl">{title}</Dialog.Title>
      {#if description}<Dialog.Description>{description}</Dialog.Description>{/if}
    </Dialog.Header>
    <form autocomplete="off" onsubmit={submit}>
      <div class="form-field">
        <label for={fieldId}>{t('shared.confirmTypeName', { name: targetName })}</label>
        <Input
          id={fieldId}
          bind:value={typed}
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
        />
      </div>
      <div class="dialog-actions">
        <Button variant="ghost" type="button" onclick={() => (open = false)}
          >{t('shared.cancel')}</Button
        >
        <Button
          variant="destructive"
          type="button"
          bind:ref={confirmButton}
          disabled={!matches || busy}
          onclick={confirm}>{confirmLabel}</Button
        >
      </div>
    </form>
  </Dialog.Content>
</Dialog.Root>
