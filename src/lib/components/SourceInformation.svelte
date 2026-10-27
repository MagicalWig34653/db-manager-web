<script lang="ts">
  import { Code2, ArrowUpRight } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { t } from '$lib/i18n';
</script>

<Dialog.Root>
  <Dialog.Trigger class="source-trigger"><Code2 size={14} />{t('sourceInfo.title')}</Dialog.Trigger>
  <Dialog.Content class="sm:max-w-[520px] p-7">
    <Dialog.Header>
      <div class="dialog-mark"><Code2 size={22} /></div>
      <Dialog.Title class="text-xl">{t('sourceInfo.title')}</Dialog.Title>
      <Dialog.Description>{t('sourceInfo.free')}</Dialog.Description>
    </Dialog.Header>
    <nav class="source-links" aria-label={t('sourceInfo.navLabel')}>
      <a href={__WEB_SOURCE_URL__} target="_blank" rel="noopener noreferrer"
        >{t('sourceInfo.web')} <ArrowUpRight size={16} /></a
      >
      <a
        href="https://github.com/MagicalWig34653/db-manager"
        target="_blank"
        rel="noopener noreferrer">{t('sourceInfo.server')} <ArrowUpRight size={16} /></a
      >
      <a
        href="https://github.com/MagicalWig34653/db-manager/blob/main/docs/WEBBUILD.md"
        target="_blank"
        rel="noopener noreferrer">{t('sourceInfo.origin')} <ArrowUpRight size={16} /></a
      >
      <a href="/LICENSE.txt" target="_blank" rel="noopener noreferrer"
        >{t('sourceInfo.agpl')} <ArrowUpRight size={16} /></a
      >
      <a href="/THIRD-PARTY-NOTICES.txt" target="_blank" rel="noopener noreferrer"
        >{t('sourceInfo.third')} <ArrowUpRight size={16} /></a
      >
    </nav>
    <p class="source-note">
      {t('sourceInfo.note')}
    </p>
    <Dialog.Footer
      ><Dialog.Close class="source-close">{t('sourceInfo.back')}</Dialog.Close></Dialog.Footer
    >
  </Dialog.Content>
</Dialog.Root>

<style>
  :global(.source-trigger) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font: inherit;
    color: var(--text-secondary, #52627b);
    cursor: pointer;
  }
  :global(.source-trigger:hover) {
    color: #315ada;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  :global(.source-trigger:focus-visible),
  .source-links a:focus-visible {
    outline: 2px solid #315ada;
    outline-offset: 4px;
    border-radius: 4px;
  }
  .source-links {
    display: grid;
    gap: 3px;
    margin: 8px 0;
  }
  .source-links a {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 11px 8px;
    border-radius: 7px;
    color: #315ada;
    font-size: 13px;
  }
  .source-links a:hover {
    background: #f1f5fc;
  }
  .source-links :global(svg) {
    flex-shrink: 0;
  }
  :global(.source-close) {
    padding: 9px 14px;
    border: 1px solid #d9e0eb;
    border-radius: 7px;
    font-size: 13px;
    cursor: pointer;
  }
  .source-note {
    color: #65758c;
    font-size: 12px;
    line-height: 1.6;
  }
</style>
