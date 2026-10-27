// SPDX-License-Identifier: AGPL-3.0-only
import * as v11 from '$lib/contract/v11/validators.js';
import * as v21 from '$lib/contract/v21/validators.js';
import { ApiClient, ApiError } from '$lib/api';
import { t } from '$lib/i18n';
import type { ExportApi } from './run';
import type { ExportFormat } from './verify';

/** What the export panel needs from either capability document. */
export interface ExportCaps {
  api: ExportApi;
  available: boolean;
  formats: ExportFormat[];
  drivers: {
    driver: string;
    reason: string;
    /** API 0.21 only: dump details the driver accepts. */
    dataStatements?: string[];
    compatibility?: string[];
  }[];
}

/**
 * Prefers GET /api/v21/capabilities (extended formats and dump details). Instances that predate
 * API 0.21 answer 404 and fall back to the 0.11 export with its four formats.
 */
export async function loadCapabilities(
  token: string,
  signal: AbortSignal,
  client = new ApiClient(),
): Promise<ExportCaps> {
  try {
    const data = await client.requestRaw('/api/v21/capabilities', token, undefined, signal);
    if (!v21.ExtendedExportCapabilities(data))
      throw new ApiError('invalid_response', t('exportDump.err.invalidCaps'));
    return {
      api: 'v21',
      available: data.available,
      formats: data.formats as ExportFormat[],
      drivers: data.drivers.map((entry) => ({
        driver: entry.driver,
        reason: entry.reason,
        dataStatements: entry.data_statements,
        compatibility: entry.compatibility,
      })),
    };
  } catch (cause) {
    if (!(cause instanceof ApiError && cause.code === 'not_found')) throw cause;
  }
  try {
    const data = await client.requestRaw('/api/v11/capabilities', token, undefined, signal);
    if (!v11.ExportCapabilities(data))
      throw new ApiError('invalid_response', t('exportDump.err.invalidCaps'));
    return {
      api: 'v11',
      available: data.available,
      formats: data.formats as ExportFormat[],
      drivers: data.drivers.map((entry) => ({ driver: entry.driver, reason: entry.reason })),
    };
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'not_found')
      throw new ApiError('unsupported_feature', t('exportDump.err.noV11'));
    throw cause;
  }
}
