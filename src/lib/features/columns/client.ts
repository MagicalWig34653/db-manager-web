// SPDX-License-Identifier: AGPL-3.0-only
import { ApiClient, ApiError } from '$lib/api';
import * as validators from '$lib/contract/v9/validators.js';
import { t } from '$lib/i18n';
import type { ColumnsCapabilities, ColumnsPlan, ColumnsResult } from './model';

/** Codes after which the change may have taken effect; never re-sent automatically. */
const UNKNOWN_AFTER_DISPATCH = new Set(['invalid_response', 'timeout', 'network_error']);
const messages: Record<string, string> = {
  invalid_columns: 'columns.errInvalid',
  invalid_table: 'columns.errInvalid',
  invalid_request: 'columns.errInvalid',
  request_too_large: 'columns.errInvalid',
  confirmation_mismatch: 'columns.errConfirmation',
  plan_mismatch: 'columns.errPlanMismatch',
  table_not_found: 'columns.errTableNotFound',
  column_not_found: 'columns.errColumnNotFound',
  column_exists: 'columns.errColumnExists',
  unsupported_action: 'columns.errUnsupportedAction',
  unsupported_feature: 'columns.errUnsupportedFeature',
  outcome_unknown: 'columns.errUnknown',
  unauthorized: 'columns.errUnauthorized',
  query_canceled: 'columns.errTimeout',
  timeout: 'columns.errTimeout',
  database_busy: 'columns.reasonInUse',
  database_error: 'columns.reasonDatabase',
  network_error: 'columns.errNetwork',
  invalid_response: 'columns.errResponse',
};
/** German, code-based message; raw server texts are never shown. */
export function columnsErrorMessage(error: unknown): string {
  const code = error instanceof ApiError ? error.code : 'unknown';
  const key = messages[code];
  return key ? t(key) : t('columns.errGeneric', { code });
}
export const errorCode = (error: unknown) => (error instanceof ApiError ? error.code : 'unknown');

export class ColumnsClient {
  constructor(private client = new ApiClient()) {}

  async capabilities(token: string, signal?: AbortSignal): Promise<ColumnsCapabilities> {
    let payload: unknown;
    try {
      payload = await this.client.requestRaw('/api/v9/capabilities', token, undefined, signal);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'not_found')
        throw new ApiError('unsupported_feature', t('columns.errUnsupportedFeature'));
      throw cause;
    }
    if (!validators.ColumnsCapabilities(payload))
      throw new ApiError('unsupported_feature', t('columns.errUnsupportedFeature'));
    const caps = payload as ColumnsCapabilities;
    if (!caps.features.includes('columns_alter'))
      throw new ApiError('unsupported_feature', t('columns.errUnsupportedFeature'));
    return caps;
  }

  async plan(body: Record<string, unknown>, token: string, signal?: AbortSignal) {
    const payload = await this.client.requestRaw('/api/v9/columns/plan', token, body, signal);
    if (!validators.ColumnsPlan(payload))
      throw new ApiError('invalid_response', t('columns.errResponse'));
    return payload as ColumnsPlan;
  }

  /**
   * Sends exactly one execute request. Failures after dispatch without a definite server answer
   * become outcome_unknown; there is no retry.
   */
  async alter(
    body: Record<string, unknown>,
    token: string,
    onDispatch: () => void = () => {},
  ): Promise<ColumnsResult> {
    let dispatched = false;
    try {
      const payload = await this.client.requestRaw(
        '/api/v9/columns/alter',
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
      if (!validators.ColumnsResult(payload))
        throw new ApiError('invalid_response', t('columns.errResponse'));
      return payload as ColumnsResult;
    } catch (cause) {
      if (dispatched && (!(cause instanceof ApiError) || UNKNOWN_AFTER_DISPATCH.has(cause.code)))
        throw new ApiError('outcome_unknown', t('columns.errUnknown'));
      throw cause;
    }
  }
}
export const columnsClient = new ColumnsClient();
