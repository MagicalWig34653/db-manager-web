<script lang="ts">
  import { onDestroy } from 'svelte';
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
      error = cause instanceof Error ? cause.message : 'Die Datei konnte nicht erzeugt werden.';
    }
  }
  onDestroy(cleanup);
</script>

<div class="result-export" aria-label="Sichtbares Ergebnis exportieren">
  <div class="export-actions">
    <label
      >Exportformat<select aria-label="Exportformat" bind:value={format}>
        <option value="json">JSON · verlustlos typisiert</option>
        <option value="csv-spreadsheet">CSV · mit Apostrophpräfix</option>
        <option value="csv-raw">CSV · unveränderte Rohwerte</option>
      </select></label
    >
    <Button variant="outline" size="sm" onclick={download}>Ergebnis herunterladen</Button>
  </div>
  <p>
    {scope.kind === 'table_page'
      ? `Nur geladene Seite: ${result.rows.length} Zeilen ab Position ${scope.offset + 1}. Kein vollständiger Tabellenexport.${scope.has_more ? ' Weitere Zeilen sind vorhanden.' : ''}`
      : `Nur dieses angezeigte Ergebnis: ${result.rows.length} Zeilen.`}{result.truncated
      ? ' Ergebnis gekürzt; nicht alle Datensätze enthalten.'
      : ''} Keine zusätzliche Abfrage.
  </p>
  {#if format !== 'json'}<p>
      CSV verliert Zelltypen. NULL: ungequotetes \N; Text „\N“: gequotet. UTF-8, Komma, CRLF,
      Binärwerte als Base64. Für verlustlosen Austausch JSON verwenden.
    </p>{/if}
  {#if format === 'csv-spreadsheet'}<p>
      Jeder Spaltenname und Nicht-NULL-Wert erhält ein Apostrophpräfix. Das verändert die Daten;
      keine allgemeine Sicherheits- oder Excel-Roundtripgarantie.
    </p>{:else if format === 'csv-raw'}<p class="export-warning">
      Rohwerte bleiben unverändert. Tabellenkalkulationen können Werte als Formeln ausführen. Nur
      bewusst in geeigneten Programmen öffnen.
    </p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
</div>
