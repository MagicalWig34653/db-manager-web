<script lang="ts">
  import { Code2, ArrowUpRight } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
</script>

<Dialog.Root>
  <Dialog.Trigger class="source-trigger"><Code2 size={14} />Quellcode &amp; Lizenzen</Dialog.Trigger
  >
  <Dialog.Content class="sm:max-w-[520px] p-7">
    <Dialog.Header>
      <div class="dialog-mark"><Code2 size={22} /></div>
      <Dialog.Title class="text-xl">Quellcode &amp; Lizenzen</Dialog.Title>
      <Dialog.Description>DB Manager ist freie Software unter AGPL-3.0-only.</Dialog.Description>
    </Dialog.Header>
    <nav class="source-links" aria-label="Quellcode und Lizenztexte">
      <a href={__WEB_SOURCE_URL__} target="_blank" rel="noopener noreferrer"
        >Web-Quellcode dieses Builds <ArrowUpRight size={16} /></a
      >
      <a
        href="https://github.com/MagicalWig34653/db-manager"
        target="_blank"
        rel="noopener noreferrer">Go-Serverprojekt <ArrowUpRight size={16} /></a
      >
      <a
        href="https://github.com/MagicalWig34653/db-manager/blob/main/docs/WEBBUILD.md"
        target="_blank"
        rel="noopener noreferrer">Herkunft des Serverbuilds <ArrowUpRight size={16} /></a
      >
      <a href="/LICENSE.txt" target="_blank" rel="noopener noreferrer"
        >AGPL-Lizenztext <ArrowUpRight size={16} /></a
      >
      <a href="/THIRD-PARTY-NOTICES.txt" target="_blank" rel="noopener noreferrer"
        >Lizenzen der verwendeten Bibliotheken <ArrowUpRight size={16} /></a
      >
    </nav>
    <p class="source-note">
      Der Web-Quellcode verweist auf den festgelegten Stand dieses Builds. Die Bibliotheken behalten
      ihre eigenen Lizenzen.
    </p>
    <Dialog.Footer
      ><Dialog.Close class="source-close">Zurück zum Arbeitsplatz</Dialog.Close></Dialog.Footer
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
