// SPDX-License-Identifier: AGPL-3.0-only
import { ApiClient, ApiError } from '$lib/api';
import * as v from '$lib/contract/v16/validators.js';
import { t } from '$lib/i18n';
import type { Schemas } from './model';
export const errorCode = (error: unknown) => (error instanceof ApiError ? error.code : 'unknown');
export const errorMessage = (error: unknown) => {
  const code = errorCode(error);
  if (code === 'outcome_unknown') return t('programs.unknown');
  if (code === 'plan_mismatch') return t('programs.mismatch');
  if (code === 'unsupported_feature' || code === 'not_found') return t('programs.unavailable');
  return t('programs.error', { code });
};
export class ProgramsClient {
  constructor(private api = new ApiClient()) {}
  private async read<T>(
    path: string,
    token: string,
    body: unknown,
    validate: (data: unknown) => data is T,
    signal?: AbortSignal,
  ): Promise<T> {
    // Reads are side-effect free: a transient SQLite "database_busy" (concurrent request) is retried briefly.
    let data: unknown;
    for (let attempt = 0; ; attempt++) {
      try {
        data = await this.api.requestRaw(
          path,
          token,
          body as Record<string, unknown> | undefined,
          signal,
        );
        break;
      } catch (cause) {
        if (attempt >= 3 || signal?.aborted || errorCode(cause) !== 'database_busy') throw cause;
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    if (!validate(data)) throw new ApiError('invalid_response', t('programs.invalidResponse'));
    return data;
  }
  async capabilities(token: string, signal?: AbortSignal) {
    const data = await this.read(
      '/api/v16/capabilities',
      token,
      undefined,
      v.ProgramsCapabilities,
      signal,
    );
    if (
      !['list', 'describe', 'plan', 'execute'].every((feature) =>
        data.features.includes(feature as (typeof data.features)[number]),
      )
    )
      throw new ApiError('unsupported_feature', t('programs.unavailable'));
    return data;
  }
  list(body: Schemas['ProgramsRequest'], token: string, signal?: AbortSignal) {
    return this.read('/api/v16/programs/list', token, body, v.ProgramsResult, signal);
  }
  describe(body: Schemas['ProgramDescribeRequest'], token: string, signal?: AbortSignal) {
    return this.read('/api/v16/programs/describe', token, body, v.Program, signal);
  }
  plan(body: Schemas['ProgramChangeRequest'], token: string, signal?: AbortSignal) {
    return this.read('/api/v16/programs/plan', token, body, v.ProgramPlan, signal);
  }
  async execute(
    body: Extract<Schemas['ProgramExecuteRequest'], { connection: unknown }>,
    token: string,
    onDispatch: () => void = () => {},
  ) {
    let dispatched = false;
    try {
      const data = await this.api.requestRaw('/api/v16/programs/execute', token, body, undefined, {
        onDispatch: () => {
          dispatched = true;
          onDispatch();
        },
      });
      if (!v.ProgramResult(data))
        throw new ApiError('invalid_response', t('programs.invalidResponse'));
      return data;
    } catch (cause) {
      if (
        dispatched &&
        (!(cause instanceof ApiError) ||
          ['network_error', 'timeout', 'invalid_response', 'query_canceled'].includes(cause.code))
      )
        throw new ApiError('outcome_unknown', t('programs.unknown'));
      throw cause;
    }
  }
}
export const programsClient = new ProgramsClient();
