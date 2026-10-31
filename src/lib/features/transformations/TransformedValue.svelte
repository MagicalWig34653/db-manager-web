<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  // Renders the result of a display transformation. Everything is a text node or a plain attribute: no {@html}, no
  // innerHTML. A link is only rendered for a target that safeHttpUrl accepted (http/https, no credentials).
  import { t } from '$lib/i18n';
  import TransformImage from './TransformImage.svelte';
  import type { Output } from './transforms';
  let {
    output,
    compact = false,
    imageWidth = 160,
  }: { output: Output; compact?: boolean; imageWidth?: number } = $props();
  const lines = $derived(
    output.kind === 'pre' && compact ? output.text.split('\n').slice(0, 2).join(' ⏎ ') : '',
  );
</script>

{#if output.kind === 'text'}<span class="transform-text">{output.text}</span
  >{:else if output.kind === 'link'}<a
    class="transform-link"
    href={output.href}
    target="_blank"
    rel="noopener noreferrer">{output.href}</a
  >{:else if output.kind === 'marked'}<span class="transform-text"
    >{#each output.parts as part}{#if part.mark}<mark>{part.text}</mark
        >{:else}{part.text}{/if}{/each}</span
  >{:else if output.kind === 'pre'}{#if compact}<span class="transform-text">{lines}</span
    >{:else}<pre class="transform-pre">{output.text}</pre>
    {#if output.note}<span class="transform-note">{output.note}</span
      >{/if}{/if}{:else if output.kind === 'image'}<TransformImage
    bytes={output.bytes}
    mime={output.mime}
    width={output.width}
    height={output.height}
    maxWidth={imageWidth}
    label={t('transform.imageLabel', { type: output.mime.replace('image/', '').toUpperCase() })}
  />{:else}<span class="transform-note">{t(`transform.raw.${output.reason}`)}</span>{/if}
