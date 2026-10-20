// SPDX-License-Identifier: AGPL-3.0-only
import { ApiClient, ApiError, toConnection } from './api';
import type { CatalogObject, ConnectionDraft, Driver, Execution } from './workbench';
export interface RunOptions {
  maxRows: number;
  timeoutMs: number;
}
export interface Gateway {
  capabilities(token: string, signal?: AbortSignal): Promise<Driver[]>;
  test(draft: ConnectionDraft, token: string, signal?: AbortSignal): Promise<string>;
  catalog(draft: ConnectionDraft, token: string, signal?: AbortSignal): Promise<CatalogObject[]>;
  execute(
    draft: ConnectionDraft,
    token: string,
    sql: string,
    options: RunOptions,
    signal: AbortSignal,
  ): Promise<Execution>;
}
export function createGateway(client = new ApiClient()): Gateway {
  async function capabilities(token: string, signal?: AbortSignal): Promise<Driver[]> {
    const data = await client.capabilities(token, signal);
    if (data.contract_version !== '0.1.0')
      throw new ApiError(
        'contract_version',
        'Diese Backend-Version wird noch nicht unterstützt. Prüfe die Version deiner Instanz.',
      );
    return data.drivers
      .filter((driver) => ['sqlite', 'mysql', 'postgres'].includes(driver))
      .map((driver) => (driver === 'postgres' ? 'postgresql' : driver)) as Driver[];
  }
  return {
    capabilities,
    async test(draft, token, signal) {
      const available = await capabilities(token, signal);
      if (!available.includes(draft.driver))
        throw new ApiError(
          'unsupported_driver',
          'Dieses Datenbanksystem ist auf dem Backend nicht verfügbar.',
        );
      const data = await client.test(toConnection(draft), token, signal);
      if (data.status !== 'ok')
        throw new ApiError(
          'connection_failed',
          'Die Verbindung wurde vom Backend nicht bestätigt.',
        );
      return 'Verbindung erfolgreich. Die Datenbank ist erreichbar.';
    },
    async catalog(draft, token, signal) {
      const data = await client.catalog(toConnection(draft), token, signal);
      return data.tables.map((table) => ({
        name: table.name,
        schema: table.schema,
        type: table.kind,
      }));
    },
    async execute(draft, token, sql, options, signal) {
      const data = await client.query(
        {
          connection: toConnection(draft),
          sql,
          max_rows: options.maxRows,
          timeout_ms: options.timeoutMs,
        },
        token,
        signal,
      );
      if (
        data.results.some((result) =>
          result.rows.some((row) => row.length !== result.columns.length),
        )
      ) {
        throw new ApiError(
          'invalid_response',
          'Die Ergebniszeilen passen nicht zu den gelieferten Spalten.',
        );
      }
      if (data.results.some((result) => result.rows.length > options.maxRows)) {
        throw new ApiError(
          'invalid_response',
          'Das Backend hat das vereinbarte Zeilenlimit überschritten.',
        );
      }
      return {
        elapsedMs: data.duration_ms,
        warnings: [],
        results: data.results.map((result) => ({
          columns: result.columns.map((column) => ({
            name: column.name,
            type: column.database_type,
          })),
          rows: result.rows,
          truncated: result.truncated,
          affectedRows: result.rows_affected,
        })),
      };
    },
  };
}
export const gateway = createGateway();
