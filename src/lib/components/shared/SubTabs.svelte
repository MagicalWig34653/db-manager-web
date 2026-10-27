<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  // Accessible tab strip (WAI-ARIA tabs pattern): roving tabindex, arrow keys, Home/End.
  // The parent renders the matching role="tabpanel" with id `${idPrefix}-panel` and aria-labelledby `${idPrefix}-tab-${selected}`.
  let {
    tabs,
    selected,
    onselect,
    label,
    idPrefix,
  }: {
    tabs: { id: string; label: string }[];
    selected: string;
    onselect: (id: string) => void;
    label: string;
    idPrefix: string;
  } = $props();

  function onkeydown(event: KeyboardEvent, index: number) {
    const last = tabs.length - 1;
    const target =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : -1;
    if (target < 0) return;
    event.preventDefault();
    onselect(tabs[target].id);
    document.getElementById(`${idPrefix}-tab-${tabs[target].id}`)?.focus();
  }
</script>

<div class="subtabs" role="tablist" aria-label={label}>
  {#each tabs as tab, index (tab.id)}
    <button
      type="button"
      role="tab"
      id={`${idPrefix}-tab-${tab.id}`}
      aria-selected={selected === tab.id}
      aria-controls={`${idPrefix}-panel`}
      tabindex={selected === tab.id ? 0 : -1}
      class="subtab"
      data-testid={`subtab-${tab.id}`}
      onclick={() => onselect(tab.id)}
      onkeydown={(event) => onkeydown(event, index)}>{tab.label}</button
    >
  {/each}
</div>

<style>
  .subtabs {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    padding: 8px 16px 0;
    border-bottom: 1px solid var(--border);
  }
  .subtab {
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--muted-foreground);
    font: inherit;
    font-size: 12px;
    padding: 8px 10px;
    white-space: nowrap;
    cursor: pointer;
  }
  .subtab[aria-selected='true'] {
    color: var(--foreground);
    border-bottom-color: currentColor;
    font-weight: 600;
  }
  .subtab:focus-visible {
    outline: 2px solid var(--ring, currentColor);
    outline-offset: -2px;
  }
</style>
