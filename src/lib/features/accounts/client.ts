// SPDX-License-Identifier: AGPL-3.0-only
import { ApiClient, ApiError } from '$lib/api';
import * as validators from '$lib/contract/v15/validators.js';
import { t } from '$lib/i18n';
import { requestSchemas, executeSchemas, type Action, type Schemas } from './model';

export function errorMessage(error: unknown) {
  const code = error instanceof ApiError ? error.code : '';
  const keys: Record<string, string> = {
    unsupported_feature: 'unsupported',
    unsupported_action: 'unsupportedAction',
    unauthorized: 'unauthorized',
    permission_denied: 'permission_denied',
    plan_mismatch: 'planMismatch',
    confirmation_mismatch: 'confirmationMismatch',
    outcome_unknown: 'unknown',
    network_error: 'network',
    timeout: 'timeout',
    invalid_response: 'invalidResponse',
    account_not_found: 'object_not_found',
    account_exists: 'object_exists',
    invalid_request: 'invalidRequest',
    invalid_account_request: 'invalidRequest',
    system_account: 'systemAccount',
    result_too_large: 'resultTooLarge',
  };
  return t(`accounts.${keys[code] ?? 'error'}`);
}
export const errorCode = (error: unknown) => (error instanceof ApiError ? error.code : '');

export class AccountsClient {
  constructor(private api = new ApiClient()) {}
  private async read<K extends keyof Schemas>(
    path: string,
    schema: K,
    token: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<Schemas[K]> {
    const payload = await this.api.requestRaw(path, token, body, signal);
    if (!validators[schema](payload)) throw new ApiError('invalid_response', '');
    return payload as Schemas[K];
  }
  async capabilities(token: string, signal?: AbortSignal) {
    try {
      return await this.read(
        '/api/v15/capabilities',
        'AccountsCapabilities',
        token,
        undefined,
        signal,
      );
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'not_found')
        throw new ApiError('unsupported_feature', '');
      throw cause;
    }
  }
  list(body: Schemas['AccountListRequest'], token: string, signal?: AbortSignal) {
    return this.read('/api/v15/accounts/list', 'AccountsResult', token, body, signal);
  }
  inspect(body: Schemas['AccountInspectRequest'], token: string, signal?: AbortSignal) {
    return this.read('/api/v15/accounts/inspect', 'AccountDetails', token, body, signal);
  }
  access(body: Schemas['AccountAccessRequest'], token: string, signal?: AbortSignal) {
    return this.read('/api/v15/accounts/access', 'AccountAccess', token, body, signal);
  }
  async plan(action: Action, body: Record<string, unknown>, token: string, signal?: AbortSignal) {
    if (!validators[requestSchemas[action]](body)) throw new ApiError('invalid_request', '');
    const plan = await this.read(
      `/api/v15/accounts/${action}/plan`,
      'AccountPlan',
      token,
      body,
      signal,
    );
    if (plan.action !== action || plan.confirmation.action !== action)
      throw new ApiError('invalid_response', '');
    return plan;
  }
  async execute(
    action: Action,
    body: Record<string, unknown>,
    token: string,
    onDispatch: () => void,
  ) {
    if (!validators[executeSchemas[action]](body)) throw new ApiError('invalid_request', '');
    let dispatched = false;
    try {
      const payload = await this.api.requestRaw(
        `/api/v15/accounts/${action}`,
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
      if (!validators.AccountResult(payload)) throw new ApiError('invalid_response', '');
      return payload;
    } catch (cause) {
      // An unreadable answer after sending cannot prove that the write did not commit.
      if (
        dispatched &&
        (!(cause instanceof ApiError) ||
          ['invalid_response', 'network_error', 'timeout', 'result_too_large'].includes(cause.code))
      ) {
        throw new ApiError('outcome_unknown', '');
      }
      throw cause;
    }
  }
}
export const accountsClient = new AccountsClient();
