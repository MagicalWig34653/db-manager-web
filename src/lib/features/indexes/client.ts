// SPDX-License-Identifier: AGPL-3.0-only
import { ApiClient, ApiError } from '$lib/api';
import * as validators from '$lib/contract/v13/validators.js';
import { t } from '$lib/i18n';
import type { IndexesCapabilities, IndexesPlan, IndexesResult } from './model';

/** Codes after which the change may have taken effect; never re-sent automatically. */
const UNKNOWN_AFTER_DISPATCH = new Set(['invalid_response', 'timeout', 'network_error']);
const messages: Record<string, string> = {
  invalid_indexes: 'indexes.errInvalid',
  invalid_table: 'indexes.errInvalid',
  invalid_request: 'indexes.errInvalid',
  request_too_large: 'indexes.errInvalid',
  confirmation_mismatch: 'indexes.errConfirmation',
  plan_mismatch: 'indexes.errPlanMismatch',
  table_not_found: 'indexes.errTableNotFound',
  column_not_found: 'indexes.errColumnNotFound',
  object_exists: 'indexes.errObjectExists',
  object_not_found: 'indexes.errObjectNotFound',
  unsupported_action: 'indexes.errUnsupportedAction',
  unsupported_feature: 'indexes.errUnsupportedFeature',
  outcome_unknown: 'indexes.errUnknown',
  unauthorized: 'indexes.errUnauthorized',
  query_canceled: 'indexes.errTimeout',
  timeout: 'indexes.errTimeout',
  database_busy: 'indexes.reasonInUse',
  database_error: 'indexes.reasonDatabase',
  network_error: 'indexes.errNetwork',
  invalid_response: 'indexes.errResponse',
};
/** German, code-based message; raw server texts are never shown. */
export function indexesErrorMessage(error: unknown): string {
  const code = error instanceof ApiError ? error.code : 'unknown';
  const key = messages[code];
  return key ? t(key) : t('indexes.errGeneric', { code });
}
export const errorCode = (error: unknown) => (error instanceof ApiError ? error.code : 'unknown');

export class IndexesClient {
  constructor(private client = new ApiClient()) {}

  async capabilities(token: string, signal?: AbortSignal): Promise<IndexesCapabilities> {
    let payload: unknown;
    try {
      payload = await this.client.requestRaw('/api/v13/capabilities', token, undefined, signal);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'not_found')
        throw new ApiError('unsupported_feature', t('indexes.errUnsupportedFeature'));
      throw cause;
    }
    if (!validators.IndexesCapabilities(payload))
      throw new ApiError('unsupported_feature', t('indexes.errUnsupportedFeature'));
    const caps = payload as IndexesCapabilities;
    if (!caps.features.includes('indexes_alter'))
      throw new ApiError('unsupported_feature', t('indexes.errUnsupportedFeature'));
    return caps;
  }

  async plan(body: Record<string, unknown>, token: string, signal?: AbortSignal) {
    if (!validators.IndexesPlanRequest(body))
      throw new ApiError('invalid_indexes', t('indexes.errInvalid'));
    const payload = await this.client.requestRaw('/api/v13/indexes/plan', token, body, signal);
    if (!validators.IndexesPlan(payload))
      throw new ApiError('invalid_response', t('indexes.errResponse'));
    return payload as IndexesPlan;
  }

  /**
   * Sends exactly one execute request. Failures after dispatch without a definite server answer
   * become outcome_unknown; there is no retry.
   */
  async alter(
    body: Record<string, unknown>,
    token: string,
    onDispatch: () => void = () => {},
  ): Promise<IndexesResult> {
    let dispatched = false;
    try {
      const payload = await this.client.requestRaw(
        '/api/v13/indexes/alter',
        token,
        body,
        undefined,
        {
          onDispatch: () => {
            dispatched = true;
            onDispatch();
          },
        },
      );
      if (!validators.IndexesResult(payload))
        throw new ApiError('invalid_response', t('indexes.errResponse'));
      return payload as IndexesResult;
    } catch (cause) {
      if (dispatched && (!(cause instanceof ApiError) || UNKNOWN_AFTER_DISPATCH.has(cause.code)))
        throw new ApiError('outcome_unknown', t('indexes.errUnknown'));
      throw cause;
    }
  }
}
export const indexesClient = new IndexesClient();
