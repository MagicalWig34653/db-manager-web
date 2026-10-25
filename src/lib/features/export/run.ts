// SPDX-License-Identifier: AGPL-3.0-only
// Transport of one export: POST with Bearer header (never a token in the URL), streamed body,
// completion check on the decoded stream, and a sink that only ever receives a "commit" for a
// verified-complete export. Anything else ends in an ExportError and the sink is aborted.
import type { components } from '$lib/contract/v11/api-types';
import * as validators from '$lib/contract/v11/validators.js';
import { t } from '$lib/i18n';
import { CompletionVerifier, type ExportFormat } from './verify';

export type ExportRequest = components['schemas']['ExportRequest'];
export type ExportCapabilities = components['schemas']['ExportCapabilities'];

export type ExportErrorKind =
  | 'rejected' // refused before the first byte (HTTP error)
  | 'incomplete' // stream ended without the closing marker
  | 'canceled'
  | 'timeout'
  | 'network'
  | 'client_limit';

export class ExportError extends Error {
  constructor(
    public kind: ExportErrorKind,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ExportError';
  }
}

/** Public error codes of the export routes, with German explanations. */
export function codeMessage(code: string): string {
  const keys: Record<string, string> = {
    invalid_export: 'exportDump.err.invalid_export',
    invalid_request: 'exportDump.err.invalid_export',
    invalid_connection: 'exportDump.err.invalid_connection',
    unsupported_feature: 'exportDump.err.unsupported_feature',
    export_busy: 'exportDump.err.export_busy',
    query_canceled: 'exportDump.err.query_canceled',
    export_row_limit: 'exportDump.err.export_row_limit',
    export_byte_limit: 'exportDump.err.export_byte_limit',
    export_statement_limit: 'exportDump.err.export_statement_limit',
    export_nontransactional: 'exportDump.err.export_nontransactional',
    export_schema_changed: 'exportDump.err.export_schema_changed',
    export_denied: 'exportDump.err.export_denied',
    database_error: 'exportDump.err.database_error',
    unauthorized: 'exportDump.err.unauthorized',
    export_failed: 'exportDump.err.export_failed',
    not_found: 'exportDump.err.not_found',
    result_too_large: 'exportDump.err.export_byte_limit',
    request_too_large: 'exportDump.err.request_too_large',
  };
  return t(keys[code] ?? 'exportDump.err.unknown');
}

/** Receives the bytes of the raw download (still compressed when gzip was requested). */
export interface ExportSink {
  write(chunk: Uint8Array): Promise<void>;
  /** Called exactly once, only after the stream was verified as complete. */
  commit(filename: string): Promise<void>;
  /** Discards everything written so far; must never leave a usable partial file. */
  abort(): Promise<void>;
}

export interface RunOptions {
  request: ExportRequest;
  token: string;
  signal: AbortSignal;
  sink: ExportSink;
  onProgress?: (rawBytes: number) => void;
  fetcher?: typeof fetch;
}

export interface ExportOutcome {
  filename: string;
  rawBytes: number;
  decodedBytes: number;
  snapshot: string | null;
}

const fallbackExtension: Record<string, string> = {
  sql: 'sql',
  csv: 'csv',
  'excel-csv': 'csv',
  json: 'json',
};

export function defaultFilename(request: ExportRequest): string {
  const base = request.filename ?? `export.${fallbackExtension[request.format ?? 'sql']}`;
  return request.gzip ? `${base}.gz` : base;
}

/** Reduces a Content-Disposition filename to a harmless base name (no path, no control characters). */
export function safeFilename(header: string | null, fallback: string): string {
  const match = header ? /filename\*?=(?:UTF-8'')?"?([^";]*)"?/i.exec(header) : null;
  let name = match?.[1] ?? '';
  try {
    name = decodeURIComponent(name);
  } catch {
    /* keep the raw value; it is reduced below anyway */
  }
  name = name.split(/[\\/]/).pop() ?? '';
  name = name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[.]+/, '');
  if (name.length > 150) name = name.slice(0, 150);
  return name === '' ? fallback : name;
}

