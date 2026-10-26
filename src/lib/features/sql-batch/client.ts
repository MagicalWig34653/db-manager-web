// SPDX-License-Identifier: AGPL-3.0-only
import { ApiClient, ApiError, toConnection } from '$lib/api';
import type { ConnectionDraft } from '$lib/workbench';
import type { components } from '$lib/contract/v12/api-types';
import * as validators from '$lib/contract/v12/validators.js';
import { t } from '$lib/i18n';

type Schemas = components['schemas'];
export type Capabilities = Schemas['SQLBatchCapabilities'];
export type BatchResult = Schemas['SQLBatchResult'];
export type SimulationResult = Schemas['SQLSimulationResult'];
export type Request = Schemas['SQLBatchRequest'];
export type Action = 'batch' | 'explain' | 'simulate';
export type Result = BatchResult | SimulationResult;

export function validate<T extends keyof Schemas & keyof typeof validators>(
  name: T,
  value: unknown,
): Schemas[T] {
  if (!validators[name](value))
    throw new ApiError('invalid_response', t('sqlBatch.invalidResponse'));
  return value as Schemas[T];
}

export function buildRequest(
  connection: ConnectionDraft,
  options: {
    sql: string;
    delimiter: string;
    mode: 'stop' | 'continue';
    maxRows: number;
    timeoutMs: number;
  },
): Request {
  const request: Request = {
    connection: toConnection(connection),
    sql: options.sql,
    confirm: true,
    ...(options.delimiter ? { delimiter: options.delimiter } : {}),
    mode: options.mode,
    max_rows: options.maxRows,
    timeout_ms: options.timeoutMs,
  };
  const delimiter = request.delimiter ?? '';
  if (
    !options.sql.trim() ||
    !Number.isInteger(options.maxRows) ||
    !Number.isInteger(options.timeoutMs) ||
    !validators.SQLBatchRequest(request) ||
    (delimiter &&
      (!/^[;!%&*+,\-./:<=>?@^|~$]{1,16}$/.test(delimiter) || /^(--|\/\*)/.test(delimiter))) ||
    new TextEncoder().encode(JSON.stringify(request)).byteLength > 1048576
  )
    throw new ApiError('invalid_sqlbatch', t('sqlBatch.invalidInput'));
  return request;
}

export class BatchClient {
  constructor(private client = new ApiClient()) {}
  async capabilities(token: string, signal: AbortSignal): Promise<Capabilities> {
    return validate(
      'SQLBatchCapabilities',
      await this.client.requestRaw('/api/v12/capabilities', token, undefined, signal),
    );
  }
  async execute(
    action: Action,
    request: Request,
    token: string,
    signal: AbortSignal,
    onDispatch: () => void,
  ): Promise<Result> {
    const data = await this.client.requestRaw(`/api/v12/sql/${action}`, token, request, signal, {
      onDispatch,
    });
    return action === 'simulate'
      ? validate('SQLSimulationResult', data)
      : validate('SQLBatchResult', data);
  }
}
export const batchClient = new BatchClient();

// Only these public pre-execution rejections prove that this request was not run.
export function isRejection(cause: unknown): boolean {
  return (
    cause instanceof ApiError &&
    [
      'invalid_sqlbatch',
      'sql_not_supported',
      'simulation_not_supported',
      'unsupported_feature',
      'unauthorized',
      'request_too_large',
      'unsupported_media_type',
      'not_found',
      'insecure_origin',
    ].includes(cause.code)
  );
}
export function errorText(cause: unknown): string {
  const code = cause instanceof ApiError ? cause.code : '';
  const keys: Record<string, string> = {
    sql_not_supported: 'sqlBatch.delimiterHelp',
    simulation_not_supported: 'sqlBatch.unsupported',
    invalid_sqlbatch: 'sqlBatch.invalidInput',
    unauthorized: 'sqlBatch.unauthorized',
    not_found: 'sqlBatch.unavailable',
    unsupported_feature: 'sqlBatch.unavailable',
    request_too_large: 'sqlBatch.invalidInput',
    insecure_origin: 'sqlBatch.secureOrigin',
  };
  return t(keys[code] ?? 'sqlBatch.failed');
}
