<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { TriangleAlert } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { toConnection } from '$lib/api';
  import { downloadBlob } from '$lib/features/export/sinks';
  import { t } from '$lib/i18n';
  import type { Snapshot, WritePhase } from '$lib/rows';
  import type { ConnectionDraft } from '$lib/workbench';
  import { bulkClient, errorCode, errorText, isRejection } from './client';
  import { formatKiB, safeFilename, type TableRef } from './model';

  let {
    connection,
    token,
    table,
    expected,
    columns,
    maxBytes,
    disabled = false,
    onwritephase,
    onchanged,
  }: {
    connection: ConnectionDraft;
    token: string;
    table: TableRef;
    /** The row exactly as loaded; the server compares it with the current row (conflict detection). */
    expected: Snapshot;
    /** Binary, writable columns outside the key. */
    columns: string[];
    maxBytes: number;
    disabled?: boolean;
    onwritephase: (phase: WritePhase) => void;
    /** A write was sent: the row on screen is stale. */
    onchanged: () => void;
  } = $props();

  let column = $state('');
  let file = $state<File | null>(null);
  let confirmed = $state(false);
  let busy = $state(false);
  let message = $state('');
  let failure = $state(false);
  let unknown = $state(false);
  let done = $state(false);
  let inputKey = $state(0);
  let controller: AbortController | null = null;
  const chosen = $derived(columns.includes(column) ? column : (columns[0] ?? ''));
  const tooLarge = $derived(!!file && file.size > maxBytes);
  const current = $derived(expected.values[expected.columns.indexOf(chosen)]);
  const hasValue = $derived(!!current && current.kind !== 'null');
  const locked = $derived(disabled || busy || done || unknown);
  const base = $derived({
    connection: toConnection(connection),
    table: { ...table },
    expected: {
      columns: [...expected.columns],
      values: expected.values.map((cell) => ({ ...cell })),
    },
    column: chosen,
    timeout_ms: 10000,
  });

  async function upload() {
    // Synchronous guard: a double activation never sends two writes.
    if (busy || locked || !file || tooLarge || !confirmed || !chosen) return;
    busy = true;
    message = '';
    failure = false;
    controller = new AbortController();
    let sent = false;
    try {
      const result = await bulkClient.upload(
        { ...base, confirm: true },
        file,
        token,
        controller.signal,
        () => {
          sent = true;
          onwritephase('sending');
        },
      );
      onwritephase('settled');
      onchanged();
      done = true;
      message = result.changed ? t('bulk.file.uploaded') : t('bulk.file.unchanged');
    } catch (cause) {
      const unclear = sent && !isRejection(cause);
      if (sent) onwritephase(unclear ? 'unknown' : 'settled');
      if (sent) onchanged();
      if (unclear) {
        unknown = true;
        message = t('bulk.unknown');
      } else {
        failure = true;
        message = errorText(cause);
        if (errorCode(cause) === 'row_conflict') done = true;
      }
    } finally {
      busy = false;
      controller = null;
    }
  }

  async function download(preview: boolean) {
    if (busy || disabled || !chosen) return;
    busy = true;
    message = '';
    failure = false;
    controller = new AbortController();
    try {
      const { bytes, type } = await bulkClient.download(
        { ...base, ...(preview ? { preview: true } : {}) },
        token,
        controller.signal,
      );
      const name = safeFilename(table.name, chosen).replace(
        /\.bin$/,
        preview ? '-preview.png' : '.bin',
      );
      downloadBlob(new Blob([bytes as BlobPart], { type }), name);
      message = t('bulk.file.downloaded', { size: formatKiB(bytes.byteLength) });
    } catch (cause) {
      if (!(cause instanceof DOMException)) {
        failure = true;
        message = errorText(cause);
      }
    } finally {
      busy = false;
      controller = null;
    }
  }
  onDestroy(() => controller?.abort());
</script>

<section class="bulk-grid" aria-label={t('bulk.file.title')} data-testid="file-value-panel">
  <h3>{t('bulk.file.title')}</h3>
  <p class="row-help">{t('bulk.file.help', { limit: formatKiB(maxBytes) })}</p>
  <label
    >{t('bulk.file.column')}<select
      value={chosen}
      onchange={(event) => (column = event.currentTarget.value)}
      disabled={locked}
      data-testid="file-column"
    >
      {#each columns as name (name)}<option value={name}>{name}</option>{/each}
    </select></label
  >
  <div class="bulk-bar">
    <Button
      variant="outline"
      size="sm"
      onclick={() => download(false)}
      disabled={busy || disabled || !hasValue}
      data-testid="file-download">{t('bulk.file.download')}</Button
    >
    <Button
      variant="outline"
      size="sm"
      onclick={() => download(true)}
      disabled={busy || disabled || !hasValue}
      data-testid="file-preview">{t('bulk.file.preview')}</Button
    >
  </div>
  <p class="row-help">{t('bulk.file.previewHelp')}</p>
  {#key inputKey}
    <label
      >{t('bulk.file.choose')}<input
        type="file"
        disabled={locked}
        data-testid="file-input"
        onchange={(event) => {
          file = event.currentTarget.files?.[0] ?? null;
          confirmed = false;
        }}
      /></label
    >
  {/key}
  {#if file}
    <p data-testid="file-info">
      {t('bulk.file.info', { name: file.name, size: formatKiB(file.size) })}
    </p>
    {#if tooLarge}<p role="alert" data-testid="file-too-large">
        {t('bulk.file.tooLarge', { limit: formatKiB(maxBytes) })}
      </p>{/if}
    <label class="check"
      ><input type="checkbox" bind:checked={confirmed} disabled={locked || tooLarge} />{t(
        'bulk.file.confirm',
        { column: chosen },
      )}</label
    >
    <div class="bulk-bar">
      <Button onclick={upload} disabled={locked || tooLarge || !confirmed} data-testid="file-upload"
        >{t('bulk.file.upload')}</Button
      >
      {#if busy}<Button variant="outline" onclick={() => controller?.abort()}
          >{t('bulk.cancel')}</Button
        >{/if}
    </div>
  {/if}
  {#if message}<p
      role={failure || unknown ? 'alert' : 'status'}
      class:bulk-warning={failure || unknown}
      data-testid="file-message"
    >
      {#if failure || unknown}<TriangleAlert size={16} />{/if}{message}
    </p>{/if}
  {#if done}<p>{t('bulk.file.reloadHint')}</p>{/if}
</section>
