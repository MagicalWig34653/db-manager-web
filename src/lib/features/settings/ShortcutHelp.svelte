<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog';
  import { t } from '$lib/i18n';
  import type { Shortcut } from '$lib/shell/shortcuts';
  let { shortcuts, open = $bindable(false) }: { shortcuts: Shortcut[]; open?: boolean } = $props();
</script>

<Dialog.Root bind:open>
  <Dialog.Trigger class="shortcut-help-button">{t('settings.shortcuts')}</Dialog.Trigger>
  <Dialog.Content showCloseButton={false}>
    <Dialog.Header
      ><Dialog.Title>{t('settings.shortcuts')}</Dialog.Title><Dialog.Description
        >{t('settings.shortcutsHint')}</Dialog.Description
      ></Dialog.Header
    >
    <dl class="shortcut-list">
      {#each shortcuts.filter((shortcut) => shortcut.titleKey) as shortcut (shortcut.id)}
        <div>
          <dt>
            {t(shortcut.titleKey!)}
            {#if shortcut.scopeKey}<small>({t(shortcut.scopeKey)})</small>{/if}
          </dt>
          <dd><kbd>{shortcut.mod ? '⌘ / Ctrl + ' : ''}{shortcut.key}</kbd></dd>
        </div>
      {/each}
    </dl>
    <Dialog.Close>{t('shared.close')}</Dialog.Close>
  </Dialog.Content>
</Dialog.Root>
