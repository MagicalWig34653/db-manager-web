// SPDX-License-Identifier: AGPL-3.0-only
import { ApiClient, ApiError } from '$lib/api';
import * as validators from '$lib/contract/v6/validators.js';
import type { components } from '$lib/contract/v6/api-types';
import { t } from '$lib/i18n';
import type { CreateTableRequest } from './model';

type Schemas = components['schemas'];
export type CreateCapabilities = Schemas['CreateCapabilities'];
export type CreateTableResult = Schemas['CreateTableResult'];

/** Codes after which the table may or may not exist; the request must never be re-sent. */
const UNKNOWN_AFTER_DISPATCH = new Set(['invalid_response', 'timeout', 'network_error']);

const messages: Record<string, string> = {
  create_conflict: 'table-create.errConflict',
  invalid_create: 'table-create.errInvalidCreate',
  invalid_request: 'table-create.errInvalidCreate',
  invalid_connection: 'table-create.errInvalidCreate',
  outcome_unknown: 'table-create.errUnknown',
  unsupported_feature: 'table-create.errUnsupported',
  unauthorized: 'table-create.errUnauthorized',
  query_canceled: 'table-create.errTimeout',
  database_busy: 'table-create.errBusy',
  database_error: 'table-create.errDatabase',
  unsupported_driver: 'table-create.errDriver',
  driver_unavailable: 'table-create.errDriver',
};

/** German, code-based message; server texts are never shown verbatim. */
export function createErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const key = messages[error.code];
    return key ? t(key) : t('table-create.errGeneric', { code: error.code });
  }
  return t('table-create.errGeneric', { code: 'unknown' });
}

export class CreateClient {
  constructor(private client = new ApiClient()) {}

  /** Reads and validates API 0.6 capabilities; throws unsupported_feature when not offered. */
  async capabilities(token: string, signal?: AbortSignal): Promise<CreateCapabilities> {
    let payload: unknown;
    try {
      payload = await this.client.requestRaw('/api/v6/capabilities', token, undefined, signal);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'not_found')
        throw new ApiError('unsupported_feature', t('table-create.errUnsupported'));
      throw cause;
    }
    if (!validators.CreateCapabilities(payload))
      throw new ApiError('unsupported_feature', t('table-create.errUnsupported'));
    const capabilities = payload as CreateCapabilities;
    if (!capabilities.features.includes('table_create'))
      throw new ApiError('unsupported_feature', t('table-create.errUnsupported'));
    return capabilities;
  }

  /**
   * Sends exactly one create request. There is no retry: any failure after the request left the
   * browser without a definite server answer is reported as outcome_unknown.
   */
  async create(
    request: CreateTableRequest,
    token: string,
    onDispatch: () => void = () => {},
  ): Promise<CreateTableResult> {
    if (!validators.CreateTableRequest(request))
      throw new ApiError('invalid_create', t('table-create.errInvalidCreate'));
    let dispatched = false;
    try {
      const payload = await this.client.requestRaw(
        '/api/v6/tables/create',
        token,
        request,
        undefined,
        {
          onDispatch: () => {
            dispatched = true;
            onDispatch();
          },
        },
      );
      if (!validators.CreateTableResult(payload))
        throw new ApiError('invalid_response', t('table-create.errInvalidResponse'));
      return payload as CreateTableResult;
    } catch (cause) {
      if (dispatched && (!(cause instanceof ApiError) || UNKNOWN_AFTER_DISPATCH.has(cause.code)))
        throw new ApiError('outcome_unknown', t('table-create.errUnknown'));
      if (cause instanceof ApiError && cause.code === 'not_found')
        throw new ApiError('unsupported_feature', t('table-create.errUnsupported'));
      throw cause;
    }
  }
}
export const createClient = new CreateClient();
