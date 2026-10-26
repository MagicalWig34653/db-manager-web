// SPDX-License-Identifier: AGPL-3.0-only
import { ApiClient, ApiError } from '$lib/api';
import * as validators from '$lib/contract/v10/validators.js';
import { t } from '$lib/i18n';
import type { Capabilities, PlanResult, Result } from './model';
export const errorCode = (error: unknown) => (error instanceof ApiError ? error.code : 'unknown');
export const errorText = (error: unknown) =>
  errorCode(error) === 'outcome_unknown'
    ? t('maintenance.unknown')
    : t('maintenance.failed', { code: errorCode(error) });
export class MaintenanceClient {
  constructor(private api = new ApiClient()) {}
  async capabilities(token: string, signal?: AbortSignal): Promise<Capabilities> {
    const data = await this.api.requestRaw('/api/v10/capabilities', token, undefined, signal);
    if (!validators.MaintenanceCapabilities(data) || !data.available)
      throw new ApiError('unsupported_feature', t('maintenance.unavailable'));
    return data;
  }
  async plan(
    body: Record<string, unknown>,
    token: string,
    signal?: AbortSignal,
  ): Promise<PlanResult> {
    const data = await this.api.requestRaw('/api/v10/tables/maintenance/plan', token, body, signal);
    if (!validators.MaintenancePlanResult(data))
      throw new ApiError('invalid_response', t('maintenance.invalidResponse'));
    return data;
  }
  async execute(
    body: Record<string, unknown>,
    token: string,
    onDispatch: () => void,
  ): Promise<Result> {
    let dispatched = false;
    try {
      const data = await this.api.requestRaw(
        '/api/v10/tables/maintenance',
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
      if (!validators.MaintenanceResult(data))
        throw new ApiError('invalid_response', t('maintenance.invalidResponse'));
      return data;
    } catch (error) {
      if (
        dispatched &&
        (!(error instanceof ApiError) ||
          [
            'invalid_response',
            'timeout',
            'network_error',
            'result_too_large',
            'outcome_unknown',
          ].includes(error.code))
      )
        throw new ApiError('outcome_unknown', t('maintenance.unknown'));
      throw error;
    }
  }
}
export const maintenanceClient = new MaintenanceClient();
