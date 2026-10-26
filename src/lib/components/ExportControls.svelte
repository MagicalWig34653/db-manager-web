<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t } from '$lib/i18n';
  import { Button } from '$lib/components/ui/button';
  import { encodeExport, type ExportScope, type ExportFormat } from '$lib/export';
  import type { DisplayResult } from '$lib/workbench';
  let { result, scope }: { result: DisplayResult; scope: ExportScope } = $props();
  let format = $state<ExportFormat>('json');
  let error = $state('');
  let url: string | null = null;
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  function cleanup() {
    if (cleanupTimer) clearTimeout(cleanupTimer);
    if (url) URL.revokeObjectURL(url);
    url = null;
  }
  function download() {
    error = '';
    cleanup();
    try {
      const output = encodeExport(result, scope, format);
      const blob = new Blob([output.bytes], { type: output.mime });
      url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = output.filename;
      anchor.hidden = true;
      document.body.append(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
      }
      cleanupTimer = setTimeout(cleanup, 30000);
    } catch (cause) {
      cleanup();
      error = cause instanceof Error ? cause.message : t('exportControls.failed');
    }
  }
  onDestroy(cleanup);
</script>

<div class="result-export" aria-label={t('exportControls.region')}>
  <div class="export-actions">
    <label
      >{t('exportControls.format')}<select
        aria-label={t('exportControls.format')}
        bind:value={format}
      >
        <option value="json">{t('exportControls.json')}</option>
        <option value="csv-spreadsheet">{t('exportControls.csvSpreadsheet')}</option>
        <option value="csv-raw">{t('exportControls.csvRaw')}</option>
      </select></label
    >
    <Button variant="outline" size="sm" onclick={download}>{t('exportControls.download')}</Button>
  </div>
  <p>
    {scope.kind === 'table_page'
      ? t('exportControls.scopePage', { count: result.rows.length, start: scope.offset + 1 }) +
        (scope.has_more ? t('exportControls.scopeMore') : '')
      : t('exportControls.scopeResult', { count: result.rows.length })}{result.truncated
      ? t('exportControls.truncated')
      : ''}{t('exportControls.noQuery')}
  </p>
  {#if format !== 'json'}<p>{t('exportControls.csvLoss')}</p>{/if}
  {#if format === 'csv-spreadsheet'}<p>
      {t('exportControls.csvSpreadsheetNote')}
    </p>{:else if format === 'csv-raw'}<p class="export-warning">
      {t('exportControls.csvRawNote')}
    </p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
</div>
