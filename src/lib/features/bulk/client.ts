// SPDX-License-Identifier: AGPL-3.0-only
import { ApiClient, ApiError } from '$lib/api';
import * as validators from '$lib/contract/v19/validators.js';
import { t } from '$lib/i18n';
import {
  MAX_FILE_BYTES,
  reasonKey,
  type BulkResult,
  type Capabilities,
  type ExecuteRequest,
  type FileValueRequest,
  type FileValueUpload,
  type LookupRequest,
  type LookupResult,
  type Plan,
  type PlanRequest,
  type Schemas,
} from './model';
import { readJson, send, type Fetcher } from './transport';

export function validate<T extends keyof Schemas & keyof typeof validators>(
  name: T,
  value: unknown,
): Schemas[T] {
  if (!validators[name](value))
    throw new ApiError('invalid_response', t('bulk.err.invalidResponse'));
  return value as Schemas[T];
}

/** Codes that prove the request was refused before any write: everything else after a dispatch is an unknown outcome. */
const REJECTIONS = new Set([
  'invalid_bulk',
  'invalid_mutation',
  'invalid_request',
  'invalid_file',
  'file_too_large',
  'request_too_large',
  'unsupported_media_type',
  'unsupported_feature',
  'unsupported_file_value',
  'unsupported_file_column',
  'unsupported_preview',
  'unsupported_lookup',
  'mutation_not_supported',
  'plan_conflict',
  'row_conflict',
  'unauthorized',
  'insecure_origin',
  'not_found',
]);
export const isRejection = (cause: unknown): boolean =>
  cause instanceof ApiError && REJECTIONS.has(cause.code);

export const errorText = (cause: unknown): string =>
  t(reasonKey(cause instanceof ApiError ? cause.code : ''));
export const errorCode = (cause: unknown): string => (cause instanceof ApiError ? cause.code : '');

async function failure(sent: Awaited<ReturnType<typeof send>>, write: boolean): Promise<never> {
  const body = await readJson(sent, write);
  const error = validate('Error', body);
  const code = /^[a-z_]{1,64}$/.test(error.error.code) ? error.error.code : 'unknown';
  throw new ApiError(code, t(reasonKey(code)));
}

export class BulkClient {
  constructor(
    private fetcher: Fetcher = globalThis.fetch.bind(globalThis),
    private api: ApiClient = new ApiClient(fetcher),
  ) {}

  async capabilities(token: string, signal: AbortSignal): Promise<Capabilities> {
    try {
      return validate(
        'RowsBulkCapabilities',
        await this.api.requestRaw('/api/v19/capabilities', token, undefined, signal),
      );
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'not_found')
        throw new ApiError('unsupported_feature', t('bulk.reason.unsupported_feature'));
      throw cause;
    }
  }

  async plan(request: PlanRequest, token: string, signal: AbortSignal): Promise<Plan> {
    validate('RowsBulkPlanRequest', request);
    const sent = await send(
      this.fetcher,
      '/api/v19/rows/plan',
      { json: request },
      { token, signal },
    );
    if (sent.status !== 200) return failure(sent, false);
    return validate('RowsBulkPlan', await readJson(sent, false, signal));
  }

  /**
   * Returns the typed result for 200 and for the 4xx/5xx statuses that carry one (rejected / outcome_unknown).
   * Everything else throws; after the dispatch the caller treats anything but a known rejection as unknown.
   */
  async execute(
    request: ExecuteRequest,
    token: string,
    signal: AbortSignal,
    onDispatch: () => void,
  ): Promise<BulkResult> {
    validate('RowsBulkExecuteRequest', request);
    const sent = await send(
      this.fetcher,
      '/api/v19/rows/execute',
      { json: request },
      { token, signal, onDispatch },
    );
    const body = await readJson(sent, true);
    if (body && typeof body === 'object' && 'outcome' in body) {
      const result = validate('RowsBulkResult', body);
      if (
        result.rows.length > request.rows.length ||
        result.rows.some((row) => row.index >= request.rows.length)
      )
        throw new ApiError('invalid_response', t('bulk.err.invalidResponse'));
      return result;
    }
    const error = validate('Error', body);
    const code = /^[a-z_]{1,64}$/.test(error.error.code) ? error.error.code : 'unknown';
    throw new ApiError(code, t(reasonKey(code)));
  }

  async lookup(request: LookupRequest, token: string, signal: AbortSignal): Promise<LookupResult> {
    validate('ForeignKeyLookupRequest', request);
    const sent = await send(
      this.fetcher,
      '/api/v19/foreign-keys/lookup',
      { json: request },
      { token, signal },
    );
    if (sent.status !== 200) return failure(sent, false);
    const result = validate('ForeignKeyLookupResult', await readJson(sent, false, signal));
    if (result.display_column !== request.display_column)
      throw new ApiError('invalid_response', t('bulk.err.invalidResponse'));
    return result;
  }

  /** Metadata part first, then exactly one file part. A failure after the dispatch is an unknown outcome. */
  async upload(
    metadata: FileValueUpload,
    file: Blob,
    token: string,
    signal: AbortSignal,
    onDispatch: () => void,
  ): Promise<Schemas['MutationResult']> {
    validate('FileValueUploadRequest', metadata);
    if (file.size > MAX_FILE_BYTES)
      throw new ApiError('file_too_large', t('bulk.reason.file_too_large'));
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', file, 'value');
    const sent = await send(
      this.fetcher,
      '/api/v19/values/upload',
      { form },
      { token, signal, onDispatch },
    );
    if (sent.status !== 200) return failure(sent, true);
    return validate('MutationResult', await readJson(sent, true));
  }

  /** Authenticated download of the current value; the bytes are checked against Content-Length and the 512 KiB limit. */
  async download(
    request: FileValueRequest,
    token: string,
    signal: AbortSignal,
  ): Promise<{ bytes: Uint8Array; type: string }> {
    validate('FileValueRequest', request);
    const sent = await send(
      this.fetcher,
      '/api/v19/values/download',
      { json: request },
      { token, signal, timeoutMs: 60_000 },
    );
    if (sent.status !== 200) return failure(sent, false);
    const expected = Number(sent.headers.get('content-length'));
    const type = (sent.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (
      !Number.isInteger(expected) ||
      expected < 0 ||
      expected > MAX_FILE_BYTES ||
      !['application/octet-stream', 'image/png'].includes(type)
    )
      throw new ApiError('invalid_response', t('bulk.err.invalidResponse'));
    const reader = sent.response.body?.getReader();
    if (!reader) throw new ApiError('invalid_response', t('bulk.err.invalidResponse'));
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > expected) {
          await reader.cancel();
          throw new ApiError('invalid_response', t('bulk.err.invalidResponse'));
        }
        chunks.push(value);
      }
    } catch (cause) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (cause instanceof ApiError) throw cause;
      throw new ApiError('network_error', t('api.interrupted'));
    } finally {
      reader.releaseLock();
    }
    // An interrupted stream is only visible as fewer bytes than announced: never hand out a partial file.
    if (size !== expected) throw new ApiError('network_error', t('bulk.err.incompleteDownload'));
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { bytes, type };
  }
}
export const bulkClient = new BulkClient();
