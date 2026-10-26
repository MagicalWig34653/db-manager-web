// SPDX-License-Identifier: AGPL-3.0-only
import type { components } from '$lib/contract/v23/api-types';
export type Schemas = components['schemas'];
export type Action = Schemas['AccountConfirm']['action'];
export type AccountRef = Schemas['AccountRef'];
export type Grant = Schemas['AccountGrant'];
export const actions: Action[] = [
  'create',
  'rename',
  'drop',
  'password',
  'grant',
  'revoke',
  'lock',
  'unlock',
  'role_grant',
  'role_revoke',
  'copy',
  'flush',
];
export const scopes: Grant['scope'][] = ['global', 'database', 'table', 'column', 'routine'];
export const privileges: Grant['privilege'][] = [
  'ALLOW_NONEXISTENT_DEFINER',
  'ALTER',
  'ALTER ROUTINE',
  'BACKUP_ADMIN',
  'BINLOG_ADMIN',
  'CONNECT',
  'CONNECTION_ADMIN',
  'CREATE',
  'CREATE ROLE',
  'CREATE ROUTINE',
  'CREATE TABLESPACE',
  'CREATE TEMPORARY TABLES',
  'CREATE USER',
  'CREATE VIEW',
  'DELETE',
  'DROP',
  'DROP ROLE',
  'EVENT',
  'EXECUTE',
  'FILE',
  'INDEX',
  'INSERT',
  'LOCK TABLES',
  'MAINTAIN',
  'PROCESS',
  'REFERENCES',
  'RELOAD',
  'REPLICATION CLIENT',
  'REPLICATION SLAVE',
  'REPLICATION_APPLIER',
  'REPLICATION_SLAVE_ADMIN',
  'ROLE_ADMIN',
  'SELECT',
  'SESSION_VARIABLES_ADMIN',
  'SET_ANY_DEFINER',
  'SET_USER_ID',
  'SHOW DATABASES',
  'SHOW VIEW',
  'SHUTDOWN',
  'SUPER',
  'SYSTEM_USER',
  'SYSTEM_VARIABLES_ADMIN',
  'TEMPORARY',
  'TRIGGER',
  'TRUNCATE',
  'UPDATE',
  'USAGE',
];
export const requestSchemas = {
  create: 'AccountCreateRequest',
  rename: 'AccountRenameRequest',
  drop: 'AccountDropRequest',
  password: 'AccountPasswordRequest',
  grant: 'AccountGrantRequest',
  revoke: 'AccountRevokeRequest',
  lock: 'AccountLockRequest',
  unlock: 'AccountUnlockRequest',
  role_grant: 'AccountRoleGrantRequest',
  role_revoke: 'AccountRoleRevokeRequest',
  copy: 'AccountCopyRequest',
  flush: 'AccountFlushRequest',
} as const;
export const executeSchemas = {
  create: 'AccountCreateExecuteRequest',
  rename: 'AccountRenameExecuteRequest',
  drop: 'AccountDropExecuteRequest',
  password: 'AccountPasswordExecuteRequest',
  grant: 'AccountGrantExecuteRequest',
  revoke: 'AccountRevokeExecuteRequest',
  lock: 'AccountLockExecuteRequest',
  unlock: 'AccountUnlockExecuteRequest',
  role_grant: 'AccountRoleGrantExecuteRequest',
  role_revoke: 'AccountRoleRevokeExecuteRequest',
  copy: 'AccountCopyExecuteRequest',
  flush: 'AccountFlushExecuteRequest',
} as const;
export function accountLabel(account: AccountRef) {
  return account.host === undefined ? account.name : `${account.name}@${account.host}`;
}
export function validSecret(secret: string) {
  const length = new TextEncoder().encode(secret).length;
  return length > 0 && length <= 4096 && !secret.includes('\0');
}