async function errorFromResponse(response: Response): Promise<ExportError> {
  let code = response.status === 404 ? 'not_found' : response.status === 401 ? 'unauthorized' : '';
  try {
    const text = (await response.text()).slice(0, 65536);
    const parsed = JSON.parse(text) as { error?: { code?: unknown } };
    if (typeof parsed.error?.code === 'string' && /^[a-z_]{1,64}$/.test(parsed.error.code))
      code = parsed.error.code;
  } catch {
    /* body is not our error JSON */
  }
  if (code === '') code = response.status === 503 ? 'export_busy' : 'export_failed';
  return new ExportError('rejected', code, codeMessage(code));
}

const incomplete = (reason: string) =>
  new ExportError('incomplete', reason, t('exportDump.incompleteBody'));

export async function runExport(options: RunOptions): Promise<ExportOutcome> {
  const { request, token, signal, sink } = options;
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  const fail = async (error: ExportError): Promise<never> => {
    await sink.abort().catch(() => undefined);
    throw error;
  };
  if (!validators.ExportRequest(request))
    return fail(new ExportError('rejected', 'invalid_export', codeMessage('invalid_export')));
  if (
    typeof location !== 'undefined' &&
    location.protocol !== 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
  )
    return fail(new ExportError('rejected', 'insecure_origin', t('exportDump.err.insecure')));
  if (signal.aborted)
    return fail(new ExportError('canceled', 'canceled', t('exportDump.canceled')));

  // The server stops at timeout_ms (plus a 5 s grace for the failure trailer); guard against a hang.
  const limit = AbortSignal.timeout((request.timeout_ms || 60000) + 20000);
  const combined = AbortSignal.any([signal, limit]);
  const classify = (cause: unknown): ExportError => {
    if (signal.aborted) return new ExportError('canceled', 'canceled', t('exportDump.canceled'));
    if (limit.aborted)
      return new ExportError('timeout', 'timeout', t('exportDump.err.client_timeout'));
    if (cause instanceof ExportError) return cause;
    return new ExportError('network', 'network_error', t('exportDump.err.network'));
  };

  let response: Response;
  try {
    response = await fetcher('/api/v11/export', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: combined,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
  } catch (cause) {
    return fail(classify(cause));
  }
  if (!response.ok) return fail(await errorFromResponse(response));
  if (!response.body) return fail(incomplete('no_body'));

  const filename = safeFilename(
    response.headers.get('Content-Disposition'),
    defaultFilename(request),
  );
  const verifier = new CompletionVerifier((request.format ?? 'sql') as ExportFormat);
  const [forSink, forVerifier] = response.body.tee();
  let rawBytes = 0;
  const sinkReader = forSink.getReader();
  const decoded = request.gzip
    ? forVerifier.pipeThrough(new DecompressionStream('gzip'))
    : forVerifier;
  const verifyReader = decoded.getReader();
  // Do not rely on the transport to error the body when the user cancels or the guard fires.
  const stop = () => {
    void sinkReader.cancel(combined.reason).catch(() => undefined);
    void verifyReader.cancel(combined.reason).catch(() => undefined);
  };
  combined.addEventListener('abort', stop, { once: true });
  const writing = (async () => {
    const reader = sinkReader;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      await sink.write(value);
      rawBytes += value.length;
      options.onProgress?.(rawBytes);
    }
  })();
  const checking = (async () => {
    const reader = verifyReader;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      verifier.push(value);
    }
  })();
  const [written, checked] = await Promise.allSettled([writing, checking]);
  combined.removeEventListener('abort', stop);
  if (signal.aborted || limit.aborted) return fail(classify(undefined));
  if (written.status === 'rejected') {
    void verifyReader.cancel().catch(() => undefined);
    return fail(classify(written.reason));
  }
  if (checked.status === 'rejected') {
    if (signal.aborted || limit.aborted) return fail(classify(checked.reason));
    // A cut connection or a damaged/truncated gzip container: never a finished export.
    return fail(incomplete(request.gzip ? 'gzip' : 'transport'));
  }
  const verdict = verifier.finish();
  if (!verdict.complete) return fail(incomplete(verdict.reason ?? 'no_marker'));
  try {
    await sink.commit(filename);
  } catch (cause) {
    return fail(
      cause instanceof ExportError
        ? cause
        : new ExportError('network', 'save_failed', t('exportDump.err.save')),
    );
  }
  return {
    filename,
    rawBytes,
    decodedBytes: verifier.bytes,
    snapshot: response.headers.get('X-Export-Snapshot'),
  };
}
