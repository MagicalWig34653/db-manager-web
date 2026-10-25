// SPDX-License-Identifier: AGPL-3.0-only
// Action metadata and German texts for API 0.8 (database and table operations).
import type { components } from '$lib/contract/v8/api-types';
import type { Driver } from '$lib/workbench';
import { t } from '$lib/i18n';

type Schemas = components['schemas'];
export type Action = Schemas['ObjectOpPlan']['action'];
export type ObjectOpPlan = Schemas['ObjectOpPlan'];
export type ObjectOpResult = Schemas['ObjectOpResult'];
export type ObjectOpCapabilities = Schemas['ObjectOpCapabilities'];
export type ObjectOpCapability = Schemas['ObjectOpCapability'];
export type ObjectDependency = Schemas['ObjectDependency'];
export type DependenciesResult = Schemas['DependenciesResult'];
export type ApiDriver = 'sqlite' | 'mysql' | 'postgres';

export interface ActionInfo {
  /** Path below /api/v8; the plan route appends "/plan". */
  path: string;
  scope: 'database' | 'table';
  titleKey: string;
}
export const ACTIONS: Record<Action, ActionInfo> = {
  database_create: {
    path: 'databases/create',
    scope: 'database',
    titleKey: 'object-ops.actDatabaseCreate',
  },
  database_drop: {
    path: 'databases/drop',
    scope: 'database',
    titleKey: 'object-ops.actDatabaseDrop',
  },
  database_collation: {
    path: 'databases/collation',
    scope: 'database',
    titleKey: 'object-ops.actDatabaseCollation',
  },
  table_rename: { path: 'tables/rename', scope: 'table', titleKey: 'object-ops.actTableRename' },
  table_copy: { path: 'tables/copy', scope: 'table', titleKey: 'object-ops.actTableCopy' },
  table_truncate: {
    path: 'tables/truncate',
    scope: 'table',
    titleKey: 'object-ops.actTableTruncate',
  },
  table_drop: { path: 'tables/drop', scope: 'table', titleKey: 'object-ops.actTableDrop' },
  table_options: { path: 'tables/options', scope: 'table', titleKey: 'object-ops.actTableOptions' },
};
export const apiDriverOf = (driver: Driver): ApiDriver =>
  driver === 'postgresql' ? 'postgres' : driver;

const reasonKeys: Record<string, string> = {
  permission_denied: 'object-ops.reasonPermission',
  object_exists: 'object-ops.reasonExists',
  object_not_found: 'object-ops.reasonNotFound',
  dependency_blocks: 'object-ops.reasonDependency',
  lock_timeout: 'object-ops.reasonLock',
  in_use: 'object-ops.reasonInUse',
  invalid_value: 'object-ops.reasonInvalid',
  database_error: 'object-ops.reasonDatabase',
  observation_mismatch: 'object-ops.reasonObservation',
  canceled: 'object-ops.reasonCanceled',
};
export const reasonText = (reason: string | undefined) =>
  reason && reasonKeys[reason] ? t(reasonKeys[reason]) : t('object-ops.reasonDatabase');

const effectKeys = {
  blocks: 'object-ops.effectBlocks',
  breaks: 'object-ops.effectBreaks',
  follows: 'object-ops.effectFollows',
  info: 'object-ops.effectInfo',
} as const;
const kindKeys = {
  foreign_key_in: 'object-ops.kindFkIn',
  foreign_key_out: 'object-ops.kindFkOut',
  view: 'object-ops.kindView',
} as const;
export const effectText = (value: ObjectDependency['effect']) => t(effectKeys[value]);
export const kindText = (value: ObjectDependency['kind']) => t(kindKeys[value]);

/** True when the user has to type the target name (taken from the plan, never from the form). */
export const needsTypedName = (plan: ObjectOpPlan) => plan.confirmation.destructive;
