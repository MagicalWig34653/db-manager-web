// SPDX-License-Identifier: AGPL-3.0-only
// Client for the read-only server administration API 0.17 (status, variables, processes).
// There is deliberately no SET, KILL or FLUSH: the contract offers none.
import { ApiClient, ApiError, toConnection } from '$lib/api';
import * as validators from '$lib/contract/v17/validators.js';
import { t } from '$lib/i18n';
import type { ConnectionDraft } from '$lib/workbench';
import {
  consistent,
  type Capabilities,
  type Kind,
  type ReadRequest,
  type ReadResult,
  type Scope,
} from './model';

export interface ReadQuery {
  limit?: number;
  offset?: number;
  filter?: string;
  scope?: Scope;
  timeoutMs?: number;
}

const errorKeys: Record<string, string> = {
  unauthorized: 'serverAdmin.errUnauthorized',
  not_found: 'serverAdmin.errNotOffered',
  unsupported_feature: 'serverAdmin.errUnsupported',
  unsupported_action: 'serverAdmin.errUnsupported',
  database_error: 'serverAdmin.errDatabase',
  query_canceled: 'serverAdmin.errCanceled',
  timeout: 'serverAdmin.errTimeout',
  network_error: 'serverAdmin.errNetwork',
  invalid_response: 'serverAdmin.errInvalidResponse',
  invalid_request: 'serverAdmin.errInvalidRequest',
  invalid_server_admin: 'serverAdmin.errInvalidRequest',
  invalid_connection: 'serverAdmin.errInvalidConnection',
  result_too_large: 'serverAdmin.errTooLarge',
  request_too_large: 'serverAdmin.errTooLarge',
  database_busy: 'serverAdmin.errBusy',
};

/** Localised message per error code; authorization and rights errors are errors, never "empty". */
export function errorMessage(cause: unknown): string {
  const code = cause instanceof ApiError ? cause.code : '';
  return t(errorKeys[code] ?? 'serverAdmin.errGeneric');
}

/** Runs a request and replaces the transport's error text by this feature's localised text. */
async function localized<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (cause) {
    if (cause instanceof ApiError) throw new ApiError(cause.code, errorMessage(cause));
    throw cause;
  }
}

const invalid = () => new ApiError('invalid_response', t('serverAdmin.errInvalidResponse'));

export class ServerAdminClient {
  constructor(private client = new ApiClient()) {}

  async capabilities(token: string, signal?: AbortSignal): Promise<Capabilities> {
    return localized(async () => {
      const payload = await this.client.requestRaw(
        '/api/v17/capabilities',
        token,
        undefined,
        signal,
      );
      if (!validators.ServerAdminCapabilities(payload)) throw invalid();
      return payload;
    });
  }

  async read(
    kind: Kind,
    connection: ConnectionDraft,
    token: string,
    query: ReadQuery = {},
    signal?: AbortSignal,
  ): Promise<ReadResult> {
    const limit = query.limit ?? 0;
    const offset = query.offset ?? 0;
    const body: ReadRequest = {
      connection: toConnection(connection),
      ...(limit ? { limit } : {}),
      ...(offset ? { offset } : {}),
      ...(query.filter ? { filter: query.filter } : {}),
      ...(kind === 'variables' ? { scope: query.scope ?? 'SESSION' } : {}),
      ...(query.timeoutMs ? { timeout_ms: query.timeoutMs } : {}),
    };
    if (!validators.ServerAdminReadRequest(body))
      throw new ApiError('invalid_request', t('serverAdmin.errInvalidRequest'));
    const payload = await localized(() =>
      this.client.requestRaw(`/api/v17/${kind}`, token, body, signal),
    );
    if (
      !validators.ServerAdminReadResult(payload) ||
      !consistent(payload, { kind, driver: connection.driver, offset, limit })
    )
      throw invalid();
    return payload;
  }
}

export const serverAdminClient = new ServerAdminClient();
