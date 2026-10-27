<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  // Minimal inline SVG line (no chart library). The numbers are also available as text next to it.
  let { points, label }: { points: number[]; label: string } = $props();
  const W = 240;
  const H = 48;
  const path = $derived.by(() => {
    if (points.length < 2) return '';
    const max = Math.max(...points);
    const min = Math.min(...points);
    const span = max - min || 1;
    return points
      .map((value, index) => {
        const x = (index / (points.length - 1)) * (W - 4) + 2;
        const y = H - 4 - ((value - min) / span) * (H - 8);
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  });
</script>

<svg
  viewBox={`0 0 ${W} ${H}`}
  class="sparkline"
  role="img"
  aria-label={label}
  data-testid="sparkline"
  preserveAspectRatio="none"
>
  {#if path}<path d={path} fill="none" stroke="currentColor" stroke-width="1.5" />{/if}
</svg>

<style>
  .sparkline {
    width: 100%;
    max-width: 280px;
    height: 48px;
    color: var(--primary, currentColor);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
</style>
