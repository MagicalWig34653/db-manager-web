// SPDX-License-Identifier: AGPL-3.0-only
// Types, action metadata and German/English texts for API 0.22 (partitions and the table prefix batch).
import type { components } from '$lib/contract/v22/api-types';
import type { Driver } from '$lib/workbench';
import { t } from '$lib/i18n';

type Schemas = components['schemas'];
export type PartitionsCapabilities = Schemas['PartitionsCapabilities'];
export type PartitionCapability = Schemas['PartitionCapability'];
export type PartitionDriverCapabilities = Schemas['PartitionDriverCapabilities'];
export type PartitionsResult = Schemas['PartitionsResult'];
export type PartitionInfo = Schemas['PartitionInfo'];
export type PartitionDefinition = Schemas['PartitionDefinition'];
export type StructurePlan = Schemas['StructurePlan'];
export type StructureResult = Schemas['StructureResult'];
export type PrefixStructureResult = Schemas['PrefixStructureResult'];
export type PrefixTableResult = Schemas['PrefixTableResult'];
export type PrefixResult = Schemas['PrefixResult'];
export type TableRef = Schemas['TableRef'];
export type ApiDriver = 'sqlite' | 'mysql' | 'postgres';

export type PartitionAction = Schemas['PartitionRequest']['action'];
export type PrefixAction = Schemas['PrefixRequest']['action'];
/** Whether a request belongs to one table's partitions or to a prefix batch. */
export type Kind = 'partition' | 'prefix';
export type StructureAnyResult = StructureResult | PrefixStructureResult;

export const PARTITION_ACTIONS: PartitionAction[] = [
  'define',
  'add',
  'drop',
  'reorganize',
  'coalesce',
  'remove',
  'analyze',
  'check',
  'optimize',
  'rebuild',
  'repair',
  'truncate',
  'attach',
  'detach',
];
export const PREFIX_ACTIONS: PrefixAction[] = [
  'drop',
  'truncate',
  'replace',
  'remove',
  'add',
  'copy',
];
export const METHODS = ['RANGE', 'LIST', 'HASH', 'KEY'] as const;
export type Method = (typeof METHODS)[number];

/** Actions that name existing partitions (the request needs `partitions`). */
export const NEEDS_PARTITIONS: ReadonlySet<PartitionAction> = new Set([
  'drop',
  'truncate',
  'reorganize',
  'analyze',
  'check',
  'optimize',
  'rebuild',
  'repair',
  'detach',
]);

export const apiDriverOf = (driver: Driver): ApiDriver =>
  driver === 'postgresql' ? 'postgres' : driver;

/** Action of the plan/confirmation: "partition_drop" or "prefix_replace". */
export const wireAction = (kind: Kind, action: string) => `${kind}_${action}`;

const partitionTitleKeys: Record<PartitionAction, string> = {
  define: 'partitions.actDefine',
  add: 'partitions.actAdd',
  drop: 'partitions.actDrop',
  reorganize: 'partitions.actReorganize',
  coalesce: 'partitions.actCoalesce',
  remove: 'partitions.actRemove',
  analyze: 'partitions.actAnalyze',
  check: 'partitions.actCheck',
  optimize: 'partitions.actOptimize',
  rebuild: 'partitions.actRebuild',
  repair: 'partitions.actRepair',
  truncate: 'partitions.actTruncate',
  attach: 'partitions.actAttach',
  detach: 'partitions.actDetach',
};
const prefixTitleKeys: Record<PrefixAction, string> = {
  drop: 'partitions.pfxDrop',
  truncate: 'partitions.pfxTruncate',
  replace: 'partitions.pfxReplace',
  remove: 'partitions.pfxRemove',
  add: 'partitions.pfxAdd',
  copy: 'partitions.pfxCopy',
};
export const partitionTitle = (action: PartitionAction) => t(partitionTitleKeys[action]);
export const prefixTitle = (action: PrefixAction) => t(prefixTitleKeys[action]);

const reasonKeys: Record<string, string> = {
  permission_denied: 'partitions.reasonPermission',
  object_exists: 'partitions.reasonExists',
  object_not_found: 'partitions.reasonNotFound',
  dependency_blocks: 'partitions.reasonDependency',
  lock_timeout: 'partitions.reasonLock',
  in_use: 'partitions.reasonInUse',
  invalid_value: 'partitions.reasonInvalid',
  database_error: 'partitions.reasonDatabase',
  observation_mismatch: 'partitions.reasonObservation',
  canceled: 'partitions.reasonCanceled',
};
export const reasonText = (reason: string | undefined) =>
  reason && reasonKeys[reason] ? t(reasonKeys[reason]) : t('partitions.reasonDatabase');

const statusKeys = {
  applied: 'partitions.statusApplied',
  not_applied: 'partitions.statusNotApplied',
  unknown: 'partitions.statusUnknown',
} as const;
export const statusText = (status: PrefixTableResult['status']) => t(statusKeys[status]);

const affectedKinds: Record<string, string> = {
  table: 'partitions.affTable',
  partition: 'partitions.affPartition',
  view: 'partitions.affView',
  inherited: 'partitions.affInherited',
};
/** "partition:name" from the backend becomes "Partition name"; unknown prefixes stay as they are. */
export function affectedLabel(value: string): string {
  const index = value.indexOf(':');
  const key = index > 0 ? affectedKinds[value.slice(0, index)] : undefined;
  return key ? `${t(key)} ${value.slice(index + 1)}` : value;
}

export const tableLabel = (table: TableRef) =>
  (table.schema ? `${table.schema}.` : '') + table.name;

/** Bound fields a definition needs, by driver and method (PARTITIONS-API.md). */
export type BoundShape = 'less_than' | 'from_to' | 'values' | 'hash';
export function boundShape(driver: ApiDriver, method: string): BoundShape | null {
  const base = method.split(/[ (]/)[0].toUpperCase();
  if (base === 'LIST') return 'values';
  if (base === 'RANGE') return driver === 'postgres' ? 'from_to' : 'less_than';
  if (base === 'HASH' && driver === 'postgres') return 'hash';
  return null;
}
