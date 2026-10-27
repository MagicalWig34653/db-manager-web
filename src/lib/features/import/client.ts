// SPDX-License-Identifier: AGPL-3.0-only
import { ApiClient, ApiError } from '$lib/api';
import * as validators from '$lib/contract/v18/validators.js';
import { t } from '$lib/i18n';
import type { Capabilities, ExecuteRequest, Job, Plan, PlanRequest, Schemas } from './model';

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const JOB_ID = /^[a-f0-9]{32}$/;

export function validate<T extends keyof Schemas & keyof typeof validators>(
  name: T,
  value: unknown,
): Schemas[T] {
  if (!validators[name](value))
    throw new ApiError('invalid_response', t('importData.err.invalidResponse'));
  return value as Schemas[T];
}

export interface UploadHandlers {
  signal: AbortSignal;
  /** Called right before the first byte is handed to the network. */
  onDispatch: () => void;
  onProgress: (loaded: number, total: number) => void;
  /** Called once the whole request body has been sent (the server may then start working). */
  onUploaded: () => void;
}
export interface UploadResponse {
  status: number;
  body: unknown;
}
export type Transport = (
  path: string,
  token: string,
  metadata: unknown,
  file: Blob,
  handlers: UploadHandlers,
) => Promise<UploadResponse>;

/** multipart upload through XMLHttpRequest: fetch has no upload progress. Never follows redirects or sends cookies. */
export const xhrTransport: Transport = (path, token, metadata, file, handlers) =>
  new Promise((resolve, reject) => {
    if (
      typeof location !== 'undefined' &&
      location.protocol !== 'https:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
    ) {
      reject(new ApiError('insecure_origin', t('api.insecure_origin')));
      return;
    }
    if (handlers.signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', file, 'upload');
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.responseType = 'text';
    xhr.timeout = 6 * 60 * 1000;
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.withCredentials = false;
    const abort = () => xhr.abort();
    handlers.signal.addEventListener('abort', abort, { once: true });
    const done = () => handlers.signal.removeEventListener('abort', abort);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) handlers.onProgress(event.loaded, event.total);
    };
    xhr.upload.onload = () => handlers.onUploaded();
    xhr.onprogress = (event) => {
      if (event.loaded > MAX_RESPONSE_BYTES) xhr.abort();
    };
    xhr.onload = () => {
      done();
      const type = xhr.getResponseHeader('content-type') ?? '';
      if (!type.toLowerCase().includes('application/json')) {
        reject(new ApiError('invalid_response', t('importData.err.invalidResponse')));
        return;
      }
      try {
        resolve({ status: xhr.status, body: JSON.parse(xhr.responseText) });
      } catch {
        reject(new ApiError('invalid_response', t('importData.err.invalidResponse')));
      }
    };
    xhr.onerror = () => {
      done();
      reject(new ApiError('network_error', t('api.network_error')));
    };
    xhr.ontimeout = () => {
      done();
      reject(new ApiError('timeout', t('api.timeout')));
    };
    xhr.onabort = () => {
      done();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    handlers.onDispatch();
    xhr.send(form);
  });

/** Public rejection codes of the import routes. Each proves that the request was refused before any work started. */
const REJECTIONS = new Set([
  'invalid_import',
  'invalid_request',
  'invalid_connection',
  'plan_mismatch',
  'confirmation_mismatch',
  'import_too_large',
  'request_too_large',
  'unsupported_media_type',
  'unsupported_feature',
  'import_busy',
  'unauthorized',
  'unsupported_driver',
  'driver_unavailable',
  'insecure_origin',
]);
export const isRejection = (cause: unknown): boolean =>
  cause instanceof ApiError && REJECTIONS.has(cause.code);

export function errorText(cause: unknown): string {
  const code = cause instanceof ApiError ? cause.code : '';
  const known = new Set([
    'invalid_import',
    'plan_mismatch',
    'confirmation_mismatch',
    'import_too_large',
    'request_too_large',
    'import_busy',
    'unsupported_feature',
    'not_found',
    'unauthorized',
    'unsupported_media_type',
    'insecure_origin',
    'network_error',
    'timeout',
    'invalid_response',
    'outcome_unknown',
    'import_not_found',
    'invalid_connection',
    'unsupported_driver',
    'driver_unavailable',
    'database_error',
    'query_canceled',
  ]);
  return t(known.has(code) ? `importData.error.${code}` : 'importData.error.failed');
}

export class ImportClient {
  constructor(
    private api = new ApiClient(),
    private transport: Transport = xhrTransport,
  ) {}

  async capabilities(token: string, signal: AbortSignal): Promise<Capabilities> {
    return validate(
      'ImportCapabilities',
      await this.api.requestRaw('/api/v18/capabilities', token, undefined, signal),
    );
  }

  private async parseError(response: UploadResponse): Promise<never> {
    const failure = (response.body as { error?: { code?: unknown } } | null)?.error;
    if (typeof failure?.code === 'string' && /^[a-z_]{1,64}$/.test(failure.code))
      throw new ApiError(failure.code, errorText(new ApiError(failure.code, '')));
    throw new ApiError('invalid_response', t('importData.err.invalidResponse'));
  }

  async plan(
    metadata: PlanRequest,
    file: Blob,
    token: string,
    handlers: UploadHandlers,
  ): Promise<Plan> {
    validate('ImportPlanRequest', metadata);
    const response = await this.transport('/api/v18/imports/plan', token, metadata, file, handlers);
    if (response.status !== 200) return this.parseError(response);
    const plan = validate('ImportPlan', response.body);
    if (plan.valid_rows > plan.rows || plan.preview.length > plan.valid_rows)
      throw new ApiError('invalid_response', t('importData.err.invalidResponse'));
    return plan;
  }

  /** Resolves with the started job. Any failure after dispatch must be treated as an unknown outcome by the caller. */
  async execute(
    metadata: ExecuteRequest,
    file: Blob,
    token: string,
    handlers: UploadHandlers,
  ): Promise<Job> {
    validate('ImportExecuteRequest', metadata);
    const response = await this.transport(
      '/api/v18/imports/execute',
      token,
      metadata,
      file,
      handlers,
    );
    if (response.status !== 202) return this.parseError(response);
    const job = validate('ImportJob', response.body);
    if (job.state === 'finished' && !job.result)
      throw new ApiError('invalid_response', t('importData.err.invalidResponse'));
    return job;
  }

  async status(id: string, token: string, signal: AbortSignal): Promise<Job> {
    return this.job(id, `/api/v18/imports/${id}`, undefined, token, signal);
  }
  async cancel(id: string, token: string, signal: AbortSignal): Promise<Job> {
    return this.job(id, `/api/v18/imports/${id}/cancel`, {}, token, signal);
  }
  private async job(
    id: string,
    path: string,
    body: unknown,
    token: string,
    signal: AbortSignal,
  ): Promise<Job> {
    if (!JOB_ID.test(id))
      throw new ApiError('invalid_response', t('importData.err.invalidResponse'));
    const job = validate('ImportJob', await this.api.requestRaw(path, token, body, signal));
    if (job.id !== id || (job.state === 'finished') !== !!job.result)
      throw new ApiError('invalid_response', t('importData.err.invalidResponse'));
    return job;
  }
}
export const importClient = new ImportClient();
