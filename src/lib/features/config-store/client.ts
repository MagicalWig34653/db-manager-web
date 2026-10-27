// SPDX-License-Identifier: AGPL-3.0-only
// Typed client for the server-side configuration store (API 0.24, /api/v24). All answers are validated against the
// vendored contract; server texts are never shown (only the stable error code is mapped to catalog text), and no
// request or response body is ever echoed into an error.
import * as validators from '$lib/contract/v24/validators.js';
import type { components } from '$lib/contract/v24/api-types';

export type Schemas = components['schemas'];
export type Kind = Schemas['ConfigKind'];
export type Item = Schemas['ConfigItem'];
export type Capabilities = Schemas['ConfigCapabilities'];
export const KINDS: readonly Kind[] = [
  'history',
  'bookmarks',
  'searches',
  'favorites',
  'recents',
  'settings',
  'layouts',
];

export class ConfigError extends Error {
  constructor(
    public code: string,
    public status = 0,
    public retryAfter = 0,
  ) {
    super(code);
    this.name = 'ConfigError';
  }
}
/** Failures after which the server state may be reachable again later: writes are buffered, not lost. */
export const isOutage = (cause: unknown) =>
  cause instanceof ConfigError &&
  ['state_unavailable', 'network_error', 'timeout', 'outcome_unknown'].includes(cause.code);
export const errorCode = (cause: unknown) => (cause instanceof ConfigError ? cause.code : 'error');

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = 1024 * 1024;

async function readText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
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
        throw new ConfigError('result_too_large', response.status);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return text;
}

interface Options {
  body?: unknown;
  ifMatch?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}
type Check<T> = (value: unknown) => value is T;

