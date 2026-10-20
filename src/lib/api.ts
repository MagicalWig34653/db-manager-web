// SPDX-License-Identifier: AGPL-3.0-only
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
    throw new ApiError('invalid_response', 'Das Backend hat eine ungültige Antwort geliefert.');
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
const errorMessages: Record<string, string> = {
  unauthorized:
    'Der Zugriffstoken fehlt oder ist ungültig. Öffne „Backend-Zugang“ und prüfe deinen Token.',
  invalid_request: 'Die Anfrage ist ungültig. Prüfe Datenbankname, Verbindungsangaben und SQL.',
  invalid_connection: 'Die Verbindungsangaben sind ungültig. Prüfe Host, Port und Datenbankname.',
  query_canceled:
    'Die Abfrage wurde abgebrochen oder ihr Zeitlimit wurde erreicht. Bereits ausgeführte Änderungen können bestehen bleiben.',
  database_error:
    'Die Datenbankoperation ist fehlgeschlagen. Prüfe Verbindung, SQL und Datenbankrechte.',
  unsupported_driver: 'Dieses Datenbanksystem ist auf dem Backend nicht verfügbar.',
  driver_unavailable: 'Dieses Datenbanksystem ist auf dem Backend nicht verfügbar.',
  result_too_large:
    'Das Ergebnis ist zu groß. Grenze Zeilen und Spalten in deiner Abfrage weiter ein.',
  request_too_large: 'Die Anfrage ist zu groß. Kürze die SQL-Anweisung.',
};
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
async function readJson(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new ApiError(
      'invalid_response',
      'Die Antwort des Backends ist kein gültiges Datenformat. Prüfe die Adresse deiner Instanz.',
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError('invalid_response', 'Die Antwort des Backends ist leer.');
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
        throw new ApiError('result_too_large', errorMessages.result_too_large);
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
    throw new ApiError('invalid_response', 'Das Backend hat eine unlesbare Antwort geliefert.');
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
    if (
      typeof location !== 'undefined' &&
      location.protocol !== 'https:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
    ) {
      throw new ApiError(
        'insecure_origin',
        'Für den Zugriff auf entfernte Instanzen ist HTTPS erforderlich. Öffne die gesicherte Adresse deiner Instanz.',
      );
    }
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    if (serialized !== undefined && new TextEncoder().encode(serialized).byteLength > 1024 * 1024) {
      throw new ApiError('request_too_large', errorMessages.request_too_large);
    }
    if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
    const timeout = AbortSignal.timeout(path === '/api/v1/query' ? 75000 : 15000);
    const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;
    let response: Response;
    try {
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
      if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
      if (combined.aborted)
        throw new ApiError(
          'timeout',
          'Das Backend antwortet nicht rechtzeitig. Prüfe den Verbindungsstatus.',
        );
      throw new ApiError(
        'network_error',
        'Das Backend ist nicht erreichbar. Prüfe, ob deine Instanz läuft.',
      );
    }
    let payload: unknown;
    try {
      payload = await readJson(response);
    } catch (cause) {
      if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
      if (combined.aborted)
        throw new ApiError(
          'timeout',
          'Das Backend antwortet nicht rechtzeitig. Prüfe den Verbindungsstatus.',
        );
      if (cause instanceof ApiError) throw cause;
      throw new ApiError(
        'network_error',
        'Die Verbindung wurde während der Übertragung unterbrochen. Der Ausführungsstatus muss geprüft werden.',
      );
    }
    if (!response.ok) {
      const failure = validatePayload('Error', payload);
      throw new ApiError(
        failure.error.code,
        errorMessages[failure.error.code] ??
          `Die Anfrage wurde abgewiesen (HTTP ${response.status}). Prüfe Verbindung und Berechtigungen.`,
      );
    }
    return validatePayload(schema, payload);
  }
  capabilities(token: string, signal?: AbortSignal) {
    return this.request('/api/v1/capabilities', 'Capabilities', token, undefined, signal);
  }
  test(connection: Schemas['Connection'], token: string, signal?: AbortSignal) {
    try {
      validatePayload('Connection', connection);
    } catch {
      throw new ApiError('invalid_connection', errorMessages.invalid_connection);
    }
    return this.request('/api/v1/connections/test', 'Status', token, { connection }, signal);
  }
  catalog(connection: Schemas['Connection'], token: string, signal?: AbortSignal) {
    try {
      validatePayload('Connection', connection);
    } catch {
      throw new ApiError('invalid_connection', errorMessages.invalid_connection);
    }
    return this.request('/api/v1/catalog', 'CatalogResult', token, { connection }, signal);
  }
  query(input: Schemas['QueryRequest'], token: string, signal: AbortSignal) {
    try {
      validatePayload('QueryRequest', input);
    } catch {
      throw new ApiError('invalid_request', errorMessages.invalid_request);
    }
    return this.request('/api/v1/query', 'QueryResult', token, input, signal);
  }
}
