// SPDX-License-Identifier: AGPL-3.0-only
import { ApiClient, ApiError } from '$lib/api';
import * as validators from '$lib/contract/v22/validators.js';
import { t } from '$lib/i18n';
import {
  wireAction,
  type Kind,
  type PartitionsCapabilities,
  type PartitionsResult,
  type PrefixResult,
  type StructureAnyResult,
  type StructurePlan,
} from './model';

/** Codes after which the change may have taken effect; never re-sent automatically. */
const UNKNOWN_AFTER_DISPATCH = new Set(['invalid_response', 'timeout', 'network_error']);
const messages: Record<string, string> = {
  invalid_object_op: 'partitions.errInvalid',
  invalid_request: 'partitions.errInvalid',
  confirmation_mismatch: 'partitions.errConfirmation',
  plan_mismatch: 'partitions.errPlanMismatch',
  object_not_found: 'partitions.reasonNotFound',
  not_found: 'partitions.errNotFound',
  object_exists: 'partitions.reasonExists',
  unsupported_action: 'partitions.errUnsupportedAction',
  unsupported_feature: 'partitions.errUnsupportedFeature',
  outcome_unknown: 'partitions.errUnknown',
  unauthorized: 'partitions.errUnauthorized',
  query_canceled: 'partitions.errTimeout',
  timeout: 'partitions.errTimeout',
  request_too_large: 'partitions.errInvalid',
  result_too_large: 'partitions.errTooMany',
  database_busy: 'partitions.reasonInUse',
  database_error: 'partitions.reasonDatabase',
  network_error: 'partitions.errNetwork',
  invalid_response: 'partitions.errResponse',
  invalid_connection: 'partitions.errConnection',
};
/** Localized, code-based message; raw server texts are never shown. */
export function structureErrorMessage(error: unknown): string {
  const code = error instanceof ApiError ? error.code : 'unknown';
  const key = messages[code];
  return key ? t(key) : t('partitions.errGeneric', { code });
}
export const errorCode = (error: unknown) => (error instanceof ApiError ? error.code : 'unknown');

const route = (kind: Kind) => (kind === 'partition' ? 'tables/partitions' : 'tables/prefix');

export class PartitionsClient {
  constructor(private client = new ApiClient()) {}

  async capabilities(token: string, signal?: AbortSignal): Promise<PartitionsCapabilities> {
    let payload: unknown;
    try {
      payload = await this.client.requestRaw('/api/v22/capabilities', token, undefined, signal);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'not_found')
        throw new ApiError('unsupported_feature', t('partitions.errUnsupportedFeature'));
      throw cause;
    }
    if (!validators.PartitionsCapabilities(payload))
      throw new ApiError('unsupported_feature', t('partitions.errUnsupportedFeature'));
    return payload as PartitionsCapabilities;
  }

  async listPartitions(
    body: Record<string, unknown>,
    token: string,
    signal?: AbortSignal,
  ): Promise<PartitionsResult> {
    if (!validators.PartitionsReadRequest(body))
      throw new ApiError('invalid_request', t('partitions.errInvalid'));
    const payload = await this.client.requestRaw(
      '/api/v22/tables/partitions/list',
      token,
      body,
      signal,
    );
    if (!validators.PartitionsResult(payload))
      throw new ApiError('invalid_response', t('partitions.errResponse'));
    return payload as PartitionsResult;
  }

  async listPrefix(
    body: Record<string, unknown>,
    token: string,
    signal?: AbortSignal,
  ): Promise<PrefixResult> {
    if (!validators.PrefixReadRequest(body))
      throw new ApiError('invalid_request', t('partitions.errInvalid'));
    const payload = await this.client.requestRaw(
      '/api/v22/tables/prefix/list',
      token,
      body,
      signal,
    );
    if (!validators.PrefixResult(payload))
      throw new ApiError('invalid_response', t('partitions.errResponse'));
    return payload as PrefixResult;
  }

  async plan(
    kind: Kind,
    action: string,
    body: Record<string, unknown>,
    token: string,
    signal?: AbortSignal,
  ): Promise<StructurePlan> {
    const valid = kind === 'partition' ? validators.PartitionRequest : validators.PrefixRequest;
    if (!valid(body)) throw new ApiError('invalid_request', t('partitions.errInvalid'));
    const payload = await this.client.requestRaw(
      `/api/v22/${route(kind)}/plan`,
      token,
      body,
      signal,
    );
    if (!validators.StructurePlan(payload))
      throw new ApiError('invalid_response', t('partitions.errResponse'));
    const plan = payload as StructurePlan;
    if (plan.action !== wireAction(kind, action))
      throw new ApiError('invalid_response', t('partitions.errResponse'));
    return plan;
  }

  /**
   * Sends exactly one execute request. Failures after dispatch without a definite server answer
   * become outcome_unknown; there is no retry.
   */
  async execute(
    kind: Kind,
    action: string,
    body: Record<string, unknown>,
    token: string,
    onDispatch: () => void = () => {},
  ): Promise<StructureAnyResult> {
    const valid =
      kind === 'partition' ? validators.StructureExecuteRequest : validators.PrefixExecuteRequest;
    if (!valid(body)) throw new ApiError('invalid_request', t('partitions.errInvalid'));
    let dispatched = false;
    try {
      const payload = await this.client.requestRaw(
        `/api/v22/${route(kind)}/execute`,
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
      const ok =
        kind === 'partition'
          ? validators.StructureResult(payload)
          : validators.PrefixStructureResult(payload);
      if (!ok) throw new ApiError('invalid_response', t('partitions.errResponse'));
      const result = payload as StructureAnyResult;
      if (result.action !== wireAction(kind, action))
        throw new ApiError('invalid_response', t('partitions.errResponse'));
      return result;
    } catch (cause) {
      if (dispatched && (!(cause instanceof ApiError) || UNKNOWN_AFTER_DISPATCH.has(cause.code)))
        throw new ApiError('outcome_unknown', t('partitions.errUnknown'));
      throw cause;
    }
  }
}
export const partitionsClient = new PartitionsClient();
