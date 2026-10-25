// SPDX-License-Identifier: AGPL-3.0-only
import * as validators from '$lib/contract/v11/validators.js';
import { ApiClient, ApiError } from '$lib/api';
import { t } from '$lib/i18n';
import type { ExportCapabilities } from './run';

export async function loadCapabilities(
  token: string,
  signal: AbortSignal,
  client = new ApiClient(),
): Promise<ExportCapabilities> {
  try {
    const data = await client.requestRaw('/api/v11/capabilities', token, undefined, signal);
    if (!validators.ExportCapabilities(data))
      throw new ApiError('invalid_response', t('exportDump.err.invalidCaps'));
    return data;
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'not_found')
      throw new ApiError('unsupported_feature', t('exportDump.err.noV11'));
    throw cause;
  }
}