export class ConfigClient {
  constructor(private fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {}

  /** One HTTP exchange; returns status and the response text (empty for 204). */
  private async send(method: string, path: string, token: string, options: Options = {}) {
    if (
      typeof location !== 'undefined' &&
      location.protocol !== 'https:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
    )
      throw new ConfigError('insecure_origin');
    const serialized = options.body === undefined ? undefined : JSON.stringify(options.body);
    if (
      serialized !== undefined &&
      new TextEncoder().encode(serialized).byteLength > MAX_REQUEST_BYTES
    )
      throw new ConfigError('request_too_large');
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const write = method !== 'GET';
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 30000);
    const combined = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    let response: Response;
    let text: string;
    try {
      response = await this.fetcher(path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(serialized === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(options.ifMatch === undefined ? {} : { 'If-Match': `"${options.ifMatch}"` }),
        },
        ...(serialized === undefined ? {} : { body: serialized }),
        signal: combined,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      });
      text = await readText(response);
    } catch (cause) {
      if (cause instanceof ConfigError) throw cause;
      if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      // After sending, a lost answer cannot prove that a write did not commit.
      if (write) throw new ConfigError('outcome_unknown');
      throw new ConfigError(combined.aborted ? 'timeout' : 'network_error');
    }
    if (!response.ok) {
      let code = '';
      try {
        const parsed: unknown = JSON.parse(text);
        if (validators.Error(parsed)) code = parsed.error.code;
      } catch {
        /* keep the generic code below */
      }
      const retry = Number(response.headers.get('Retry-After'));
      if (response.status === 503) code = 'state_unavailable';
      if (!code) code = response.status === 404 ? 'not_found' : 'rejected';
      throw new ConfigError(code, response.status, Number.isFinite(retry) ? retry : 0);
    }
    return { status: response.status, text };
  }

  private async json<T>(
    check: Check<T>,
    method: string,
    path: string,
    token: string,
    options?: Options,
  ) {
    const { status, text } = await this.send(method, path, token, options);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ConfigError(method === 'GET' ? 'invalid_response' : 'outcome_unknown', status);
    }
    if (!check(payload))
      throw new ConfigError(method === 'GET' ? 'invalid_response' : 'outcome_unknown', status);
    return { status, payload };
  }

  async capabilities(token: string, signal?: AbortSignal) {
    return (
      // Short timeout: until this answers, the UI does not know which storage to offer.
      (
        await this.json(validators.ConfigCapabilities, 'GET', '/api/v24/capabilities', token, {
          signal,
          timeoutMs: 6000,
        })
      ).payload
    );
  }
  async status(token: string, signal?: AbortSignal) {
    return (
      await this.json(validators.ConfigStatus, 'GET', '/api/v24/config/status', token, { signal })
    ).payload;
  }
  async list(
    token: string,
    kind: Kind,
    query: { scope?: string; key?: string; limit?: number; cursor?: string } = {},
    signal?: AbortSignal,
  ) {
    const params = new URLSearchParams();
    if (query.scope !== undefined) params.set('scope', query.scope);
    if (query.key !== undefined) params.set('key', query.key);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.cursor) params.set('cursor', query.cursor);
    const suffix = params.size ? `?${params}` : '';
    return (
      await this.json(validators.ConfigList, 'GET', `/api/v24/config/${kind}${suffix}`, token, {
        signal,
      })
    ).payload;
  }
  async get(token: string, kind: Kind, id: string, signal?: AbortSignal) {
    return (
      await this.json(
        validators.ConfigItem,
        'GET',
        `/api/v24/config/${kind}/${encodeURIComponent(id)}`,
        token,
        { signal },
      )
    ).payload;
  }
  /** `created` is false when the server returned an already existing idempotent entry. */
  async create(
    token: string,
    kind: Kind,
    body: Schemas['ConfigCreateRequest'],
    signal?: AbortSignal,
  ) {
    if (!validators.ConfigCreateRequest(body)) throw new ConfigError('invalid_request');
    const { status, payload } = await this.json(
      validators.ConfigItem,
      'POST',
      `/api/v24/config/${kind}`,
      token,
      { body, signal },
    );
    return { item: payload, created: status === 201 };
  }
  /** If-Match is always sent: the server answers 428 without it, and 412 for a stale version. */
  async update(
    token: string,
    kind: Kind,
    id: string,
    version: number,
    data: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    const body = { data };
    if (!validators.ConfigUpdateRequest(body)) throw new ConfigError('invalid_request');
    return (
      await this.json(
        validators.ConfigItem,
        'PUT',
        `/api/v24/config/${kind}/${encodeURIComponent(id)}`,
        token,
        { body, ifMatch: version, signal },
      )
    ).payload;
  }
  async remove(token: string, kind: Kind, id: string, version: number, signal?: AbortSignal) {
    await this.send('DELETE', `/api/v24/config/${kind}/${encodeURIComponent(id)}`, token, {
      ifMatch: version,
      signal,
    });
  }
  async importItems(token: string, body: Schemas['ConfigImportRequest'], signal?: AbortSignal) {
    if (!validators.ConfigImportRequest(body)) throw new ConfigError('invalid_request');
    return (
      await this.json(validators.ConfigImportResult, 'POST', '/api/v24/config/import', token, {
        body,
        signal,
      })
    ).payload;
  }
  /** Returns the validated export document as the server sent it (for download); never parsed further. */
  async exportText(token: string, signal?: AbortSignal) {
    const { text } = await this.send('GET', '/api/v24/config/export', token, { signal });
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ConfigError('invalid_response');
    }
    if (!validators.ConfigExport(payload)) throw new ConfigError('invalid_response');
    return { text, count: payload.items.length };
  }
  async clearPlan(token: string, body: Schemas['ConfigClearPlanRequest'], signal?: AbortSignal) {
    if (!validators.ConfigClearPlanRequest(body)) throw new ConfigError('invalid_request');
    return (
      await this.json(validators.ConfigClearPlan, 'POST', '/api/v24/config/clear/plan', token, {
        body,
        signal,
      })
    ).payload;
  }
  async clearExecute(token: string, body: Schemas['ConfigClearExecuteRequest']) {
    if (!validators.ConfigClearExecuteRequest(body)) throw new ConfigError('invalid_request');
    return (
      await this.json(
        validators.ConfigClearResult,
        'POST',
        '/api/v24/config/clear/execute',
        token,
        {
          body,
        },
      )
    ).payload;
  }
}
export const configClient = new ConfigClient();
