// SPDX-License-Identifier: AGPL-3.0-only
import type { components } from '$lib/contract/v10/api-types';
import { t } from '$lib/i18n';
type Schemas = components['schemas'];
export type Item = Schemas['MaintenanceItem'];
export type PlanResult = Schemas['MaintenancePlanResult'];
export type Result = Schemas['MaintenanceResult'];
export type Capabilities = Schemas['MaintenanceCapabilities'];
export type Connection = Schemas['Connection'];
export const actions: Item['action'][] = [
  'analyze',
  'optimize',
  'repair',
  'check',
  'checksum',
  'vacuum',
  'reindex',
];
export const tableKey = (table: Item['table']) => JSON.stringify([table.schema ?? '', table.name]);
export const tableLabel = (table: Item['table']) =>
  table.schema ? `${table.schema}.${table.name}` : table.name;
export function validItems(items: Item[]) {
  return (
    items.length > 0 &&
    items.length <= 50 &&
    new Set(items.map((item) => tableKey(item.table))).size === items.length
  );
}
export function reasonText(code: string) {
  return code
    ? t(`maintenance.reasons.${code}`) === `maintenance.reasons.${code}`
      ? t('maintenance.failed', { code })
      : t(`maintenance.reasons.${code}`)
    : '';
}
