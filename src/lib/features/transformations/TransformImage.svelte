<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  // Draws a recognized raster image (PNG, JPEG, GIF, WebP from BLOB bytes) on a canvas. The bitmap is decoded locally
  // from the bytes: no URL is ever created or loaded, so no network request and no CSP image source is involved.
  import { t } from '$lib/i18n';
  import type { ImageMime } from './image';
  let {
    bytes,
    mime,
    width,
    height,
    maxWidth = 160,
    label,
  }: {
    bytes: Uint8Array;
    mime: ImageMime;
    width: number;
    height: number;
    maxWidth?: number;
    label: string;
  } = $props();
  let canvas = $state<HTMLCanvasElement>();
  let failed = $state(false);
  const scale = $derived(Math.min(1, maxWidth / width));
  $effect(() => {
    const target = canvas;
    if (!target) return;
    let cancelled = false;
    failed = false;
    void (async () => {
      let bitmap: ImageBitmap | undefined;
      try {
        if (typeof createImageBitmap !== 'function') throw new Error('unsupported');
        bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
        if (cancelled) return;
        target.width = Math.max(1, Math.round(bitmap.width * scale));
        target.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = target.getContext('2d');
        if (!context) throw new Error('no canvas');
        context.drawImage(bitmap, 0, 0, target.width, target.height);
      } catch {
        if (!cancelled) failed = true;
      } finally {
        bitmap?.close();
      }
    })();
    return () => {
      cancelled = true;
    };
  });
</script>

{#if failed}<span class="transform-note">{t('transform.imageFailed')}</span
  >{:else}<span role="img" aria-label={label}
    ><canvas
      bind:this={canvas}
      class="transform-image"
      aria-hidden="true"
      width={Math.max(1, Math.round(width * scale))}
      height={Math.max(1, Math.round(height * scale))}
    ></canvas></span
  >{/if}
