// SPDX-License-Identifier: AGPL-3.0-only
import { ApiClient, ApiError } from '$lib/api';
import * as validators from '$lib/contract/v8/validators.js';
import { t } from '$lib/i18n';
import {
  ACTIONS,
  type Action,
  type DependenciesResult,
  type ObjectOpCapabilities,
  type ObjectOpPlan,
  type ObjectOpResult,
} from './model';

/** Codes after which the action may have taken effect; never re-sent automatically. */
const UNKNOWN_AFTER_DISPATCH = new Set(['invalid_response', 'timeout', 'network_error']);
const messages: Record<string, string> = {
  invalid_object_op: 'object-ops.errInvalid',
  confirmation_mismatch: 'object-ops.errConfirmation',
  plan_mismatch: 'object-ops.errPlanMismatch',
  object_not_found: 'object-ops.reasonNotFound',
  not_found: 'object-ops.errNotFound',
  object_exists: 'object-ops.reasonExists',
  unsupported_action: 'object-ops.errUnsupportedAction',
  unsupported_feature: 'object-ops.errUnsupportedFeature',
  outcome_unknown: 'object-ops.errUnknown',
  unauthorized: 'object-ops.errUnauthorized',
  query_canceled: 'object-ops.errTimeout',
  timeout: 'object-ops.errTimeout',
  request_too_large: 'object-ops.errInvalid',
  database_busy: 'object-ops.reasonInUse',
  database_error: 'object-ops.reasonDatabase',
  network_error: 'object-ops.errNetwork',
  invalid_response: 'object-ops.errResponse',
};
/** German, code-based message; raw server texts are never shown. */
export function opErrorMessage(error: unknown): string {
  const code = error instanceof ApiError ? error.code : 'unknown';
  const key = messages[code];
  return key ? t(key) : t('object-ops.errGeneric', { code });
}
export const errorCode = (error: unknown) => (error instanceof ApiError ? error.code : 'unknown');

export class ObjectOpsClient {
  constructor(private client = new ApiClient()) {}

  async capabilities(token: string, signal?: AbortSignal): Promise<ObjectOpCapabilities> {
    let payload: unknown;
    try {
      payload = await this.client.requestRaw('/api/v8/capabilities', token, undefined, signal);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'not_found')
        throw new ApiError('unsupported_feature', t('object-ops.errUnsupportedFeature'));
      throw cause;
    }
    if (!validators.ObjectOpCapabilities(payload))
      throw new ApiError('unsupported_feature', t('object-ops.errUnsupportedFeature'));
    return payload as ObjectOpCapabilities;
  }

  async plan(
    action: Action,
    body: Record<string, unknown>,
    token: string,
    signal?: AbortSignal,
  ): Promise<ObjectOpPlan> {
    const payload = await this.client.requestRaw(
      `/api/v8/${ACTIONS[action].path}/plan`,
      token,
      body,
      signal,
    );
    if (!validators.ObjectOpPlan(payload))
      throw new ApiError('invalid_response', t('object-ops.errResponse'));
    const plan = payload as ObjectOpPlan;
    if (plan.action !== action) throw new ApiError('invalid_response', t('object-ops.errResponse'));
    return plan;
  }

  async dependencies(
    body: Record<string, unknown>,
    token: string,
    signal?: AbortSignal,
  ): Promise<DependenciesResult> {
    const payload = await this.client.requestRaw(
      '/api/v8/tables/dependencies',
      token,
      body,
      signal,
    );
    if (!validators.DependenciesResult(payload))
      throw new ApiError('invalid_response', t('object-ops.errResponse'));
    return payload as DependenciesResult;
  }

  /**
   * Sends exactly one execute request. Failures after dispatch without a definite server answer
   * become outcome_unknown; there is no retry.
   */
  async execute(
    action: Action,
    body: Record<string, unknown>,
    token: string,
    onDispatch: () => void = () => {},
  ): Promise<ObjectOpResult> {
    let dispatched = false;
    try {
      const payload = await this.client.requestRaw(
        `/api/v8/${ACTIONS[action].path}`,
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
      if (!validators.ObjectOpResult(payload))
        throw new ApiError('invalid_response', t('object-ops.errResponse'));
      const result = payload as ObjectOpResult;
      if (result.action !== action)
        throw new ApiError('invalid_response', t('object-ops.errResponse'));
      return result;
    } catch (cause) {
      if (dispatched && (!(cause instanceof ApiError) || UNKNOWN_AFTER_DISPATCH.has(cause.code)))
        throw new ApiError('outcome_unknown', t('object-ops.errUnknown'));
      throw cause;
    }
  }
}
export const objectOpsClient = new ObjectOpsClient();
