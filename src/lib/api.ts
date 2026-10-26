// SPDX-License-Identifier: AGPL-3.0-only
import { t } from './i18n';
import * as validators from './contract/validators.js';
import type { components } from './contract/api-types';
import type { ConnectionDraft, Driver } from './workbench';

type Schemas = components['schemas'];
type SchemaName = keyof Schemas;
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export function validatePayload<T extends SchemaName>(name: T, value: unknown): Schemas[T] {
  if (!validators[name](value))
    throw new ApiError('invalid_response', errorText('invalid_response'));
  return value as Schemas[T];
}
export function apiDriver(driver: Driver): Schemas['Connection']['driver'] {
  return driver === 'postgresql' ? 'postgres' : driver;
}
export function toConnection(draft: ConnectionDraft): Schemas['Connection'] {
  if (draft.driver === 'sqlite') return { driver: 'sqlite', database: draft.database.trim() };
  return {
    driver: apiDriver(draft.driver),
    database: draft.database.trim(),
    host: draft.host.trim(),
    port: draft.port,
    username: draft.username,
    password: draft.password,
    tls_mode: 'verify-full',
  };
}
// Error texts come from the i18n catalog (api.*) at throw time, so they follow the selected language.
const knownErrors = new Set([
  'unauthorized',
  'invalid_request',
  'invalid_connection',
  'query_canceled',
  'database_error',
  'row_conflict',
  'insert_conflict',
  'outcome_unknown',
  'unsupported_table',
  'unsupported_inheritance',
  'unsupported_identity',
  'invalid_changes',
  'database_busy',
  'table_not_found',
  'unsupported_driver',
  'driver_unavailable',
  'result_too_large',
  'request_too_large',
]);
const errorText = (code: string, params: Record<string, string | number> = {}) =>
  t(`api.${code}`, params);
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
async function readJson(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new ApiError('invalid_response', errorText('notJson'));
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError('invalid_response', errorText('emptyBody'));
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ApiError('result_too_large', errorText('result_too_large'));
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('invalid_response', errorText('unreadable'));
  }
}
export class ApiClient {
  constructor(private fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {}
  async request<T extends SchemaName>(
    path: string,
    schema: T,
    token: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<Schemas[T]> {
    return validatePayload(schema, await this.requestRaw(path, token, body, signal));
  }
  async requestRaw(
    path: string,
    token: string,
    body?: unknown,
    signal?: AbortSignal,
    write?: { onDispatch: () => void },
  ): Promise<unknown> {
    if (
      typeof location !== 'undefined' &&
      location.protocol !== 'https:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
    ) {
      throw new ApiError('insecure_origin', errorText('insecure_origin'));
    }
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    if (serialized !== undefined && new TextEncoder().encode(serialized).byteLength > 1024 * 1024) {
      throw new ApiError('request_too_large', errorText('request_too_large'));
    }
    if (signal?.aborted) throw new DOMException(errorText('aborted'), 'AbortError');
    const timeout = AbortSignal.timeout(
      write || ['/api/v1/query', '/api/v2/tables/browse'].includes(path) ? 75000 : 15000,
    );
    const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;
    let response: Response;
    try {
      write?.onDispatch();
      response = await this.fetcher(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(serialized === undefined ? {} : { body: serialized }),
        signal: combined,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      });
    } catch {
      if (write) throw new ApiError('outcome_unknown', errorText('outcome_unknown'));
      if (signal?.aborted) throw new DOMException(errorText('aborted'), 'AbortError');
      if (combined.aborted) throw new ApiError('timeout', errorText('timeout'));
      throw new ApiError('network_error', errorText('network_error'));
    }
    if (response.status === 404) {
      throw new ApiError('not_found', errorText('not_found'));
    }
    let payload: unknown;
    try {
      payload = await readJson(response);
    } catch (cause) {
      if (write) throw new ApiError('outcome_unknown', errorText('outcome_unknown'));
      if (signal?.aborted) throw new DOMException(errorText('aborted'), 'AbortError');
      if (combined.aborted) throw new ApiError('timeout', errorText('timeout'));
      if (cause instanceof ApiError) throw cause;
      throw new ApiError('network_error', errorText('interrupted'));
    }
    if (!response.ok) {
      const failure = validatePayload('Error', payload);
      throw new ApiError(
        failure.error.code,
        knownErrors.has(failure.error.code)
          ? errorText(failure.error.code)
          : errorText('rejectedHttp', { status: response.status }),
      );
    }
    return payload;
  }
  capabilities(token: string, signal?: AbortSignal) {
    return this.request('/api/v1/capabilities', 'Capabilities', token, undefined, signal);
  }
  test(connection: Schemas['Connection'], token: string, signal?: AbortSignal) {
    try {
      validatePayload('Connection', connection);
    } catch {
      throw new ApiError('invalid_connection', errorText('invalid_connection'));
    }
    return this.request('/api/v1/connections/test', 'Status', token, { connection }, signal);
  }
  catalog(connection: Schemas['Connection'], token: string, signal?: AbortSignal) {
    try {
      validatePayload('Connection', connection);
    } catch {
      throw new ApiError('invalid_connection', errorText('invalid_connection'));
    }
    return this.request('/api/v1/catalog', 'CatalogResult', token, { connection }, signal);
  }
  query(input: Schemas['QueryRequest'], token: string, signal: AbortSignal) {
    try {
      validatePayload('QueryRequest', input);
    } catch {
      throw new ApiError('invalid_request', errorText('invalid_request'));
    }
    return this.request('/api/v1/query', 'QueryResult', token, input, signal);
  }
}
