// SPDX-License-Identifier: AGPL-3.0-only
// Client for the read-only overview API 0.7 (databases, objects, definition, server info).
import { ApiClient, ApiError, toConnection } from '$lib/api';
import type { ConnectionDraft } from '$lib/workbench';
import { t } from '$lib/i18n';
import * as validators from '$lib/contract/v7/validators.js';
import type { components } from '$lib/contract/v7/api-types';

export type OverviewSchemas = components['schemas'];
export type DatabasesResult = OverviewSchemas['DatabasesResult'];
export type DatabaseInfo = OverviewSchemas['DatabaseInfo'];
export type ObjectsResult = OverviewSchemas['ObjectsResult'];
export type ObjectInfo = OverviewSchemas['ObjectInfo'];
export type DefinitionResult = OverviewSchemas['DefinitionResult'];
export type ServerInfoResult = OverviewSchemas['ServerInfoResult'];
export type OverviewCapabilities = OverviewSchemas['OverviewCapabilities'];
export type DriverCapabilities = OverviewSchemas['OverviewDriverCapabilities'];
export type FeatureKey = 'databases' | 'objects' | 'definition' | 'server_info' | 'exact_rows';

const invalid = (name: string) =>
  new ApiError('invalid_response', t('overview.errInvalidResponse', { name }));

const overviewErrorKeys: Record<string, string> = {
  invalid_overview: 'overview.errInvalidOverview',
  object_not_found: 'overview.errObjectNotFound',
  unsupported_feature: 'overview.errUnsupportedFeature',
};
const overviewError = (code: string) => new ApiError(code, t(overviewErrorKeys[code]));

/** Replaces generic backend texts for the codes that only exist since API 0.7. */
function mapError(cause: unknown): unknown {
  if (cause instanceof ApiError && cause.code in overviewErrorKeys)
    return overviewError(cause.code);
  return cause;
}

export function validate<T extends keyof OverviewSchemas>(
  name: T,
  data: unknown,
): OverviewSchemas[T] {
  const check = validators[name] as (value: unknown) => boolean;
  if (!check(data)) throw invalid(name);
  return data as OverviewSchemas[T];
}

export interface ObjectsQuery {
  schema?: string;
  limit?: number;
  offset?: number;
  exactRows?: boolean;
  timeoutMs?: number;
}

export class OverviewClient {
  constructor(private client = new ApiClient()) {}

  private async post<T extends keyof OverviewSchemas>(
    path: string,
    name: T,
    body: unknown,
    token: string,
    signal?: AbortSignal,
  ): Promise<OverviewSchemas[T]> {
    try {
      return validate(name, await this.client.requestRaw(path, token, body, signal));
    } catch (cause) {
      throw mapError(cause);
    }
  }

  async capabilities(token: string, signal?: AbortSignal): Promise<OverviewCapabilities> {
    try {
      return validate(
        'OverviewCapabilities',
        await this.client.requestRaw('/api/v7/capabilities', token, undefined, signal),
      );
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'not_found')
        throw new ApiError('unsupported_feature', t('overview.errNoV7'));
      throw mapError(cause);
    }
  }

  databases(
    connection: ConnectionDraft,
    token: string,
    query: { limit?: number; offset?: number } = {},
    signal?: AbortSignal,
  ): Promise<DatabasesResult> {
    return this.post(
      '/api/v7/databases',
      'DatabasesResult',
      { connection: toConnection(connection), ...query },
      token,
      signal,
    );
  }

  objects(
    connection: ConnectionDraft,
    token: string,
    query: ObjectsQuery = {},
    signal?: AbortSignal,
  ): Promise<ObjectsResult> {
    const { schema, limit, offset, exactRows, timeoutMs } = query;
    return this.post(
      '/api/v7/objects',
      'ObjectsResult',
      {
        connection: toConnection(connection),
        ...(schema ? { schema } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(offset ? { offset } : {}),
        ...(exactRows ? { exact_rows: true } : {}),
        ...(timeoutMs !== undefined ? { timeout_ms: timeoutMs } : {}),
      },
      token,
      signal,
    );
  }

  definition(
    connection: ConnectionDraft,
    token: string,
    object: { schema?: string; name: string },
    signal?: AbortSignal,
  ): Promise<DefinitionResult> {
    // The transport reports every 404 as "not offered"; for a definition it means "object gone".
    return this.post(
      '/api/v7/definition',
      'DefinitionResult',
      {
        connection: toConnection(connection),
        object: { ...(object.schema ? { schema: object.schema } : {}), name: object.name },
      },
      token,
      signal,
    ).catch((cause: unknown) => {
      if (cause instanceof ApiError && cause.code === 'not_found')
        throw overviewError('object_not_found');
      throw cause;
    });
  }

  serverInfo(
    connection: ConnectionDraft,
    token: string,
    signal?: AbortSignal,
  ): Promise<ServerInfoResult> {
    return this.post(
      '/api/v7/server-info',
      'ServerInfoResult',
      { connection: toConnection(connection) },
      token,
      signal,
    );
  }
}

