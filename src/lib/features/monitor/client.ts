// SPDX-License-Identifier: AGPL-3.0-only
// Client for the read-only monitor API 0.20. Authorization and rights problems are errors; only an
// answer with state "unavailable" means that a source is really absent or not readable.
import { ApiClient, ApiError, toConnection } from '$lib/api';
import * as validators from '$lib/contract/v20/validators.js';
import { t } from '$lib/i18n';
import type { ConnectionDraft } from '$lib/workbench';
import {
  consistent,
  type Action,
  type Capabilities,
  type MonitorRequest,
  type MonitorResult,
} from './model';

export interface MonitorQuery {
  limit?: number;
  offset?: number;
  log?: string;
  position?: number;
  sql?: string;
}

const errorKeys: Record<string, string> = {
  unauthorized: 'monitor.errUnauthorized',
  not_found: 'monitor.errNotOffered',
  unsupported_feature: 'monitor.errUnsupported',
  database_error: 'monitor.errDatabase',
  query_canceled: 'monitor.errCanceled',
  timeout: 'monitor.errTimeout',
  network_error: 'monitor.errNetwork',
  invalid_response: 'monitor.errInvalidResponse',
  invalid_request: 'monitor.errInvalidRequest',
  invalid_monitor: 'monitor.errInvalidMonitor',
  invalid_connection: 'monitor.errInvalidConnection',
  result_too_large: 'monitor.errTooLarge',
  request_too_large: 'monitor.errTooLarge',
  database_busy: 'monitor.errBusy',
};

export function errorMessage(cause: unknown): string {
  const code = cause instanceof ApiError ? cause.code : '';
  return t(errorKeys[code] ?? 'monitor.errGeneric');
}

async function localized<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (cause) {
    if (cause instanceof ApiError) throw new ApiError(cause.code, errorMessage(cause));
    throw cause;
  }
}

const invalid = () => new ApiError('invalid_response', t('monitor.errInvalidResponse'));

export class MonitorClient {
  constructor(private client = new ApiClient()) {}

  capabilities(token: string, signal?: AbortSignal): Promise<Capabilities> {
    return localized(async () => {
      const payload = await this.client.requestRaw(
        '/api/v20/capabilities',
        token,
        undefined,
        signal,
      );
      if (!validators.MonitorCapabilities(payload)) throw invalid();
      return payload;
    });
  }

  async run(
    action: Action,
    connection: ConnectionDraft,
    token: string,
    query: MonitorQuery = {},
    signal?: AbortSignal,
  ): Promise<MonitorResult> {
    const limit = query.limit ?? 0;
    const offset = query.offset ?? 0;
    const body: MonitorRequest = {
      connection: toConnection(connection),
      ...(limit ? { limit } : {}),
      ...(offset ? { offset } : {}),
      ...(query.log !== undefined ? { log: query.log } : {}),
      ...(query.position !== undefined ? { position: query.position } : {}),
      ...(query.sql !== undefined ? { sql: query.sql } : {}),
    };
    if (!validators.MonitorRequest(body))
      throw new ApiError('invalid_request', t('monitor.errInvalidRequest'));
    const payload = await localized(() =>
      this.client.requestRaw(`/api/v20/monitor/${action}`, token, body, signal),
    );
    if (
      !validators.MonitorResult(payload) ||
      !consistent(payload, { action, driver: connection.driver, offset, limit })
    )
      throw invalid();
    return payload;
  }
}

export const monitorClient = new MonitorClient();
