// SPDX-License-Identifier: AGPL-3.0-only
// Small fetch layer for the v19 routes. ApiClient only returns bodies of 2xx answers; the bulk execute route returns
// a typed result body with 4xx/5xx statuses, downloads return bytes and uploads are multipart.
import { ApiError } from '$lib/api';
import { t } from '$lib/i18n';

export const MAX_JSON_BYTES = 8 * 1024 * 1024;

export interface Sent {
  status: number;
  headers: Headers;
  response: Response;
}
export interface SendOptions {
  token: string;
  signal?: AbortSignal;
  /** Marks a write: called right before the request leaves; failures after that are an unknown outcome. */
  onDispatch?: () => void;
  timeoutMs?: number;
}

export type Fetcher = typeof fetch;

export async function send(
  fetcher: Fetcher,
  path: string,
  init: { json?: unknown; form?: FormData },
  options: SendOptions,
): Promise<Sent> {
  if (
    typeof location !== 'undefined' &&
    location.protocol !== 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
  )
    throw new ApiError('insecure_origin', t('api.insecure_origin'));
  const serialized = init.json === undefined ? undefined : JSON.stringify(init.json);
  if (serialized !== undefined && new TextEncoder().encode(serialized).byteLength > 1024 * 1024)
    throw new ApiError('request_too_large', t('api.request_too_large'));
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const timeout = AbortSignal.timeout(options.timeoutMs ?? (options.onDispatch ? 75_000 : 20_000));
  const combined = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  let response: Response;
  try {
    options.onDispatch?.();
    response = await fetcher(path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.token}`,
        ...(serialized === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: serialized ?? init.form,
      signal: combined,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    if (options.onDispatch) throw new ApiError('outcome_unknown', t('api.outcome_unknown'));
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (combined.aborted) throw new ApiError('timeout', t('api.timeout'));
    throw new ApiError('network_error', t('api.network_error'));
  }
  return { status: response.status, headers: response.headers, response };
}

/** Reads a JSON body with the 8 MiB cap; failures of a write are an unknown outcome, reads are plain errors. */
export async function readJson(sent: Sent, write: boolean, signal?: AbortSignal): Promise<unknown> {
  const fail = (code: string, key: string) => {
    if (write) return new ApiError('outcome_unknown', t('api.outcome_unknown'));
    return new ApiError(code, t(key));
  };
  if (!sent.headers.get('content-type')?.toLowerCase().includes('application/json'))
    throw fail('invalid_response', 'api.notJson');
  const reader = sent.response.body?.getReader();
  if (!reader) throw fail('invalid_response', 'api.emptyBody');
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_JSON_BYTES) {
        await reader.cancel();
        throw new ApiError('result_too_large', t('api.result_too_large'));
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (cause) {
    if (cause instanceof ApiError && !write) throw cause;
    if (signal?.aborted && !write) throw new DOMException('Aborted', 'AbortError');
    throw fail('network_error', 'api.interrupted');
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(text);
  } catch {
    throw fail('invalid_response', 'api.unreadable');
  }
}