export const overviewClient = new OverviewClient();

/** Capability entry of the current driver for one function. */
export function driverCapability(
  capabilities: OverviewCapabilities,
  connection: ConnectionDraft,
  feature: FeatureKey,
): { support: 'supported' | 'limited' | 'unsupported'; reason?: string } {
  const key = connection.driver === 'postgresql' ? 'postgres' : connection.driver;
  return capabilities.drivers[key][feature];
}

const numberFormat = new Intl.NumberFormat('de-DE');
export const formatCount = (value: number) => numberFormat.format(value);

export function formatBytes(value: number | null): string {
  if (value === null) return '';
  if (value < 1024) return `${numberFormat.format(value)} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(size)} ${units[unit]}`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days) parts.push(`${days} d`);
  if (hours || days) parts.push(`${hours} h`);
  parts.push(`${minutes} min`);
  return parts.join(' ');
}

export type RowsDisplay = { text: string; state: 'estimated' | 'exact' | 'unknown' };
export function rowsDisplay(rows: ObjectInfo['rows']): RowsDisplay {
  if (rows.value === null || rows.state === 'unknown') return { text: '', state: 'unknown' };
  return { text: formatCount(rows.value), state: rows.state };
}

export type ObjectSort = 'name' | 'kind' | 'rows' | 'engine' | 'collation' | 'size';
export interface ObjectFilter {
  text: string;
  kind: 'all' | 'table' | 'view' | 'other';
}

const isView = (kind: string) => kind.includes('view');
export function matchesKind(kind: string, filter: ObjectFilter['kind']): boolean {
  if (filter === 'all') return true;
  if (filter === 'view') return isView(kind);
  if (filter === 'table') return kind === 'table';
  return kind !== 'table' && !isView(kind);
}

/** Filters and sorts a loaded page; the input is never mutated. Unknown values sort last. */
export function arrangeObjects(
  objects: readonly ObjectInfo[],
  filter: ObjectFilter,
  sort: ObjectSort,
  descending: boolean,
): ObjectInfo[] {
  const needle = filter.text.trim().toLowerCase();
  const kept = objects.filter(
    (object) =>
      matchesKind(object.kind, filter.kind) &&
      (needle === '' || `${object.schema}.${object.name}`.toLowerCase().includes(needle)),
  );
  const key = (object: ObjectInfo): string | number | null => {
    switch (sort) {
      case 'name':
        return `${object.schema}\u0000${object.name}`;
      case 'kind':
        return object.kind;
      case 'rows':
        return object.rows.state === 'unknown' ? null : object.rows.value;
      case 'engine':
        return object.engine;
      case 'collation':
        return object.collation;
      case 'size':
        return object.size_bytes;
    }
  };
  const direction = descending ? -1 : 1;
  return kept
    .map((object, index) => ({ object, index, value: key(object) }))
    .sort((a, b) => {
      if (a.value === null || b.value === null) {
        if (a.value === b.value) return a.index - b.index;
        return a.value === null ? 1 : -1;
      }
      const order =
        typeof a.value === 'number' && typeof b.value === 'number'
          ? a.value - b.value
          : String(a.value).localeCompare(String(b.value), 'de');
      return order * direction || a.index - b.index;
    })
    .map((entry) => entry.object);
}
