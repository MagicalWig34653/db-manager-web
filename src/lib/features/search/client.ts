// SPDX-License-Identifier: AGPL-3.0-only
import { ApiClient, ApiError } from '$lib/api';
import * as validators from '$lib/contract/v14/validators.js';
import { t } from '$lib/i18n';
import type { Schemas } from './model';
export const errorCode = (cause: unknown) => (cause instanceof ApiError ? cause.code : 'unknown');
const messages: Record<string, string> = {
  unsupported_feature: 'unsupported',
  not_found: 'unsupported',
  invalid_search: 'invalid',
  unsupported_search: 'unsupportedSearch',
  replace_limit: 'replaceLimit',
  plan_mismatch: 'stale',
  confirmation_mismatch: 'confirmationError',
  outcome_unknown: 'unknown',
  unauthorized: 'unauthorized',
  query_canceled: 'canceled',
  timeout: 'canceled',
  network_error: 'network',
  invalid_response: 'response',
  table_not_found: 'missing',
  row_conflict: 'conflict',
  database_busy: 'busy',
};
export const searchError = (cause: unknown) =>
  t('search.' + (messages[errorCode(cause)] ?? 'failed'));
export function validate<T extends keyof Schemas>(name: T, value: unknown): Schemas[T] {
  if (!validators[name](value)) throw new ApiError('invalid_response', t('search.response'));
  return value as Schemas[T];
}
export class SearchClient {
  constructor(private client = new ApiClient()) {}
  async capabilities(token: string, signal?: AbortSignal) {
    return validate(
      'SearchCapabilities',
      await this.client.requestRaw('/api/v14/capabilities', token, undefined, signal),
    );
  }
  async search(body: Schemas['SearchRequest'], token: string, signal?: AbortSignal) {
    validate('SearchRequest', body);
    const data = validate(
      'SearchResult',
      await this.client.requestRaw('/api/v14/search', token, body, signal),
    );
    if (
      data.tables.length !== body.targets.length ||
      data.tables.some((table, i) => {
        const target = body.targets[i];
        return (
          table.table.name !== target.table.name ||
          table.table.schema !== target.table.schema ||
          JSON.stringify(table.columns) !== JSON.stringify(target.columns) ||
          table.rows.some((row) => row.length !== table.columns.length) ||
          table.rows.length > (body.preview_rows || 5)
        );
      }) ||
      data.tables.reduce((sum, table) => sum + table.count, 0) > (body.max_rows || 100)
    )
      throw new ApiError('invalid_response', t('search.response'));
    return data;
  }
  async plan(body: Schemas['ReplaceRequest'], token: string, signal?: AbortSignal) {
    validate('ReplaceRequest', body);
    const plan = validate(
      'ReplacePlan',
      await this.client.requestRaw('/api/v14/replace/plan', token, body, signal),
    );
    if (
      plan.table.name !== body.table.name ||
      plan.table.schema !== body.table.schema ||
      plan.column !== body.column ||
      plan.driver !== body.connection.driver
    )
      throw new ApiError('invalid_response', t('search.response'));
    return plan;
  }
  async execute(body: Schemas['ReplaceExecuteRequest'], token: string, onDispatch: () => void) {
    validate('ReplaceExecuteRequest', body);
    let sent = false;
    try {
      return validate(
        'ReplaceResult',
        await this.client.requestRaw('/api/v14/replace', token, body, undefined, {
          onDispatch: () => {
            sent = true;
            onDispatch();
          },
        }),
      );
    } catch (cause) {
      if (
        sent &&
        (!(cause instanceof ApiError) ||
          ['network_error', 'timeout', 'invalid_response', 'result_too_large'].includes(cause.code))
      )
        throw new ApiError('outcome_unknown', t('search.unknown'));
      throw cause;
    }
  }
}
export const searchClient = new SearchClient();
